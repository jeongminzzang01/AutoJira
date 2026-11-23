/* 상위 티켓 칸이 지라 조회를 안 기다리고 바로 사는지.
 *
 * 이 칸은 setupJcCommonAutocomplete() 의 맨 끝에 있었다. 그 함수는 맨 앞에서
 * 컴포넌트·레이블·그룹을 지라에 물어 다 받을 때까지 기다리는데, 정작 이 칸은
 * 그 셋을 하나도 안 쓴다. 그래서 지라가 느리면 그동안 칸이 죽어 있었고,
 * 중간 한 줄이 탈나면 영영 안 걸렸다 — 아무 소리도 없이.
 *
 * 조회를 일부러 9초 느리게 만들어 두고, 그동안 이 칸이 사는지 본다.
 * (컴포넌트 칸이 아직 안 걸려 있어야 '제대로 느리게 만들었다' 는 증거가 된다.)
 *
 * PM AGENT 셸(9000) 을 거쳐 본다 — 실제로 쓰는 길이 그쪽이다.
 */
const puppeteer = require('C:/Users/newny/AppData/Roaming/npm/node_modules/puppeteer');
let 통과 = 0; const 실패 = [];
const 봐 = (n, c, d) => { if (c) { 통과++; console.log('  OK  ' + n); } else { 실패.push(n); console.log('  ×   ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : '')); } };
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const 터짐 = [];
  p.on('pageerror', (e) => 터짐.push(String(e).split('\n')[0].slice(0, 180)));
  p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) 터짐.push('[c] ' + m.text().slice(0, 150)); });
  await p.setViewport({ width: 1400, height: 1000 });

  // 지라 조회를 **일부러 느리게** 만든다. 느릴 때도 상위 칸이 살아야 한다.
  await p.setRequestInterception(true);
  p.on('request', async (r) => {
    if (/components|\/label|groups\/picker/.test(r.url())) { await new Promise((x) => setTimeout(x, 9000)); }
    r.continue().catch(() => {});
  });

  await p.goto('http://127.0.0.1:9000/p/autojira/', { waitUntil: 'domcontentloaded', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => openJiraCreate());
  await new Promise((r) => setTimeout(r, 800));   // 느린 조회가 아직 안 끝난 시점

  const 이른때 = await p.evaluate(() => ({
    상위: !!document.getElementById('jcNewParent')?._setupDone,
    기존검색: !!document.getElementById('jcExistingSearch')?._setupDone,
    컴포넌트: !!document.getElementById('jcNewComp')?._setupDone,
  }));
  console.log('느린 조회가 도는 중:', JSON.stringify(이른때));
  봐('지라를 기다리지 않고 상위 티켓 칸이 산다', 이른때.상위 === true, 이른때);
  봐('기존 탭 상위 검색도 바로 산다', 이른때.기존검색 === true, 이른때);
  봐('컴포넌트 칸은 아직 기다리는 중이다 (제대로 느리게 만들었다는 증거)', 이른때.컴포넌트 === false, 이른때);

  // 키를 붙여 넣으면 숨은 칸이 차는지
  const 붙여넣기 = await p.evaluate(async () => {
    const e = document.getElementById('jcNewParent');
    e.value = 'PM-37324';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 3000));
    return { 보이는값: e.value, 숨은키: document.getElementById('jcNewParentKey').value };
  });
  console.log('키 붙여넣기:', JSON.stringify(붙여넣기));
  봐('키를 붙여 넣으면 숨은 칸이 찬다', 붙여넣기.숨은키 === 'PM-37324', 붙여넣기);
  봐('제목까지 붙어 나온다', /^\[PM-37324\]\s*\S/.test(붙여넣기.보이는값), 붙여넣기.보이는값);

  // 번호만 적어도
  const 번호만 = await p.evaluate(async () => {
    const e = document.getElementById('jcNewParent');
    document.getElementById('jcNewParentKey').value = '';
    e.value = '37324';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 3000));
    return document.getElementById('jcNewParentKey').value;
  });
  봐('번호만 적어도 알아듣는다 (37324 → PM-37324)', 번호만 === 'PM-37324', 번호만);

  await new Promise((r) => setTimeout(r, 12000));   // 느린 조회가 끝나길
  const 늦은때 = await p.evaluate(() => ({ 컴포넌트: !!document.getElementById('jcNewComp')?._setupDone }));
  봐('느린 조회가 끝나면 나머지 칸도 걸린다', 늦은때.컴포넌트 === true, 늦은때);
  봐('화면에서 터진 것이 없다', 터짐.length === 0, 터짐.slice(0, 3));

  await b.close();
  console.log(`\n통과 ${통과} · 실패 ${실패.length}`);
  process.exit(실패.length ? 1 : 0);
})().catch((e) => { console.error('탈남:', e.message); process.exit(2); });
