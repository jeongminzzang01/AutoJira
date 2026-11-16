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

    const exports={
        esc,stripHtml,parseJiraErrorMsg,formatDraftAge,
        ensureMilestonePrefix,buildFullTitle,
        ordinalToDayOffset,extractOrdinalFromSummary,
        normalizeIssueType,
        allowedChildTypes,correctChildType
    };
    if(typeof module!=='undefined'&&module.exports)module.exports=exports;
    else if(global)global.AutoJiraUtils=exports;
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
