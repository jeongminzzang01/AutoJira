/* 정기점검 생성 — 다시 눌러도 두 벌 안 만드는지, ⚡ 빌드 에픽 생성이 목록을 안 지우는지.
 *
 * 지라는 부르지 않는다. 지라 검색 결과 꼴의 가짜 자료로 순수 함수만 본다.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const U=require('../lib/utils.js');

// 지라 /search/jql 결과 꼴
const issue=(key,summary,typeName,{parent,subtasks,subtask}={})=>({
    key,
    fields:{
        summary,
        issuetype:{name:typeName,...(subtask!==undefined?{subtask}:{})},
        ...(parent?{parent:{key:parent}}:{}),
        ...(subtasks?{subtasks:subtasks.map(([k,s])=>({key:k,fields:{summary:s}}))}:{}),
    },
});

test('flattenIssuesForMaint: 한국어 유형 이름과 subtasks 칸을 함께 읽는다', () => {
    const flat=U.flattenIssuesForMaint([
        issue('PM-1','[M41] 6/11 1차 빌드_260608','에픽'),
        issue('PM-2','[M41] 상품','작업',{subtasks:[['PM-3','[M41] 유료화 상품']]}),
        issue('PM-4','[M41] 이벤트 리소스','하위 작업',{parent:'PM-9',subtask:true}),
    ]);
    assert.deepEqual(flat.map(x=>[x.key,x.type,x.parentKey]),[
        ['PM-1','Epic',''],['PM-2','Task',''],['PM-3','Sub-task','PM-2'],['PM-4','Sub-task','PM-9'],
    ]);
});

const want={
    epics:[{summary:'[M41] 6/11 1차 서버 빌드_260608'},{summary:'[M41] 6/11 2차 서버 빌드_260609'}],
    tasks:[
        {summary:'[M41] 상품',subs:[{summary:'[M41] 유료화 상품'},{summary:'[M41] 이벤트 상품'}]},
        {summary:'[M41] 이벤트',subs:[{summary:'[M41] 이벤트 리소스'}]},
        {summary:'[M41] 정기점검 공지용 확률 갱신',subs:[]},
    ],
};

test('처음 누를 때: 아무것도 없으면 전부 새로 만든다', () => {
    const plan=U.planMaintCreation(want,[]);
    assert.ok(plan.epics.every(e=>!e.existingKey&&!e.dupInRun));
    assert.ok(plan.tasks.every(t=>!t.existingKey&&t.subs.every(s=>!s.existingKey)));
});

test('다시 누를 때: 이미 만든 것은 전부 「이미 있음」 — 새로 만들 것이 없다', () => {
    const existing=U.flattenIssuesForMaint([
        issue('PM-10','[M41] 6/11 1차 서버 빌드_260608','Epic'),
        issue('PM-11','[M41] 6/11 2차 서버 빌드_260609','Epic'),
        issue('PM-20','[M41] 상품','Task',{subtasks:[['PM-21','[M41] 유료화 상품'],['PM-22','[M41] 이벤트 상품']]}),
        issue('PM-30','[M41] 이벤트','Task',{subtasks:[['PM-31','[M41] 이벤트 리소스']]}),
        issue('PM-40','[M41] 정기점검 공지용 확률 갱신','Task'),
    ]);
    const plan=U.planMaintCreation(want,existing);
    assert.deepEqual(plan.epics.map(e=>e.existingKey),['PM-10','PM-11']);
    assert.deepEqual(plan.tasks.map(t=>t.existingKey),['PM-20','PM-30','PM-40']);
    assert.deepEqual(plan.tasks[0].subs.map(s=>s.existingKey),['PM-21','PM-22']);
});

test('반쯤 만들고 멈춘 뒤 다시 누를 때: 있는 Task 밑에 빠진 Sub-task 만 만든다', () => {
    const existing=U.flattenIssuesForMaint([
        issue('PM-20','[M41] 상품','작업',{subtasks:[['PM-21','[M41] 유료화 상품']]}),
    ]);
    const plan=U.planMaintCreation(want,existing);
    assert.equal(plan.tasks[0].existingKey,'PM-20');
    assert.deepEqual(plan.tasks[0].subs.map(s=>s.existingKey),['PM-21',null]);
    assert.equal(plan.tasks[1].existingKey,null);
});

test('Sub-task 는 같은 상위 밑에서만 짝짓는다 — 다른 Task 밑의 같은 제목은 남의 것', () => {
    const existing=U.flattenIssuesForMaint([
        issue('PM-20','[M41] 상품','Task'),
        issue('PM-99','[M41] 유료화 상품','Sub-task',{parent:'PM-77',subtask:true}),
    ]);
    const plan=U.planMaintCreation(want,existing);
    assert.equal(plan.tasks[0].subs[0].existingKey,null);
});

test('유형이 다르면 같은 제목이라도 짝이 아니다, 공백 차이는 무시한다', () => {
    const existing=U.flattenIssuesForMaint([
        issue('PM-50','[M41] 상품','Epic'),
        issue('PM-51','  [M41]  이벤트 ','Task'),
    ]);
    const plan=U.planMaintCreation(want,existing);
    assert.equal(plan.tasks[0].existingKey,null);
    assert.equal(plan.tasks[1].existingKey,'PM-51');
});

test('이번 목록 안에서 같은 제목이 또 나오면 뒤엣것은 만들지 않는다', () => {
    const plan=U.planMaintCreation({epics:[{summary:'A'},{summary:'A'}],tasks:[{summary:'T',subs:[{summary:'s'},{summary:'s'}]}]},[]);
    assert.deepEqual(plan.epics.map(e=>e.dupInRun),[false,true]);
    assert.deepEqual(plan.tasks[0].subs.map(s=>s.dupInRun),[false,true]);
});

const 데이터패치='서버 / AOS, iOS, PC, OneStore 데이터 패치 빌드';

test('⚡ 빌드 에픽 생성: 빈 목록이면 1~3차 셋', () => {
    const r=U.fillDefaultMaintEpics([],{label:데이터패치,version:'M41_260611'});
    assert.deepEqual(r.items.map(x=>x.ordinal),[1,2,3]);
    assert.ok(r.items.every(x=>x.label===데이터패치&&x.checked&&x.version==='M41_260611'));
});

test('⚡ 빌드 에픽 생성: 불러온 기존 에픽과 더한 줄은 그대로 두고 빈 차수만 더한다', () => {
    const before=[
        {existing:true,jiraKey:'PM-10',ordinal:1,label:데이터패치},
        {existing:true,jiraKey:'PM-11',ordinal:null,label:'차수 없는 에픽'},
        {label:'PC/AOS/OneStore App 빌드',ordinal:3,checked:true},
    ];
    const r=U.fillDefaultMaintEpics(before,{label:데이터패치});
    assert.equal(r.items.length,4);
    assert.deepEqual(r.items.slice(0,3),before);          // 있던 줄은 그대로, 그 순서대로
    assert.deepEqual(r.added.map(x=>x.ordinal),[2]);
    assert.deepEqual(r.skipped,[1,3]);
});

test('⚡ 빌드 에픽 생성: 두 번 눌러도 같은 에픽이 또 생기지 않는다', () => {
    const once=U.fillDefaultMaintEpics([],{label:데이터패치}).items;
    const twice=U.fillDefaultMaintEpics(once,{label:데이터패치});
    assert.equal(twice.items.length,3);
    assert.deepEqual(twice.added,[]);
});
