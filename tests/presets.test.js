/* 프리셋 합치기 — 지우거나 이름을 바꾼 것이 되살아나지 않는지.
 *
 * 전에는 서버와 화면이 이름으로 합치기만 하고 지우지를 않아서, 지운 프리셋이
 * 다시 열면 되살아났다. 이름을 바꾸면 옛 이름도 그렇게 남았다.
 * 지운 표(이름 + 지운 시각)를 같이 들고 다니게 고쳤다.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const U=require('../lib/utils.js');

const P=(name,updatedAt,extra={})=>({name,updatedAt,...extra});
const 이름들=list=>list.map(p=>p.name).sort();

test('같은 이름이면 나중에 고친 쪽, 같은 시각이면 앞 목록 쪽', () => {
    const r=U.mergePresetLists([P('a',1,{v:'서버'}),P('b',5,{v:'서버'})],[P('a',2,{v:'로컬'}),P('b',5,{v:'로컬'})]);
    assert.equal(r.find(p=>p.name==='a').v,'로컬');
    assert.equal(r.find(p=>p.name==='b').v,'서버');
});

test('지운 것은 서버에 옛 사본이 남아 있어도 되살아나지 않는다', () => {
    const server=[P('a',100),P('b',100)];
    const local=[P('b',100)];
    const r=U.reconcilePresets({presets:[server,local],deleted:[[],[{name:'a',deletedAt:200}]]});
    assert.deepEqual(이름들(r.presets),['b']);
    assert.deepEqual(r.deleted,[{name:'a',deletedAt:200}]);
});

test('updatedAt 이 없던 옛 프리셋(기본 프리셋)도 지워진다', () => {
    const r=U.reconcilePresets({presets:[[{name:'옛것'}],[]],deleted:[[{name:'옛것',deletedAt:1}]]});
    assert.deepEqual(r.presets,[]);
});

test('이름 바꾸기 = 새 이름 + 옛 이름 지움 → 옛 이름이 안 돌아온다', () => {
    const server=[P('옛 이름',100)];
    const local=[P('새 이름',300)];
    const r=U.reconcilePresets({presets:[server,local],deleted:[[],[{name:'옛 이름',deletedAt:300}]]});
    assert.deepEqual(이름들(r.presets),['새 이름']);
});

test('지운 뒤 같은 이름으로 새로 만든 것은 산다, 그 표는 버린다', () => {
    const r=U.reconcilePresets({presets:[[P('a',500)],[]],deleted:[[{name:'a',deletedAt:200}]]});
    assert.deepEqual(이름들(r.presets),['a']);
    assert.deepEqual(r.deleted,[]);
});

test('목록에 없다고 지우지 않는다 — 다른 사람이 만든 것은 남는다', () => {
    const server=[P('남이 만든 것',100),P('내 것',100)];
    const mine=[P('내 것',100)];
    const r=U.reconcilePresets({presets:[server,mine],deleted:[[],[]]});
    assert.deepEqual(이름들(r.presets),['남이 만든 것','내 것']);
});

test('지운 표끼리는 이름별로 더 늦은 시각을 둔다', () => {
    const t=U.mergePresetTombstones([{name:'a',deletedAt:5},{name:'b',deletedAt:9}],[{name:'a',deletedAt:7},{name:'',deletedAt:1},null]);
    assert.deepEqual(t.sort((x,y)=>x.name.localeCompare(y.name)),[{name:'a',deletedAt:7},{name:'b',deletedAt:9}]);
});

test('다른 브라우저의 옛 사본을 나중에 저장해도 지운 것이 안 돌아온다', () => {
    // 1) 내가 지움 → 서버에 지운 표가 남는다
    let srv=U.reconcilePresets({presets:[[P('a',100),P('b',100)],[P('b',100)]],deleted:[[],[{name:'a',deletedAt:200}]]});
    // 2) 'a' 를 아직 들고 있는 옛 탭이 목록 전체를 저장한다 (지운 표는 모른다)
    srv=U.reconcilePresets({presets:[srv.presets,[P('a',100),P('b',100)]],deleted:[srv.deleted,[]]});
    assert.deepEqual(이름들(srv.presets),['b']);
});
