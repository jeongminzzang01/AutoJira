const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../lib/subtask-move.js');

const res=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body,text:async()=>typeof body==='string'?body:JSON.stringify(body||'')});
const sub=(key,summary,parent,project='PM')=>({key,fields:{summary,parent:{key:parent},project:{key:project},issuetype:{subtask:true}}});
const target=(key='PM-37193',project='PM',subtask=false)=>({key,fields:{summary:'대상',project:{key:project},issuetype:{subtask}}});

// path 라우팅 mock. calls 에 모든 호출 기록
function mockJira(routes){
    const calls=[];
    const fn=async(path,opts={})=>{
        calls.push({path,method:(opts.method||'GET').toUpperCase(),body:opts.body});
        for(const [test,handler] of routes){
            if(test(path,opts))return handler(path,opts);
        }
        throw new Error('unrouted '+path);
    };
    fn.calls=calls;
    return fn;
}
const src=(key,type,subtask=false)=>({key,fields:{summary:'기준',project:{key:'PM'},issuetype:{name:type,subtask,hierarchyLevel:type==='Epic'?1:subtask?-1:0}}});
const isSearch=p=>p.startsWith('/rest/api/3/search/jql');
const isIssueGet=key=>(p,o)=>p.startsWith('/rest/api/3/issue/'+key)&&!(o.method&&o.method!=='GET');
const isPut=(p,o)=>o.method==='PUT';

