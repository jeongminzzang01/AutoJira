const test=require('node:test');
const assert=require('node:assert/strict');
const logger=require('../lib/logger.js');

test('logger: 기본 메서드 존재', () => {
    ['debug','info','warn','error','recent','byLevel','clear','dump'].forEach(k=>{
        assert.equal(typeof logger[k],'function',`logger.${k} should be function`);
    });
});

test('logger: 버퍼에 누적', () => {
    logger.clear();
    logger.warn('test warn 1');
    logger.error('test err 1');
    logger.info('test info 1');
    const all=logger.recent();
    assert.equal(all.length,3);
    assert.equal(all[0].level,'warn');
    assert.equal(all[1].level,'error');
    assert.equal(all[2].level,'info');
});

test('logger: byLevel 필터', () => {
    logger.clear();
    logger.warn('w1');logger.error('e1');logger.warn('w2');
    assert.equal(logger.byLevel('warn').length,2);
    assert.equal(logger.byLevel('error').length,1);
});

test('logger: recent(n) 최근 N건', () => {
    logger.clear();
    for(let i=0;i<10;i++)logger.warn('msg'+i);
    const recent3=logger.recent(3);
    assert.equal(recent3.length,3);
    assert.match(recent3[2].msg,/msg9/);
});

test('logger: 버퍼 200건 상한', () => {
    logger.clear();
    for(let i=0;i<300;i++)logger.warn('m'+i);
    assert.equal(logger.recent().length,200);
    // 가장 오래된 100건은 잘림
    assert.match(logger.recent()[0].msg,/m100/);
});

test('logger: Error 객체 처리', () => {
    logger.clear();
    logger.error(new Error('test error'));
    const all=logger.recent();
    assert.match(all[0].msg,/test error/);
});

test('logger: dump 텍스트 출력', () => {
    logger.clear();
    logger.warn('hello');
    const txt=logger.dump();
    assert.match(txt,/\[warn\] hello/);
    assert.match(txt,/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
});
