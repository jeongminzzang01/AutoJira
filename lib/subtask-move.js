// AUTOJIRA 서브태스크 부모 일괄 이동 (순수 로직 — jiraFetch 를 주입받아 사용)
// fetch 시그니처: (path, opts) => Promise<Response>  (index.html 의 jiraFetch 와 동일)
(function(global){

    const PERMISSION_HINT='권한 부족(403): 대상 프로젝트에서 "Browse projects", "Edit issues" 권한이 필요합니다.';

    function escapeJqlString(s){
        return String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
    }

    // 기준이 에픽이면 parentEpic(에픽 → 태스크 → 서브태스크), 태스크면 parent(태스크의 서브태스크)
    function buildSearchJql(sourceKey,keyword,isEpic=true){
        const scope=isEpic?`parentEpic = ${sourceKey}`:`parent = ${sourceKey}`;
        const kw=String(keyword||'').trim();
        return `${scope} AND issuetype in subTaskIssueTypes()${kw?` AND summary ~ "${escapeJqlString(kw)}*"`:''}`;
    }

    // "34403" → "PM-34403", "pm-34403" → "PM-34403", 그 외는 null
    function normalizeIssueKey(input,projectKey){
        const t=String(input||'').trim();
        if(/^\d+$/.test(t))return projectKey?`${projectKey}-${t}`:null;
        if(/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(t))return t.toUpperCase();
        return null;
    }

    const isEpicType=it=>it?.hierarchyLevel===1||/^(epic|에픽)$/i.test(it?.name||'');

    // 드롭다운 후보 검색: 키(숫자만 입력 가능) 정확 일치 + 제목 검색. 서브태스크는 제외.
    // kind: 'any'(기본, 서브태스크 제외) | 'task'(에픽/서브태스크 제외, 일반 태스크만) | 'subtask'(서브태스크만)
    async function searchIssueCandidates(fetchFn,q,projectKey,kind='any'){
        const text=String(q||'').trim();
        if(!text)return[];
        const types=kind==='subtask'?'subTaskIssueTypes()':'standardIssueTypes()';
        const fields='&fields=summary,issuetype&maxResults=8';
        const run=async jql=>{
            try{
                const r=await fetchFn('/rest/api/3/search/jql?jql='+encodeURIComponent(jql)+fields);
                return r.ok?((await r.json()).issues||[]):[];
            }catch(e){return[];}
        };
        const key=normalizeIssueKey(text,projectKey);
        const scope=projectKey?`project = "${escapeJqlString(projectKey)}" AND `:'';
        const [byKey,byText]=await Promise.all([
            key?run(`${scope}key = ${key} AND issuetype in ${types}`):[],
            run(`${scope}summary ~ "${escapeJqlString(text)}*" AND issuetype in ${types} ORDER BY updated DESC`)
        ]);
        const seen=new Set();
        const okKind=i=>kind!=='task'||(i.fields?.issuetype?.hierarchyLevel===0||(i.fields?.issuetype?.hierarchyLevel===undefined&&!isEpicType(i.fields?.issuetype)));
        return[...byKey,...byText].filter(okKind).filter(i=>!seen.has(i.key)&&seen.add(i.key)).map(i=>({
            value:i.key,
            type:i.fields?.issuetype?.name||'',
            summary:i.fields?.summary||''
        }));
    }

    async function readError(r){
        let text='';
        try{text=await r.text();}catch(e){}
        return text.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
    }

    async function httpError(r,what){
        if(r.status===403)return new Error(`${what}: ${PERMISSION_HINT}`);
        if(r.status===429)return new Error(`${what}: 요청 제한(429) — 재시도 후에도 실패했습니다.`);
        return new Error(`${what}: HTTP ${r.status} ${await readError(r)}`);
    }

    // 1) 검색 (nextPageToken 페이지네이션)
    async function searchSubtasks(fetchFn,sourceKey,keyword,isEpic=true){
        const jql=buildSearchJql(sourceKey,keyword,isEpic);
        const out=[];
        let token='';
        for(let page=0;page<100;page++){
            const path='/rest/api/3/search/jql?jql='+encodeURIComponent(jql)
                +'&maxResults=100&fields=summary,parent,project,issuetype'
                +(token?'&nextPageToken='+encodeURIComponent(token):'');
            const r=await fetchFn(path);
            if(!r.ok)throw await httpError(r,'서브태스크 검색');
            const d=await r.json();
            (d.issues||[]).forEach(i=>out.push(i));
            if(d.isLast||!d.nextPageToken)break;
            token=d.nextPageToken;
        }
        return out;
    }

    // 2) 2차 필터: summary 에 keyword 가 실제 포함된 것만 (대소문자 무시)
    function filterByKeyword(issues,keyword){
        const kw=String(keyword||'').trim().toLowerCase();
        const matched=[],excluded=[];
        issues.forEach(i=>{
            const s=String(i.fields?.summary||'').toLowerCase();
            (s.includes(kw)?matched:excluded).push(i);
        });
        return{matched,excluded};
    }

    // 직접 지정한 키들을 개별 조회 (404 는 missing 으로 분리)
    async function loadIssuesByKeys(fetchFn,keys){
        const uniq=[...new Set(keys)];
        const found=[],missing=[];
        const results=await Promise.all(uniq.map(async k=>{
            const r=await fetchFn(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,issuetype,project,parent,subtasks`);
            if(r.status===404||r.status===400)return{k,missing:true};
            if(!r.ok)throw await httpError(r,`${k} 조회`);
            return{k,issue:await r.json()};
        }));
        results.forEach(x=>x.missing?missing.push(x.k):found.push(x.issue));
        return{found,missing};
    }

    // 3) 대상 부모 검증
    async function fetchIssueInfo(fetchFn,key,label){
        const r=await fetchFn(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype,project`);
        if(r.status===404)throw new Error(`${label} ${key} 를 찾을 수 없습니다.`);
        if(!r.ok)throw await httpError(r,`${label} ${key} 조회`);
        const t=await r.json();
        if(t.fields?.issuetype?.subtask)throw new Error(`${label} ${key} 는 서브태스크입니다. 에픽 또는 태스크를 지정하세요.`);
        return t;
    }
    const fetchTargetParent=(fetchFn,key)=>fetchIssueInfo(fetchFn,key,'이동할 태스크');

    // 검증 + 미리보기 목록 생성. 프로젝트 불일치 시 throw (중단).
    async function buildPreview(fetchFn,{sourceKey,keyword,keys,issues,targetParentKey}){
        let matched,excluded=[],invalid=[],missing=[],source,isEpic=false,jql;
        const direct=keys||issues;
        if(direct){
            const L=issues?{found:issues,missing:[]}:await loadIssuesByKeys(fetchFn,keys);
            missing=L.missing;
            matched=[];
            L.found.forEach(i=>i.fields?.issuetype?.subtask?matched.push(i):invalid.push({key:i.key,summary:i.fields?.summary||'',reason:'서브태스크가 아님'}));
            source={fields:{summary:`${direct.length}건 직접 지정`}};
            jql='(직접 선택)';
        }else{
            source=await fetchIssueInfo(fetchFn,sourceKey,'기준 에픽/태스크');
            isEpic=isEpicType(source.fields?.issuetype);
            const found=await searchSubtasks(fetchFn,sourceKey,keyword,isEpic);
            ({matched,excluded}=filterByKeyword(found,keyword));
            jql=buildSearchJql(sourceKey,keyword,isEpic);
        }
        const target=await fetchTargetParent(fetchFn,targetParentKey);
        const targetProject=target.fields?.project?.key;

        const mismatched=matched.filter(i=>i.fields?.project?.key!==targetProject);
        if(mismatched.length){
            throw new Error(`프로젝트 불일치: 대상 부모(${targetParentKey})는 ${targetProject} 프로젝트인데 `
                +`${mismatched.map(i=>i.key+'('+i.fields?.project?.key+')').join(', ')} 는 다른 프로젝트입니다. 중단합니다.`);
        }

        const items=[],alreadyThere=[];
        matched.forEach(i=>{
            const row={key:i.key,summary:i.fields?.summary||'',fromParent:i.fields?.parent?.key||'',toParent:targetParentKey};
            (row.fromParent===targetParentKey?alreadyThere:items).push(row);
        });
        return{
            items,alreadyThere,invalid,missing,
            excluded:excluded.map(i=>({key:i.key,summary:i.fields?.summary||''})),
            source:{key:direct?'직접 선택':sourceKey,summary:source.fields?.summary||'',isEpic,manual:!!direct},
            target:{key:targetParentKey,summary:target.fields?.summary||'',project:targetProject},
            jql
        };
    }

    function formatPreview(p){
        const lines=[`JQL: ${p.jql}`,`기준(${p.source.isEpic?'에픽':'태스크'}): ${p.source.key} ${p.source.summary}`,`이동할 태스크: ${p.target.key} ${p.target.summary}`,'',`이동 대상 ${p.items.length}건`];
        p.items.forEach(i=>lines.push(`${i.key} | ${i.summary} | ${i.fromParent||'(없음)'} → ${i.toParent}`));
        if(p.alreadyThere.length)lines.push('',`이미 대상 부모 아래 (건너뜀) ${p.alreadyThere.length}건: `+p.alreadyThere.map(i=>i.key).join(', '));
        if(p.excluded.length)lines.push('',`2차 필터 제외 ${p.excluded.length}건: `+p.excluded.map(i=>`${i.key} ${i.summary}`).join(' / '));
        return lines.join('\n');
    }

    // 단건 이동: PUT fields.parent → 재조회로 실제 변경 검증 (조용한 실패 방지)
    async function reparent(fetchFn,issueKey,newParentKey){
        const r=await fetchFn(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`,{
            method:'PUT',body:JSON.stringify({fields:{parent:{key:newParentKey}}})
        });
        if(!r.ok)throw await httpError(r,`${issueKey} 이동`);
        const v=await fetchFn(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=parent`);
        if(!v.ok)throw await httpError(v,`${issueKey} 이동 검증`);
        const d=await v.json();
        if(d.fields?.parent?.key!==newParentKey){
            throw new Error(`${issueKey}: API 는 성공했으나 부모가 ${newParentKey} 로 바뀌지 않았습니다(현재 ${d.fields?.parent?.key||'없음'}). Jira UI 에서 수동 이동이 필요합니다.`);
        }
    }

    // 4) 실행. 이동 전에 saveLog(entry) 로 원래 부모를 먼저 기록한다.
    async function executeMove(fetchFn,preview,{sourceKey,keyword,saveLog,onProgress}={}){
        const entry={
            id:'move-'+new Date().toISOString().replace(/[:.]/g,'-'),
            ts:new Date().toISOString(),sourceKey,keyword,
            targetParentKey:preview.target.key,
            items:preview.items.map(i=>({key:i.key,summary:i.summary,fromParent:i.fromParent,toParent:i.toParent,status:'pending'}))
        };
        if(saveLog)await saveLog(entry);
        const report={success:0,failed:0,skipped:preview.alreadyThere.length,errors:[],logId:entry.id};
        for(const it of entry.items){
            try{
                await reparent(fetchFn,it.key,it.toParent);
                it.status='moved';report.success++;
            }catch(e){
                it.status='failed';it.error=e.message;report.failed++;report.errors.push({key:it.key,error:e.message});
                if(/403|권한/.test(e.message)){
                    // 권한 문제는 모든 건에서 동일하므로 나머지 중단
                    entry.items.filter(x=>x.status==='pending').forEach(x=>{x.status='aborted';});
                    break;
                }
            }
            if(onProgress)onProgress(it,entry);
        }
        if(saveLog)await saveLog(entry);
        report.entry=entry;
        return report;
    }

    // undo: 로그에서 moved 였던 항목을 원래 부모로 복원 (원래 부모가 없던 항목은 복원 불가)
    async function undoMove(fetchFn,entry,{saveLog,onProgress}={}){
        const report={success:0,failed:0,skipped:0,errors:[]};
        for(const it of entry.items){
            if(it.status!=='moved'){report.skipped++;continue;}
            if(!it.fromParent){report.skipped++;it.undoError='원래 부모 정보 없음';continue;}
            try{
                await reparent(fetchFn,it.key,it.fromParent);
                it.status='undone';report.success++;
            }catch(e){
                it.undoError=e.message;report.failed++;report.errors.push({key:it.key,error:e.message});
            }
            if(onProgress)onProgress(it,entry);
        }
        if(saveLog)await saveLog(entry);
        return report;
    }

    // ==========================================================
    // 모드 2: 에픽 아래 태스크 → 서브태스크로 변환하며 새 부모로 이동 (Bulk Move API)
    // ==========================================================
    const BULK_PERMISSION_HINT='권한 부족(403): 전역 권한 "Make bulk changes" 와 대상 프로젝트의 "Move issues" 권한이 필요합니다.';
    const defaultSleep=ms=>new Promise(r=>setTimeout(r,ms));

    async function bulkHttpError(r,what){
        if(r.status===403)return new Error(`${what}: ${BULK_PERMISSION_HINT}`);
        return httpError(r,what);
    }

    async function fetchSubtaskType(fetchFn,projectId){
        const r=await fetchFn(`/rest/api/3/issuetype/project?projectId=${encodeURIComponent(projectId)}`);
        if(!r.ok)throw await httpError(r,'프로젝트 서브태스크 유형 조회');
        const types=((await r.json())||[]).filter(t=>t.subtask);
        if(!types.length)throw new Error('대상 프로젝트에 서브태스크 이슈 유형이 없습니다.');
        return{id:String(types[0].id),name:types[0].name,count:types.length};
    }

    // 변환 미리보기. 에픽 기준만 허용. 서브태스크를 가진 태스크는 변환 불가로 분리.
    async function buildConvertPreview(fetchFn,{sourceKey,keyword,keys,issues,targetParentKey}){
        let source=null;
        if(!keys&&!issues){
            source=await fetchIssueInfo(fetchFn,sourceKey,'기준 에픽');
            if(!isEpicType(source.fields?.issuetype))throw new Error(`태스크 → 서브태스크 변환은 에픽 기준에서만 가능합니다. ${sourceKey} 는 에픽이 아닙니다. (특정 태스크는 "직접 선택"으로 지정하세요)`);
        }
        const target=await fetchTargetParent(fetchFn,targetParentKey);
        if(isEpicType(target.fields?.issuetype))throw new Error(`이동할 태스크 ${targetParentKey} 는 에픽입니다. 서브태스크의 부모는 에픽이 될 수 없습니다.`);
        const targetProject=target.fields?.project?.key;
        if(source&&source.fields?.project?.key!==targetProject)throw new Error(`프로젝트 불일치: 에픽(${source.fields?.project?.key})과 이동할 태스크(${targetProject})의 프로젝트가 다릅니다. 중단합니다.`);

        if(keys||issues)return buildConvertPreviewFromKeys(fetchFn,{keys,issues,target,targetParentKey,targetProject});
        const jql=`parent = ${sourceKey} AND issuetype in standardIssueTypes()${String(keyword||'').trim()?` AND summary ~ "${escapeJqlString(String(keyword).trim())}*"`:''}`;
        const found=await searchChildTasks(fetchFn,sourceKey,keyword);
        const{matched,excluded}=filterByKeyword(found,keyword);
        const items=[],hasSubtasks=[],isTarget=[];
        matched.forEach(i=>{
            const row={key:i.key,summary:i.fields?.summary||'',fromParent:i.fields?.parent?.key||'',toParent:targetParentKey,
                fromTypeId:String(i.fields?.issuetype?.id||''),fromTypeName:i.fields?.issuetype?.name||''};
            if(i.key===targetParentKey)isTarget.push(row);
            else if((i.fields?.subtasks||[]).length)hasSubtasks.push({...row,count:i.fields.subtasks.length});
            else items.push(row);
        });
        const subtaskType=items.length?await fetchSubtaskType(fetchFn,target.fields?.project?.id):null;
        return{
            mode:'convert',items,hasSubtasks,isTarget,alreadyThere:[],
            excluded:excluded.map(i=>({key:i.key,summary:i.fields?.summary||''})),
            source:{key:sourceKey,summary:source.fields?.summary||'',isEpic:true},
            target:{key:targetParentKey,summary:target.fields?.summary||'',project:targetProject},
            subtaskType,jql
        };
    }

    // 에픽 바로 아래 일반 태스크 조회 (키워드 선택)
    async function searchChildTasks(fetchFn,sourceKey,keyword){
        const kw=String(keyword||'').trim();
        const jql=`parent = ${sourceKey} AND issuetype in standardIssueTypes()${kw?` AND summary ~ "${escapeJqlString(kw)}*"`:''}`;
        const out=[];
        let token='';
        for(let page=0;page<100;page++){
            const r=await fetchFn('/rest/api/3/search/jql?jql='+encodeURIComponent(jql)
                +'&maxResults=100&fields=summary,parent,project,issuetype,subtasks'
                +(token?'&nextPageToken='+encodeURIComponent(token):''));
            if(!r.ok)throw await httpError(r,'태스크 검색');
            const d=await r.json();
            (d.issues||[]).forEach(i=>out.push(i));
            if(d.isLast||!d.nextPageToken)break;
            token=d.nextPageToken;
        }
        return out;
    }

    // 기준(에픽/태스크) 아래 후보 목록 조회. mode: 'move'(서브태스크) | 'convert'(에픽 아래 태스크). 키워드는 선택.
    async function listCandidates(fetchFn,{mode,sourceKey,keyword}){
        const source=await fetchIssueInfo(fetchFn,sourceKey,'기준 에픽/태스크');
        const isEpic=isEpicType(source.fields?.issuetype);
        let found;
        if(mode==='convert'){
            if(!isEpic)throw new Error(`태스크 → 서브태스크 변환은 에픽 기준에서만 가능합니다. ${sourceKey} 는 에픽이 아닙니다.`);
            found=await searchChildTasks(fetchFn,sourceKey,keyword);
        }else{
            found=await searchSubtasks(fetchFn,sourceKey,keyword,isEpic);
        }
        const{matched,excluded}=filterByKeyword(found,keyword);
        return{source:{key:sourceKey,summary:source.fields?.summary||'',isEpic},issues:matched,excluded:excluded.map(i=>({key:i.key,summary:i.fields?.summary||''}))};
    }

    // 직접 추가용: 번호(키) 하나를 조회해 해당 모드에 맞는지 확인. 맞지 않으면 reason 반환.
    async function loadManualIssue(fetchFn,key,mode){
        const{found}=await loadIssuesByKeys(fetchFn,[key]);
        if(!found.length)return{error:`${key} 를 찾을 수 없습니다.`};
        const i=found[0],it=i.fields?.issuetype;
        if(mode==='convert'){
            if(it?.subtask)return{error:`${key} 는 이미 서브태스크입니다. (서브태스크 이동 탭을 사용하세요)`};
            if(isEpicType(it))return{error:`${key} 는 에픽이라 변환할 수 없습니다.`};
        }else if(!it?.subtask){
            return{error:`${key} 는 서브태스크가 아닙니다. (태스크 → 서브태스크 변환 탭을 사용하세요)`};
        }
        return{issue:i};
    }

    async function buildConvertPreviewFromKeys(fetchFn,{keys,issues,target,targetParentKey,targetProject}){
        const{found,missing}=issues?{found:issues,missing:[]}:await loadIssuesByKeys(fetchFn,keys);
        const count=(keys||issues).length;
        const items=[],hasSubtasks=[],isTarget=[],invalid=[];
        found.forEach(i=>{
            const row={key:i.key,summary:i.fields?.summary||'',fromParent:i.fields?.parent?.key||'',toParent:targetParentKey,
                fromTypeId:String(i.fields?.issuetype?.id||''),fromTypeName:i.fields?.issuetype?.name||''};
            if(i.fields?.issuetype?.subtask)invalid.push({...row,reason:'이미 서브태스크'});
            else if(isEpicType(i.fields?.issuetype))invalid.push({...row,reason:'에픽은 변환 불가'});
            else if(i.fields?.project?.key!==targetProject)throw new Error(`프로젝트 불일치: 이동할 태스크(${targetParentKey})는 ${targetProject} 프로젝트인데 ${i.key}(${i.fields?.project?.key})는 다른 프로젝트입니다. 중단합니다.`);
            else if(i.key===targetParentKey)isTarget.push(row);
            else if((i.fields?.subtasks||[]).length)hasSubtasks.push({...row,count:i.fields.subtasks.length});
            else items.push(row);
        });
        const subtaskType=items.length?await fetchSubtaskType(fetchFn,target.fields?.project?.id):null;
        return{
            mode:'convert',items,hasSubtasks,isTarget,invalid,missing,alreadyThere:[],excluded:[],
            source:{key:'직접 선택',summary:`${count}건 직접 지정`,isEpic:false,manual:true},
            target:{key:targetParentKey,summary:target.fields?.summary||'',project:targetProject},
            subtaskType,jql:'(직접 선택)'
        };
    }

    async function waitBulkTask(fetchFn,taskId,{sleep=defaultSleep,intervalMs=2000,maxTries=90}={}){
        for(let i=0;i<maxTries;i++){
            const r=await fetchFn(`/rest/api/3/bulk/queue/${encodeURIComponent(taskId)}`);
            if(!r.ok)throw await bulkHttpError(r,'벌크 작업 진행 조회');
            const p=await r.json();
            if(!/^(ENQUEUED|RUNNING|CANCEL_REQUESTED)$/i.test(p.status||''))return p;
            await sleep(intervalMs);
        }
        throw new Error(`벌크 작업(${taskId})이 제한 시간 내 끝나지 않았습니다. Jira 에서 진행 상황을 확인하세요.`);
    }

    async function submitBulkMove(fetchFn,mappingKey,keys,opts){
        const r=await fetchFn('/rest/api/3/bulk/issues/move',{method:'POST',body:JSON.stringify({
            sendBulkNotification:false,
            targetToSourcesMapping:{[mappingKey]:{
                inferFieldDefaults:true,inferStatusDefaults:true,inferSubtaskTypeDefault:true,issueIdsOrKeys:keys
            }}
        })});
        if(!r.ok)throw await bulkHttpError(r,'벌크 이동 요청');
        const d=await r.json();
        if(!d.taskId)throw new Error('벌크 이동 요청에 taskId 가 없습니다.');
        return waitBulkTask(fetchFn,d.taskId,opts);
    }

    async function verifyIssue(fetchFn,key,check){
        const v=await fetchFn(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=parent,issuetype`);
        if(!v.ok)throw await httpError(v,`${key} 검증`);
        const f=(await v.json()).fields||{};
        return check(f);
    }

    async function executeConvert(fetchFn,preview,{sourceKey,keyword,saveLog,onProgress,...pollOpts}={}){
        const entry={
            id:'move-'+new Date().toISOString().replace(/[:.]/g,'-'),
            ts:new Date().toISOString(),mode:'convert',sourceKey,keyword,
            targetParentKey:preview.target.key,project:preview.target.project,
            toTypeId:preview.subtaskType.id,toTypeName:preview.subtaskType.name,
            items:preview.items.map(i=>({key:i.key,summary:i.summary,fromParent:i.fromParent,fromTypeId:i.fromTypeId,fromTypeName:i.fromTypeName,toParent:i.toParent,status:'pending'}))
        };
        if(saveLog)await saveLog(entry);
        const report={success:0,failed:0,skipped:0,errors:[],logId:entry.id,entry};
        let progress=null;
        try{
            progress=await submitBulkMove(fetchFn,`${entry.project},${entry.toTypeId},${entry.targetParentKey}`,entry.items.map(i=>i.key),pollOpts);
            entry.bulkStatus=progress?.status;
        }catch(e){
            entry.items.forEach(it=>{it.status='failed';it.error=e.message;});
            report.failed=entry.items.length;report.errors.push({key:'(전체)',error:e.message});
            if(saveLog)await saveLog(entry);
            return report;
        }
        for(const it of entry.items){
            try{
                const ok=await verifyIssue(fetchFn,it.key,f=>f.issuetype?.subtask&&f.parent?.key===it.toParent);
                if(ok){it.status='moved';report.success++;}
                else throw new Error(`${it.key}: 벌크 작업(상태 ${progress?.status||'?'}) 후에도 서브태스크/부모가 반영되지 않았습니다. 필수 필드나 워크플로 상태 때문에 Jira UI 에서 수동 이동이 필요할 수 있습니다.`);
            }catch(e){it.status='failed';it.error=e.message;report.failed++;report.errors.push({key:it.key,error:e.message});}
            if(onProgress)onProgress(it,entry);
        }
        if(saveLog)await saveLog(entry);
        return report;
    }

    // 변환 되돌리기: 원래 유형 + 원래 부모(에픽)로 벌크 이동 후 재조회 검증
    async function undoConvert(fetchFn,entry,{saveLog,onProgress,...pollOpts}={}){
        const report={success:0,failed:0,skipped:0,errors:[]};
        const groups=new Map();
        entry.items.forEach(it=>{
            if(it.status!=='moved'){report.skipped++;return;}
            if(!it.fromTypeId){report.skipped++;it.undoError='원래 유형 정보 없음';return;}
            const k=`${entry.project},${it.fromTypeId}`+(it.fromParent?`,${it.fromParent}`:'');
            if(!groups.has(k))groups.set(k,[]);
            groups.get(k).push(it);
        });
        for(const [k,list] of groups){
            try{await submitBulkMove(fetchFn,k,list.map(i=>i.key),pollOpts);}
            catch(e){list.forEach(it=>{it.undoError=e.message;report.failed++;report.errors.push({key:it.key,error:e.message});});continue;}
            for(const it of list){
                try{
                    const ok=await verifyIssue(fetchFn,it.key,f=>String(f.issuetype?.id)===it.fromTypeId&&!f.issuetype?.subtask&&(!it.fromParent||f.parent?.key===it.fromParent));
                    if(!ok)throw new Error(`${it.key}: 원래 유형/에픽으로 복원되지 않았습니다. Jira UI 에서 수동 복원이 필요합니다.`);
                    it.status='undone';report.success++;
                }catch(e){it.undoError=e.message;report.failed++;report.errors.push({key:it.key,error:e.message});}
                if(onProgress)onProgress(it,entry);
            }
        }
        if(saveLog)await saveLog(entry);
        return report;
    }

    const exports={
        listCandidates,loadManualIssue,searchChildTasks,buildConvertPreview,executeConvert,undoConvert,waitBulkTask,fetchSubtaskType,BULK_PERMISSION_HINT,
        buildSearchJql,normalizeIssueKey,searchIssueCandidates,searchSubtasks,filterByKeyword,fetchTargetParent,
        buildPreview,formatPreview,reparent,executeMove,undoMove,PERMISSION_HINT
    };
    if(typeof module!=='undefined'&&module.exports)module.exports=exports;
    else if(global)global.AutoJiraSubtaskMove=exports;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