test('buildSearchJql: 따옴표 이스케이프', () => {
    assert.equal(M.buildSearchJql('PM-1','사운드'),'parentEpic = PM-1 AND issuetype in subTaskIssueTypes() AND summary ~ "사운드*"');
    assert.match(M.buildSearchJql('PM-1','a"b'),/a\\"b\*/);
});

test('searchSubtasks: nextPageToken 페이지네이션', async () => {
    const pages=[
        {issues:[sub('PM-1','사운드1','PM-10')],nextPageToken:'T2',isLast:false},
        {issues:[sub('PM-2','사운드2','PM-10')],isLast:true}
    ];
    let n=0;
    const f=mockJira([[isSearch,()=>res(200,pages[n++])]]);
    const r=await M.searchSubtasks(f,'PM-34403','사운드');
    assert.deepEqual(r.map(i=>i.key),['PM-1','PM-2']);
    assert.equal(f.calls.length,2);
    assert.ok(!f.calls[0].path.includes('nextPageToken'));
    assert.match(f.calls[1].path,/nextPageToken=T2/);
});

test('filterByKeyword: 2차 필터로 제외 항목 분리', () => {
    const {matched,excluded}=M.filterByKeyword([sub('PM-1','사운드 작업','P'),sub('PM-2','사 운 드','P'),sub('PM-3','BGM 사운드','P')],'사운드');
    assert.deepEqual(matched.map(i=>i.key),['PM-1','PM-3']);
    assert.deepEqual(excluded.map(i=>i.key),['PM-2']);
});

test('buildPreview: 정상 + 이미 대상 부모 아래 건너뜀 + 2차 필터 제외', async () => {
    const f=mockJira([
        [isSearch,()=>res(200,{issues:[sub('PM-1','사운드A','PM-10'),sub('PM-2','사운드B','PM-37193'),sub('PM-3','사 운드','PM-10')],isLast:true})],
        [isIssueGet('PM-37193'),()=>res(200,target())],
        [isIssueGet('PM-34403'),()=>res(200,src('PM-34403','Epic'))]
    ]);
    const p=await M.buildPreview(f,{sourceKey:'PM-34403',keyword:'사운드',targetParentKey:'PM-37193'});
    assert.deepEqual(p.items.map(i=>i.key),['PM-1']);
    assert.deepEqual(p.alreadyThere.map(i=>i.key),['PM-2']);
    assert.deepEqual(p.excluded.map(i=>i.key),['PM-3']);
    assert.match(M.formatPreview(p),/PM-1 \| 사운드A \| PM-10 → PM-37193/);
    assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('buildPreview: 프로젝트 불일치 시 중단', async () => {
    const f=mockJira([
        [isSearch,()=>res(200,{issues:[sub('PM-1','사운드','PM-10','PM'),sub('XX-5','사운드','XX-1','XX')],isLast:true})],
        [isIssueGet('PM-37193'),()=>res(200,target())],
        [isIssueGet('E-1'),()=>res(200,src('E-1','Epic'))]
    ]);
    await assert.rejects(M.buildPreview(f,{sourceKey:'E-1',keyword:'사운드',targetParentKey:'PM-37193'}),/프로젝트 불일치.*XX-5/);
});

test('buildPreview: 대상 부모가 서브태스크면 거부 / 404 면 안내', async () => {
    const f1=mockJira([[isIssueGet('E'),()=>res(200,src('E','Epic'))],[isSearch,()=>res(200,{issues:[],isLast:true})],[isIssueGet('PM-9'),()=>res(200,target('PM-9','PM',true))]]);
    await assert.rejects(M.buildPreview(f1,{sourceKey:'E',keyword:'k',targetParentKey:'PM-9'}),/서브태스크입니다/);
    const f2=mockJira([[isIssueGet('E'),()=>res(200,src('E','Epic'))],[isSearch,()=>res(200,{issues:[],isLast:true})],[isIssueGet('PM-9'),()=>res(404,{})]]);
    await assert.rejects(M.buildPreview(f2,{sourceKey:'E',keyword:'k',targetParentKey:'PM-9'}),/찾을 수 없습니다/);
});

test('searchSubtasks: 403 은 필요한 권한 안내, 429 는 제한 메시지', async () => {
    await assert.rejects(M.searchSubtasks(mockJira([[isSearch,()=>res(403,{})]]),'E','k'),/Browse projects/);
    await assert.rejects(M.searchSubtasks(mockJira([[isSearch,()=>res(429,{})]]),'E','k'),/429/);
});

function previewOf(keys){
    return{items:keys.map(k=>({key:k,summary:'s'+k,fromParent:'PM-10',toParent:'PM-37193'})),alreadyThere:[{key:'PM-99'}],excluded:[],target:{key:'PM-37193'}};
}

test('executeMove: 성공 — 이동 전 로그 저장 후 PUT, 재조회 검증', async () => {
    const f=mockJira([
        [isPut,()=>res(204,'')],
        [(p,o)=>!o.method,()=>res(200,{fields:{parent:{key:'PM-37193'}}})]
    ]);
    const saved=[];
    const rep=await M.executeMove(f,previewOf(['PM-1','PM-2']),{sourceKey:'E',keyword:'k',saveLog:async e=>saved.push(JSON.parse(JSON.stringify(e)))});
    assert.equal(rep.success,2);assert.equal(rep.failed,0);assert.equal(rep.skipped,1);
    assert.ok(saved[0].items.every(i=>i.status==='pending'&&i.fromParent==='PM-10'),'이동 전 원래 부모 로그');
    assert.ok(saved[1].items.every(i=>i.status==='moved'));
    assert.equal(JSON.parse(f.calls.find(c=>c.method==='PUT').body).fields.parent.key,'PM-37193');
});

test('executeMove: PUT 성공했지만 부모가 안 바뀐 경우 실패로 보고', async () => {
    const f=mockJira([[isPut,()=>res(204,'')],[(p,o)=>!o.method,()=>res(200,{fields:{parent:{key:'PM-10'}}})]]);
    const rep=await M.executeMove(f,previewOf(['PM-1']),{});
    assert.equal(rep.failed,1);assert.match(rep.errors[0].error,/바뀌지 않았습니다/);
});

test('executeMove: 403 이면 권한 안내 후 나머지 중단(aborted)', async () => {
    const f=mockJira([[isPut,()=>res(403,{})]]);
    const rep=await M.executeMove(f,previewOf(['PM-1','PM-2','PM-3']),{});
    assert.equal(rep.failed,1);
    assert.match(rep.errors[0].error,/Edit issues/);
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);
    assert.deepEqual(rep.entry.items.map(i=>i.status),['failed','aborted','aborted']);
});

test('executeMove: 일부 실패해도 나머지는 계속 진행', async () => {
    let n=0;
    const f=mockJira([[isPut,()=>res(++n===1?400:204,'bad')],[(p,o)=>!o.method,()=>res(200,{fields:{parent:{key:'PM-37193'}}})]]);
    const rep=await M.executeMove(f,previewOf(['PM-1','PM-2']),{});
    assert.equal(rep.failed,1);assert.equal(rep.success,1);
});

test('undoMove: 로그의 원래 부모로 복원, moved 아닌 항목은 건너뜀', async () => {
    const f=mockJira([[isPut,()=>res(204,'')],[(p,o)=>!o.method,(p)=>res(200,{fields:{parent:{key:'PM-10'}}})]]);
    const entry={items:[
        {key:'PM-1',fromParent:'PM-10',toParent:'PM-37193',status:'moved'},
        {key:'PM-2',fromParent:'PM-10',toParent:'PM-37193',status:'failed'}
    ]};
    const rep=await M.undoMove(f,entry,{});
    assert.equal(rep.success,1);assert.equal(rep.skipped,1);
    assert.equal(entry.items[0].status,'undone');
    assert.equal(JSON.parse(f.calls.find(c=>c.method==='PUT').body).fields.parent.key,'PM-10');
});

test('buildPreview: 기준이 태스크면 parent = 로 검색', async () => {
    const f=mockJira([
        [isSearch,()=>res(200,{issues:[sub('PM-1','사운드','PM-50')],isLast:true})],
        [isIssueGet('PM-37193'),()=>res(200,target())],
        [isIssueGet('PM-50'),()=>res(200,src('PM-50','Task'))]
    ]);
    const p=await M.buildPreview(f,{sourceKey:'PM-50',keyword:'사운드',targetParentKey:'PM-37193'});
    assert.equal(p.source.isEpic,false);
    assert.match(decodeURIComponent(f.calls.find(c=>c.path.includes('search/jql')).path),/parent = PM-50 AND/);
    assert.doesNotMatch(p.jql,/parentEpic/);
});

test('buildPreview: 기준이 서브태스크면 거부', async () => {
    const f=mockJira([[isIssueGet('PM-7'),()=>res(200,src('PM-7','Sub-task',true))]]);
    await assert.rejects(M.buildPreview(f,{sourceKey:'PM-7',keyword:'k',targetParentKey:'PM-1'}),/서브태스크입니다/);
});

test('normalizeIssueKey: 숫자만 입력하면 프로젝트 키 보완', () => {
    assert.equal(M.normalizeIssueKey('34403','PM'),'PM-34403');
    assert.equal(M.normalizeIssueKey(' pm-34403 ','PM'),'PM-34403');
    assert.equal(M.normalizeIssueKey('사운드','PM'),null);
    assert.equal(M.normalizeIssueKey('34403',''),null);
});

test('searchIssueCandidates: 숫자 입력 시 키 정확 일치가 먼저, 중복 제거, 실패는 무시', async () => {
    const jqls=[];
    const f=async p=>{
        const jql=decodeURIComponent(p.split('jql=')[1].split('&')[0]);jqls.push(jql);
        if(jql.startsWith('key ='))return res(200,{issues:[{key:'PM-34403',fields:{summary:'에픽',issuetype:{name:'Epic'}}}]});
        return res(200,{issues:[{key:'PM-34403',fields:{summary:'에픽',issuetype:{name:'Epic'}}},{key:'PM-9',fields:{summary:'34403 관련',issuetype:{name:'Task'}}}]});
    };
    const r=await M.searchIssueCandidates(f,'34403','PM');
    assert.deepEqual(r.map(x=>x.value),['PM-34403','PM-9']);
    assert.ok(jqls.some(j=>j==='project = "PM" AND key = PM-34403 AND issuetype in standardIssueTypes()'));
    const bad=async()=>res(400,{});
    assert.deepEqual(await M.searchIssueCandidates(bad,'34403','PM'),[]);
    assert.deepEqual(await M.searchIssueCandidates(bad,'',''),[]);
});

// ================= 모드 2: 태스크 → 서브태스크 변환 =================
const task=(key,summary,epic,{subtasks=0,typeId='10001'}={})=>({key,fields:{summary,parent:{key:epic},project:{key:'PM'},issuetype:{id:typeId,name:'Task',subtask:false},subtasks:Array.from({length:subtasks},(_,i)=>({key:key+'-s'+i}))}});
const tgt=(key='PM-37193',type='Task')=>({key,fields:{summary:'대상',project:{key:'PM',id:'10000'},issuetype:{name:type,subtask:false,hierarchyLevel:type==='Epic'?1:0}}});
const epicInfo=(key='PM-34403')=>({key,fields:{summary:'에픽',project:{key:'PM',id:'10000'},issuetype:{name:'Epic',subtask:false,hierarchyLevel:1}}});
const isTypes=p=>p.startsWith('/rest/api/3/issuetype/project');
const SUBTYPES=[{id:'10003',name:'Sub-task',subtask:true},{id:'10001',name:'Task',subtask:false}];
const sleep0=async()=>{};

function convertRoutes({searchIssues,targetType='Task',epic=epicInfo()}){
    return[
        [isIssueGet('PM-34403'),()=>res(200,epic)],
        [isIssueGet('PM-37193'),()=>res(200,tgt('PM-37193',targetType))],
        [isSearch,()=>res(200,{issues:searchIssues,isLast:true})],
        [isTypes,()=>res(200,SUBTYPES)]
    ];
}
const args={sourceKey:'PM-34403',keyword:'사운드',targetParentKey:'PM-37193'};

test('buildConvertPreview: parent = 로 검색, 서브태스크 보유/대상 자신/키워드 불일치 분리, 서브태스크 유형 확인', async () => {
    const f=mockJira(convertRoutes({searchIssues:[
        task('PM-1','사운드A','PM-34403'),
        task('PM-2','사운드B','PM-34403',{subtasks:2}),
        task('PM-37193','사운드 대상','PM-34403'),
        task('PM-3','사 운드','PM-34403')
    ]}));
    const p=await M.buildConvertPreview(f,args);
    assert.deepEqual(p.items.map(i=>i.key),['PM-1']);
    assert.deepEqual(p.hasSubtasks.map(i=>i.key),['PM-2']);
    assert.deepEqual(p.isTarget.map(i=>i.key),['PM-37193']);
    assert.deepEqual(p.excluded.map(i=>i.key),['PM-3']);
    assert.deepEqual(p.subtaskType,{id:'10003',name:'Sub-task',count:1});
    assert.equal(p.items[0].fromTypeId,'10001');
    assert.match(decodeURIComponent(f.calls.find(c=>c.path.includes('search/jql')).path),/parent = PM-34403 AND issuetype in standardIssueTypes\(\)/);
    assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('buildConvertPreview: 기준이 에픽이 아니거나 대상이 에픽이면 거부', async () => {
    const f1=mockJira(convertRoutes({searchIssues:[],epic:tgt('PM-34403','Task')}));
    await assert.rejects(M.buildConvertPreview(f1,args),/에픽 기준에서만/);
    const f2=mockJira(convertRoutes({searchIssues:[],targetType:'Epic'}));
    await assert.rejects(M.buildConvertPreview(f2,args),/에픽입니다/);
});

test('buildConvertPreview: 프로젝트 불일치 시 중단', async () => {
    const other=epicInfo();other.fields.project={key:'XX',id:'1'};
    const f=mockJira(convertRoutes({searchIssues:[],epic:other}));
    await assert.rejects(M.buildConvertPreview(f,args),/프로젝트 불일치/);
});

test('fetchSubtaskType: 서브태스크 유형이 없으면 오류', async () => {
    const f=mockJira([[isTypes,()=>res(200,[{id:'1',name:'Task',subtask:false}])]]);
    await assert.rejects(M.fetchSubtaskType(f,'10000'),/서브태스크 이슈 유형이 없습니다/);
});

function convPreview(keys){
    return{items:keys.map(k=>({key:k,summary:'s',fromParent:'PM-34403',fromTypeId:'10001',fromTypeName:'Task',toParent:'PM-37193'})),
        target:{key:'PM-37193',project:'PM'},subtaskType:{id:'10003',name:'Sub-task'}};
}
const isBulkPost=(p,o)=>p==='/rest/api/3/bulk/issues/move'&&o.method==='POST';
const isQueue=p=>p.startsWith('/rest/api/3/bulk/queue/');
const isVerify=(p,o)=>p.includes('?fields=parent,issuetype')&&!o.method;

test('executeConvert: 로그 선저장 → 벌크 요청(키 형식) → 폴링 → 재조회 검증', async () => {
    let polls=0;
    const f=mockJira([
        [isBulkPost,()=>res(201,{taskId:'77'})],
        [isQueue,()=>res(200,{status:++polls<2?'RUNNING':'COMPLETE'})],
        [isVerify,()=>res(200,{fields:{issuetype:{subtask:true},parent:{key:'PM-37193'}}})]
    ]);
    const saved=[];
    const rep=await M.executeConvert(f,convPreview(['PM-1','PM-2']),{sourceKey:'PM-34403',keyword:'k',sleep:sleep0,saveLog:async e=>saved.push(JSON.parse(JSON.stringify(e)))});
    assert.equal(rep.success,2);assert.equal(rep.failed,0);
    assert.ok(saved[0].items.every(i=>i.status==='pending'&&i.fromTypeId==='10001'&&i.fromParent==='PM-34403'),'변환 전 원래 유형/에픽 로그');
    assert.equal(saved[0].mode,'convert');
    const body=JSON.parse(f.calls.find(c=>c.method==='POST').body);
    assert.deepEqual(Object.keys(body.targetToSourcesMapping),['PM,10003,PM-37193']);
    assert.deepEqual(body.targetToSourcesMapping['PM,10003,PM-37193'].issueIdsOrKeys,['PM-1','PM-2']);
    assert.equal(body.sendBulkNotification,false);
    assert.equal(polls,2);
});

test('executeConvert: 벌크 완료 후에도 반영 안 되면 실패로 보고', async () => {
    const f=mockJira([
        [isBulkPost,()=>res(201,{taskId:'1'})],[isQueue,()=>res(200,{status:'COMPLETE'})],
        [isVerify,()=>res(200,{fields:{issuetype:{subtask:false},parent:{key:'PM-34403'}}})]
    ]);
    const rep=await M.executeConvert(f,convPreview(['PM-1']),{sleep:sleep0});
    assert.equal(rep.failed,1);assert.match(rep.errors[0].error,/반영되지 않았습니다/);
});

test('executeConvert: 403 은 벌크 권한 안내, 전체 실패 처리', async () => {
    const f=mockJira([[isBulkPost,()=>res(403,{})]]);
    const rep=await M.executeConvert(f,convPreview(['PM-1','PM-2']),{sleep:sleep0});
    assert.equal(rep.failed,2);assert.match(rep.errors[0].error,/Make bulk changes/);
    assert.deepEqual(rep.entry.items.map(i=>i.status),['failed','failed']);
});

test('waitBulkTask: 제한 시간 초과 시 오류', async () => {
    const f=mockJira([[isQueue,()=>res(200,{status:'RUNNING'})]]);
    await assert.rejects(M.waitBulkTask(f,'9',{sleep:sleep0,maxTries:3}),/제한 시간/);
    assert.equal(f.calls.length,3);
});

test('undoConvert: 원래 유형+에픽으로 벌크 이동 후 검증, moved 아닌 항목은 건너뜀', async () => {
    const f=mockJira([
        [isBulkPost,()=>res(201,{taskId:'5'})],[isQueue,()=>res(200,{status:'COMPLETE'})],
        [isVerify,()=>res(200,{fields:{issuetype:{id:'10001',subtask:false},parent:{key:'PM-34403'}}})]
    ]);
    const entry={project:'PM',items:[
        {key:'PM-1',fromParent:'PM-34403',fromTypeId:'10001',status:'moved'},
        {key:'PM-2',fromParent:'PM-34403',fromTypeId:'10001',status:'failed'}
    ]};
    const rep=await M.undoConvert(f,entry,{sleep:sleep0});
    assert.equal(rep.success,1);assert.equal(rep.skipped,1);
    assert.equal(entry.items[0].status,'undone');
    assert.deepEqual(Object.keys(JSON.parse(f.calls.find(c=>c.method==='POST').body).targetToSourcesMapping),['PM,10001,PM-34403']);
});

// ================= 직접 선택(keys) 모드 =================
const issue=(key,{subtask=false,type='Task',project='PM',parent,subtasks=0,summary='s'+key,typeId=subtask?'10003':'10001',level}={})=>({key,fields:{summary,project:{key:project,id:'10000'},
    issuetype:{id:typeId,name:subtask?'Sub-task':type,subtask,hierarchyLevel:level??(type==='Epic'?1:subtask?-1:0)},
    ...(parent?{parent:{key:parent}}:{}),subtasks:Array.from({length:subtasks},(_,i)=>({key:key+'-s'+i}))}});
const byKey=map=>Object.keys(map).map(k=>[(p,o)=>p.startsWith(`/rest/api/3/issue/${k}?`)&&!o.method,()=>map[k]===null?res(404,{}):res(200,map[k])]);

test('searchIssueCandidates: kind=subtask 는 subTaskIssueTypes, kind=task 는 에픽 제외', async () => {
    const jqls=[];
    const f=async p=>{
        jqls.push(decodeURIComponent(p.split('jql=')[1].split('&')[0]));
        return res(200,{issues:[
            {key:'PM-1',fields:{summary:'a',issuetype:{name:'Task',hierarchyLevel:0}}},
            {key:'PM-2',fields:{summary:'b',issuetype:{name:'Epic',hierarchyLevel:1}}}
        ]});
    };
    const t=await M.searchIssueCandidates(f,'abc','PM','task');
    assert.deepEqual(t.map(x=>x.value),['PM-1']);
    await M.searchIssueCandidates(f,'abc','PM','subtask');
    assert.ok(jqls.some(j=>j.includes('subTaskIssueTypes()')));
    assert.ok(jqls.slice(0,1).every(j=>j.includes('standardIssueTypes()')));
});

test('buildPreview(keys): 서브태스크만 대상, 비서브태스크/없는 키/이미 대상 부모 아래 분리', async () => {
    const f=mockJira(byKey({
        'PM-1':issue('PM-1',{subtask:true,parent:'PM-10'}),
        'PM-2':issue('PM-2',{subtask:true,parent:'PM-37193'}),
        'PM-3':issue('PM-3'),
        'PM-4':null,
        'PM-37193':tgt()
    }));
    const p=await M.buildPreview(f,{keys:['PM-1','PM-2','PM-3','PM-4'],targetParentKey:'PM-37193'});
    assert.deepEqual(p.items.map(i=>i.key),['PM-1']);
    assert.deepEqual(p.alreadyThere.map(i=>i.key),['PM-2']);
    assert.deepEqual(p.invalid.map(i=>i.key),['PM-3']);
    assert.deepEqual(p.missing,['PM-4']);
    assert.equal(p.source.manual,true);
    assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('buildPreview(keys): 중복 키는 한 번만, 프로젝트 불일치 시 중단', async () => {
    const f=mockJira(byKey({'PM-1':issue('PM-1',{subtask:true,parent:'PM-10'}),'XX-9':issue('XX-9',{subtask:true,project:'XX',parent:'XX-1'}),'PM-37193':tgt()}));
    const p=await M.buildPreview(f,{keys:['PM-1','PM-1'],targetParentKey:'PM-37193'});
    assert.equal(p.items.length,1);
    await assert.rejects(M.buildPreview(f,{keys:['XX-9'],targetParentKey:'PM-37193'}),/프로젝트 불일치/);
});

test('buildConvertPreview(keys): 에픽 없이 직접 지정한 태스크 변환, 부적합 항목 분리', async () => {
    const f=mockJira([
        ...byKey({
            'PM-1':issue('PM-1',{parent:'PM-34403'}),
            'PM-2':issue('PM-2'),                       // 에픽 없는 태스크
            'PM-3':issue('PM-3',{subtasks:2}),
            'PM-4':issue('PM-4',{subtask:true,parent:'PM-5'}),
            'PM-5':issue('PM-5',{type:'Epic'}),
            'PM-6':null,
            'PM-37193':tgt()
        }),
        [isTypes,()=>res(200,SUBTYPES)]
    ]);
    const p=await M.buildConvertPreview(f,{keys:['PM-1','PM-2','PM-3','PM-4','PM-5','PM-6','PM-37193'],targetParentKey:'PM-37193'});
    assert.deepEqual(p.items.map(i=>i.key),['PM-1','PM-2']);
    assert.equal(p.items[1].fromParent,'');
    assert.deepEqual(p.hasSubtasks.map(i=>i.key),['PM-3']);
    assert.deepEqual(p.invalid.map(i=>i.key+':'+i.reason),['PM-4:이미 서브태스크','PM-5:에픽은 변환 불가']);
    assert.deepEqual(p.isTarget.map(i=>i.key),['PM-37193']);
    assert.deepEqual(p.missing,['PM-6']);
    assert.equal(p.subtaskType.id,'10003');
    assert.equal(p.mode,'convert');
    assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('buildConvertPreview(keys): 대상이 에픽이면 거부, 프로젝트 불일치 시 중단, 기준 에픽 검증은 생략', async () => {
    const f1=mockJira(byKey({'PM-1':issue('PM-1'),'PM-37193':tgt('PM-37193','Epic')}));
    await assert.rejects(M.buildConvertPreview(f1,{keys:['PM-1'],targetParentKey:'PM-37193'}),/에픽입니다/);
    const f2=mockJira([...byKey({'XX-1':issue('XX-1',{project:'XX'}),'PM-37193':tgt()}),[isTypes,()=>res(200,SUBTYPES)]]);
    await assert.rejects(M.buildConvertPreview(f2,{keys:['XX-1'],targetParentKey:'PM-37193'}),/프로젝트 불일치/);
});

test('buildConvertPreview(에픽 기준): 에픽이 아니면 직접 선택 안내 문구 포함', async () => {
    const f=mockJira(convertRoutes({searchIssues:[],epic:tgt('PM-34403','Task')}));
    await assert.rejects(M.buildConvertPreview(f,args),/직접 선택/);
});

// ================= 키워드 선택 / 조회 목록 / 조회 결과 그대로 검증 =================
test('buildSearchJql: 키워드를 비우면 summary 조건 없이 전체 조회', () => {
    assert.equal(M.buildSearchJql('PM-1','',true),'parentEpic = PM-1 AND issuetype in subTaskIssueTypes()');
    assert.equal(M.buildSearchJql('PM-1','  ',false),'parent = PM-1 AND issuetype in subTaskIssueTypes()');
});

test('listCandidates(move): 키워드 없이 에픽 아래 서브태스크 전체', async () => {
    const f=mockJira([
        [isIssueGet('PM-34403'),()=>res(200,src('PM-34403','Epic'))],
        [isSearch,()=>res(200,{issues:[sub('PM-1','사운드','PM-10'),sub('PM-2','BGM','PM-11')],isLast:true})]
    ]);
    const r=await M.listCandidates(f,{mode:'move',sourceKey:'PM-34403',keyword:''});
    assert.deepEqual(r.issues.map(i=>i.key),['PM-1','PM-2']);
    assert.equal(r.source.isEpic,true);
    assert.doesNotMatch(decodeURIComponent(f.calls.find(c=>c.path.includes('search/jql')).path),/summary ~/);
});

test('listCandidates(move): 키워드가 있으면 2차 필터 적용', async () => {
    const f=mockJira([
        [isIssueGet('PM-50'),()=>res(200,src('PM-50','Task'))],
        [isSearch,()=>res(200,{issues:[sub('PM-1','사운드','PM-50'),sub('PM-2','사 운드','PM-50')],isLast:true})]
    ]);
    const r=await M.listCandidates(f,{mode:'move',sourceKey:'PM-50',keyword:'사운드'});
    assert.deepEqual(r.issues.map(i=>i.key),['PM-1']);
    assert.deepEqual(r.excluded.map(i=>i.key),['PM-2']);
    assert.match(decodeURIComponent(f.calls.find(c=>c.path.includes('search/jql')).path),/parent = PM-50 AND/);
});

test('listCandidates(convert): 에픽 아래 태스크, 에픽이 아니면 거부', async () => {
    const f=mockJira([
        [isIssueGet('PM-34403'),()=>res(200,src('PM-34403','Epic'))],
        [isSearch,()=>res(200,{issues:[task('PM-1','a','PM-34403'),task('PM-2','b','PM-34403',{subtasks:1})],isLast:true})]
    ]);
    const r=await M.listCandidates(f,{mode:'convert',sourceKey:'PM-34403',keyword:''});
    assert.deepEqual(r.issues.map(i=>i.key),['PM-1','PM-2']);
    assert.match(decodeURIComponent(f.calls.find(c=>c.path.includes('search/jql')).path),/parent = PM-34403 AND issuetype in standardIssueTypes\(\)&maxResults/);
    const f2=mockJira([[isIssueGet('PM-9'),()=>res(200,src('PM-9','Task'))]]);
    await assert.rejects(M.listCandidates(f2,{mode:'convert',sourceKey:'PM-9',keyword:''}),/에픽 기준에서만/);
});

test('loadManualIssue: 모드에 맞는 티켓만 허용', async () => {
    const f=mockJira(byKey({'PM-1':issue('PM-1',{subtask:true,parent:'PM-5'}),'PM-2':issue('PM-2'),'PM-3':issue('PM-3',{type:'Epic'}),'PM-4':null}));
    assert.ok((await M.loadManualIssue(f,'PM-1','move')).issue);
    assert.match((await M.loadManualIssue(f,'PM-2','move')).error,/서브태스크가 아닙니다/);
    assert.ok((await M.loadManualIssue(f,'PM-2','convert')).issue);
    assert.match((await M.loadManualIssue(f,'PM-1','convert')).error,/이미 서브태스크/);
    assert.match((await M.loadManualIssue(f,'PM-3','convert')).error,/에픽/);
    assert.match((await M.loadManualIssue(f,'PM-4','move')).error,/찾을 수 없습니다/);
});

test('buildPreview(issues): 조회해 둔 이슈를 재조회 없이 검증', async () => {
    const f=mockJira(byKey({'PM-37193':tgt()}));
    const p=await M.buildPreview(f,{issues:[issue('PM-1',{subtask:true,parent:'PM-10'}),issue('PM-2',{subtask:true,parent:'PM-37193'})],targetParentKey:'PM-37193'});
    assert.deepEqual(p.items.map(i=>i.key),['PM-1']);
    assert.deepEqual(p.alreadyThere.map(i=>i.key),['PM-2']);
    assert.equal(f.calls.length,1,'대상 부모 조회 1회만');
});

test('buildConvertPreview(issues): 조회해 둔 태스크 검증 + 서브태스크 유형 결정', async () => {
    const f=mockJira([...byKey({'PM-37193':tgt()}),[isTypes,()=>res(200,SUBTYPES)]]);
    const p=await M.buildConvertPreview(f,{issues:[issue('PM-1',{parent:'PM-34403'}),issue('PM-3',{subtasks:1})],targetParentKey:'PM-37193'});
    assert.deepEqual(p.items.map(i=>i.key),['PM-1']);
    assert.deepEqual(p.hasSubtasks.map(i=>i.key),['PM-3']);
    assert.equal(p.subtaskType.id,'10003');
    assert.equal(f.calls.filter(c=>c.path.includes('/issue/PM-1')).length,0);
});

test('searchIssueCandidates: 프로젝트가 지정되면 모든 검색에 project 조건이 붙는다', async () => {
    const jqls=[];
    const f=async p=>{jqls.push(decodeURIComponent(p.split('jql=')[1].split('&')[0]));return res(200,{issues:[]});};
    await M.searchIssueCandidates(f,'사운드','PM');
    await M.searchIssueCandidates(f,'34403','PM','subtask');
    assert.equal(jqls.length,3);
    assert.ok(jqls.every(j=>j.startsWith('project = "PM" AND ')));
});
