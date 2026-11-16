const test=require('node:test');
const assert=require('node:assert/strict');
const U=require('../lib/utils.js');

test('esc: HTML 이스케이프', () => {
    assert.equal(U.esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
    assert.equal(U.esc(null), '');
    assert.equal(U.esc(123), '123');
});

test('stripHtml: 태그 제거 + 공백 정규화', () => {
    assert.equal(U.stripHtml('<p>hello\n  world</p>'), 'hello world');
    assert.equal(U.stripHtml(null), '');
});

test('parseJiraErrorMsg: 정상 JSON 처리', () => {
    const j='{"errorMessages":[],"errors":{"summary":"필수 입력입니다"}}';
    assert.match(U.parseJiraErrorMsg(j,'Task','PM-1'), /summary: 필수 입력/);
});

test('parseJiraErrorMsg: parentId 계층 오류 친절 메시지', () => {
    const j='{"errorMessages":[],"errors":{"parentId":"해당 상위 업무 항목은 적절한 계층 구조에 속하지 않습니다."}}';
    const r=U.parseJiraErrorMsg(j,'Sub-task','PM-100');
    assert.match(r, /상위\(PM-100\)에 Sub-task을\(를\) 자식으로 둘 수 없습니다/);
});

test('parseJiraErrorMsg: 비-JSON 텍스트는 잘라서 반환', () => {
    const r=U.parseJiraErrorMsg('Bad request: '+'x'.repeat(500),'Task','PM-1');
    assert.ok(r.length<=200);
});

test('formatDraftAge: 시간대별 표시', () => {
    const now=Date.parse('2026-01-01T12:00:00Z');
    assert.equal(U.formatDraftAge(now,now),'방금 전');
    assert.equal(U.formatDraftAge(now-30*60000,now),'30분 전');
    assert.equal(U.formatDraftAge(now-3*3600*1000,now),'3시간 전');
    assert.equal(U.formatDraftAge(now-2*86400000,now),'2일 전');
});

test('ensureMilestonePrefix: 없을 때만 추가', () => {
    assert.equal(U.ensureMilestonePrefix('서버 빌드','M39'),'[M39] 서버 빌드');
    // 이미 마일스톤 태그 있으면 그대로 보존 (다른 마일스톤이라도)
    assert.equal(U.ensureMilestonePrefix('[M40] 서버 빌드','M39'),'[M40] 서버 빌드');
    assert.equal(U.ensureMilestonePrefix('[M39] 서버 빌드','M39'),'[M39] 서버 빌드');
    // milestone 없으면 그대로
    assert.equal(U.ensureMilestonePrefix('서버 빌드',''),'서버 빌드');
});

test('buildFullTitle: 마일스톤 태그 전파', () => {
    assert.equal(U.buildFullTitle('[M39] 정기점검','상품 데이터'),'[M39] 상품 데이터');
    assert.equal(U.buildFullTitle('정기점검','상품 데이터'),'상품 데이터');
    // 이미 키 형태면 그대로
    assert.equal(U.buildFullTitle('[M39] 정기점검','[PM-123] 다른 작업'),'[PM-123] 다른 작업');
});

test('ordinalToDayOffset: 차수 → Mon/Tue/Wed', () => {
    assert.equal(U.ordinalToDayOffset(1),0); // Mon
    assert.equal(U.ordinalToDayOffset(2),1); // Tue
    assert.equal(U.ordinalToDayOffset(3),2); // Wed
    assert.equal(U.ordinalToDayOffset(4),2); // 4차+ → Wed (3차 따라옴)
    assert.equal(U.ordinalToDayOffset(99),2);
    assert.equal(U.ordinalToDayOffset(0),0); // edge: 0 → 1차로 처리
    assert.equal(U.ordinalToDayOffset(null),0);
});

test('extractOrdinalFromSummary: Jira 제목에서 차수 추출', () => {
    assert.equal(U.extractOrdinalFromSummary('[M39] 5/13 1차 서버 빌드'),1);
    assert.equal(U.extractOrdinalFromSummary('[M39] 5/13 12차 서버 빌드'),12);
    assert.equal(U.extractOrdinalFromSummary('[M39] 카드 시스템'),null);
    assert.equal(U.extractOrdinalFromSummary(''),null);
    assert.equal(U.extractOrdinalFromSummary(null),null);
});

test('allowedChildTypes: 부모 타입별 허용 자식', () => {
    assert.deepEqual(U.allowedChildTypes('Epic'),['Task','Story','Bug']);
    assert.deepEqual(U.allowedChildTypes('Task'),['Sub-task']);
    assert.deepEqual(U.allowedChildTypes('Story'),['Sub-task']);
    assert.deepEqual(U.allowedChildTypes('Sub-task'),[]);
    assert.deepEqual(U.allowedChildTypes(''),['Task','Sub-task']);
});

test('correctChildType: 잘못된 조합 자동 보정', () => {
    assert.equal(U.correctChildType('Epic','Task'),'Task'); // 이미 OK
    assert.equal(U.correctChildType('Epic','Sub-task'),'Task'); // 보정
    assert.equal(U.correctChildType('Task','Task'),'Sub-task'); // Task 자식엔 Sub-task
    assert.equal(U.correctChildType('Task','Sub-task'),'Sub-task'); // 이미 OK
    assert.equal(U.correctChildType('Sub-task','Task'),null); // Sub-task엔 자식 불가
});

test('normalizeIssueType: 한국어 Jira issuetype 정규화', () => {
    assert.equal(U.normalizeIssueType('에픽'),'Epic');
    assert.equal(U.normalizeIssueType('작업'),'Task');
    assert.equal(U.normalizeIssueType('태스크'),'Task');
    assert.equal(U.normalizeIssueType('하위 작업'),'Sub-task');
    assert.equal(U.normalizeIssueType('하위작업'),'Sub-task');
    assert.equal(U.normalizeIssueType('스토리'),'Story');
    assert.equal(U.normalizeIssueType('버그'),'Bug');
    // 영문 입력은 그대로 통과
    assert.equal(U.normalizeIssueType('Epic'),'Epic');
    assert.equal(U.normalizeIssueType('Task'),'Task');
    assert.equal(U.normalizeIssueType('Sub-task'),'Sub-task');
    // 미등록·빈값
    assert.equal(U.normalizeIssueType(''),'');
    assert.equal(U.normalizeIssueType(null),'');
    assert.equal(U.normalizeIssueType('Unknown'),'Unknown');
    // 공백 trim
    assert.equal(U.normalizeIssueType('  에픽  '),'Epic');
});
