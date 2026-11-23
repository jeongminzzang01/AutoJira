// AUTOJIRA pure utilities (no DOM/state dependencies — fully testable)
(function(global){

    // HTML escape
    function esc(s){
        return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // HTML strip (for error messages from Jira HTML pages)
    function stripHtml(s){
        return String(s==null?'':s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    }

    // Jira error JSON → 사용자용 짧은 메시지
    function parseJiraErrorMsg(text,childType,parentKey){
        try{
            const obj=typeof text==='string'?JSON.parse(text):text;
            const errs=(obj&&obj.errors)||{};
            const msgs=(obj&&obj.errorMessages)||[];
            const parts=[];
            Object.keys(errs).forEach(k=>parts.push(`${k}: ${errs[k]}`));
            msgs.forEach(m=>parts.push(m));
            let summary=parts.join(' / ')||stripHtml(text).slice(0,200);
            if(/parent/i.test(summary)&&/(계층|hierarchy|valid)/i.test(summary)){
                summary=`상위(${parentKey})에 ${childType}을(를) 자식으로 둘 수 없습니다. 자식 유형을 변경하세요.`;
            }
            return summary;
        }catch(e){
            return stripHtml(text).slice(0,200);
        }
    }

    // 드래프트 나이 표시 ("3분 전", "2시간 전", "1일 전")
    function formatDraftAge(ts,now){
        const t=now||Date.now();
        const min=Math.floor((t-ts)/60000);
        if(min<1)return'방금 전';
        if(min<60)return`${min}분 전`;
        const h=Math.floor(min/60);if(h<24)return`${h}시간 전`;
        return`${Math.floor(h/24)}일 전`;
    }

    // 마일스톤 prefix 추가 (이미 있으면 보존)
    function ensureMilestonePrefix(title,milestone){
        if(!title)return title;
        if(!milestone)return title;
        const t=String(title);
        if(t.match(/^\[M\d+\]/i))return t; // 다른 마일스톤이라도 보존
        return `[${milestone}] ${t}`;
    }

    // 부모-자식 제목 결합 (마일스톤 태그 자동 전파)
    function buildFullTitle(parentTitle,childInput){
        if(!childInput)return parentTitle||'';
        // 이미 [KEY] 형태면 그대로
        if(/^\[([A-Z]+-\d+)\]/.test(childInput))return childInput;
        // 부모에서 마일스톤 태그만 추출
        const msMatch=(parentTitle||'').match(/^\[M\d+\]/i);
        const prefix=msMatch?msMatch[0]+' ':'';
        return prefix+childInput;
    }

    // 차수 → dayOffset (1차→0=Mon, 2차→1=Tue, 3차+→2=Wed)
    function ordinalToDayOffset(ordinal){
        const ord=Math.max(1,ordinal||1);
        return Math.min(ord-1,2);
    }

    // 정기점검 빌드 에픽 차수 자동 추출 (기존 Jira summary에서)
    function extractOrdinalFromSummary(summary){
        if(!summary)return null;
        const m=String(summary).match(/(\d+)차/);
        return m?parseInt(m[1],10):null;
    }

    // Jira issuetype.name 정규화 (한국어 → 표준 영문)
    // 한국어 Jira 사이트는 issuetype.name이 "에픽"/"작업"/"하위 작업" 등으로 반환됨
    function normalizeIssueType(name){
        if(!name)return'';
        const map={
            '에픽':'Epic',
            '작업':'Task','태스크':'Task',
            '하위 작업':'Sub-task','하위작업':'Sub-task','서브태스크':'Sub-task','서브 태스크':'Sub-task',
            '스토리':'Story',
            '버그':'Bug',
            '신규 기능':'New Feature','개선':'Improvement'
        };
        const trimmed=String(name).trim();
        return map[trimmed]||trimmed;
    }

    // Jira 부모-자식 계층 검증: 허용되는 자식 타입 반환
    // Epic → [Task,Story,Bug]+, Task/Story/Bug → [Sub-task], Sub-task → []
    function allowedChildTypes(parentType){
        if(!parentType)return['Task','Sub-task'];
        if(parentType==='Epic')return['Task','Story','Bug'];
        if(parentType==='Sub-task')return[];
        return['Sub-task'];
    }

    // 자동 보정: 사용자 선택 자식타입 + 부모타입 → 적절한 자식타입
    function correctChildType(parentType,desiredChildType){
        const allowed=allowedChildTypes(parentType);
        if(!allowed.length)return null; // Sub-task 자식 불가
        if(allowed.includes(desiredChildType))return desiredChildType;
        // Epic + Sub-task → Task로 변경
        if(parentType==='Epic'&&desiredChildType==='Sub-task')return'Task';
        // Task류 + Task → Sub-task로 변경
        if(desiredChildType==='Task')return'Sub-task';
        return allowed[0];
    }

    // 제목 견줄 때 쓰는 꼴: 앞뒤 공백을 떼고 겹친 공백을 하나로. 글자·대소문자는 그대로 본다.
    function normSummary(s){
        return String(s==null?'':s).trim().replace(/\s+/g,' ');
    }

    /* ── 프리셋 합치기 ───────────────────────────────────────
       이름으로 짝짓고, 같은 이름이면 나중에 고친(updatedAt 큰) 쪽을 쓴다.
       같으면 먼저 온 목록 것을 둔다. 여기까지는 전과 같다.

       전에는 '지웠다' 를 나타낼 길이 없었다. 한 군데서 지워도 서버나 다른
       브라우저에 남은 것이 합칠 때 되살아났다. 이름을 바꾸면 옛 이름도 그렇게
       살아 돌아왔다. 그래서 지운 이름과 그 시각을 '지운 표' 로 같이 들고 다닌다.
       지운 시각보다 나중에 고친 것만 산다 — 지운 뒤 같은 이름으로 새로 만든 것은
       살아야 하니까. 목록에 없다고 지우지는 않는다. 여럿이 저장해도, 한쪽이
       모르는 프리셋이 그 때문에 사라지면 안 된다. */
    function mergePresetLists(...lists){
        const map=new Map();
        lists.forEach(list=>(list||[]).forEach(p=>{
            if(!p||typeof p!=='object')return;
            const key=p.name||'';
            const cur=map.get(key);
            if(!cur||(p.updatedAt||0)>(cur.updatedAt||0))map.set(key,p);
        }));
        return [...map.values()];
    }
    function mergePresetTombstones(...lists){
        const map=new Map();
        lists.forEach(list=>(list||[]).forEach(t=>{
            if(!t||!t.name)return;
            const at=Number(t.deletedAt)||0;
            const cur=map.get(t.name);
            if(!cur||at>cur.deletedAt)map.set(t.name,{name:t.name,deletedAt:at});
        }));
        return [...map.values()];
    }
    function applyPresetTombstones(presets,tombs){
        const at=new Map((tombs||[]).map(t=>[t.name,Number(t.deletedAt)||0]));
        return (presets||[]).filter(p=>{
            const key=p.name||'';
            return !(at.has(key)&&(p.updatedAt||0)<=at.get(key));
        });
    }
    // presets: 합칠 목록들, deleted: 합칠 지운 표들 (앞에 둔 것이 같은 시각일 때 이긴다)
    function reconcilePresets({presets=[],deleted=[]}={}){
        const tombs=mergePresetTombstones(...deleted);
        const alive=applyPresetTombstones(mergePresetLists(...presets),tombs);
        // 지운 뒤 같은 이름으로 다시 만든 것이 살아 있으면 그 표는 더 들고 다닐 까닭이 없다
        const aliveAt=new Map(alive.map(p=>[p.name||'',p.updatedAt||0]));
        const keep=tombs.filter(t=>!(aliveAt.has(t.name)&&aliveAt.get(t.name)>t.deletedAt));
        return {presets:alive,deleted:keep};
    }

    /* ── 정기점검: 이미 있는 것 가려내기 ─────────────────────
       [✨ Jira 생성] 을 다시 누르면 Task·Sub-task 가 또 한 벌 생겼다. 만들기
       전에 같은 수정버전 안을 읽어 이미 있는 것을 건너뛴다.

       짝 맞춤은 제목 그대로다. 에픽·Task 는 같은 수정버전 안에서 같은 유형·같은
       제목, Sub-task 는 같은 상위 Task 밑에서 같은 제목. 이 화면이 만드는 제목은
       버전·날짜에서 정해지므로, 같은 주에 다시 누르면 같은 제목이 나온다. */

    // 지라 검색 결과 → [{key,summary,type,parentKey}]. 하위 작업은 상위의 subtasks 칸에서도 줍는다.
    function flattenIssuesForMaint(issues){
        const out=[];const seen=new Set();
        const typeOf=it=>{
            const t=(it&&it.fields&&it.fields.issuetype)||{};
            if(t.subtask===true)return 'Sub-task';
            return normalizeIssueType(t.name||'');
        };
        const add=(e)=>{if(!e.key||seen.has(e.key))return;seen.add(e.key);out.push(e);};
        (issues||[]).forEach(it=>{
            const f=it.fields||{};
            add({key:it.key,summary:f.summary||'',type:typeOf(it),parentKey:(f.parent&&f.parent.key)||''});
            (f.subtasks||[]).forEach(st=>{
                add({key:st.key,summary:(st.fields&&st.fields.summary)||'',type:'Sub-task',parentKey:it.key});
            });
        });
        return out;
    }

    /* want: {epics:[{summary,...}], tasks:[{summary,subs:[{summary,...}],...}]}
       existing: flattenIssuesForMaint 의 꼴
       돌려주는 것: 같은 꼴에 existingKey(있으면 그 키) · dupInRun(이번 목록에 같은 제목이 앞에 또 있음) 을 붙인 것 */
    function planMaintCreation(want,existing){
        const top={Epic:new Map(),Task:new Map()};
        const subsOf=new Map();
        (existing||[]).forEach(it=>{
            const s=normSummary(it.summary);
            if(it.type==='Sub-task'){
                if(!it.parentKey)return;
                if(!subsOf.has(it.parentKey))subsOf.set(it.parentKey,new Map());
                const m=subsOf.get(it.parentKey);if(!m.has(s))m.set(s,it.key);
            }else if(top[it.type]&&!top[it.type].has(s)){
                top[it.type].set(s,it.key);
            }
        });
        const pick=(map,seen,x)=>{
            const s=normSummary(x.summary);
            if(map.has(s))return {...x,existingKey:map.get(s),dupInRun:false};
            if(seen.has(s))return {...x,existingKey:null,dupInRun:true};
            seen.add(s);return {...x,existingKey:null,dupInRun:false};
        };
        const seenEpic=new Set(),seenTask=new Set();
        const epics=((want&&want.epics)||[]).map(e=>pick(top.Epic,seenEpic,e));
        const tasks=((want&&want.tasks)||[]).map(t=>{
            const me=pick(top.Task,seenTask,t);
            const have=(me.existingKey&&subsOf.get(me.existingKey))||new Map();
            const seenSub=new Set();
            me.subs=(t.subs||[]).map(sub=>pick(have,seenSub,sub));
            return me;
        });
        return {epics,tasks};
    }

    /* [⚡ 빌드 에픽 생성] 의 기본 에픽(1~3차 데이터 패치)을 목록에 더한다.
       전에는 목록을 통째로 갈아 끼워서, 먼저 불러온 기존 에픽과 더해 둔 줄이
       사라졌다. 이제는 있는 줄을 그대로 두고, 아직 아무 줄도 차지하지 않은
       차수에만 더한다. 차수 하나에 빌드 에픽 하나다 — 차지한 차수에 또 더하면
       같은 회차 에픽이 두 벌 된다. 차수를 못 읽은 기존 에픽(「없음」)은 차수를
       차지하지 않는다. */
    function fillDefaultMaintEpics(items,{label,ordinals=[1,2,3],version=''}={}){
        const list=items||[];
        const used=new Set(list.map(it=>it&&it.ordinal).filter(n=>n));
        const added=[],skipped=[];
        ordinals.forEach(n=>{
            if(used.has(n)){skipped.push(n);return;}
            used.add(n);
            added.push({label,checked:true,version,ordinal:n});
        });
        return {items:[...list,...added],added,skipped};
    }

    const exports={
        esc,stripHtml,parseJiraErrorMsg,formatDraftAge,
        ensureMilestonePrefix,buildFullTitle,
        ordinalToDayOffset,extractOrdinalFromSummary,
        normalizeIssueType,
        allowedChildTypes,correctChildType,
        normSummary,
        mergePresetLists,mergePresetTombstones,applyPresetTombstones,reconcilePresets,
        flattenIssuesForMaint,planMaintCreation,fillDefaultMaintEpics
    };
    if(typeof module!=='undefined'&&module.exports)module.exports=exports;
    else if(global)global.AutoJiraUtils=exports;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
