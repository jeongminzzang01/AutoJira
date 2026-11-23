/* 목록에서 고른 상위 티켓이 칸에 남는지.
 *
 * 검색은 됐고 목록도 떴는데, 누르면 칸이 빈 채로 남고 다른 데를 누르는 순간
 * 고른 티켓이 통째로 사라졌다.
 *
 *   makeAutocomplete 는 onSelect 가 false 를 돌려주면 '칸을 비워 달라' 로 읽는다.
 *   태그를 쌓는 칸(컴포넌트·레이블·와쳐)을 위한 약속인데, 상위 티켓이 그걸
 *   그대로 쓰고 있었다. 칸이 비면 blur 때 도는 상위맞추기가 '적힌 키가 없다'
 *   고 보고 숨은 키까지 지운다.
 *
 *     누른 직후   보이는값 ''   숨은키 PM-35264
 *     blur 뒤     보이는값 ''   숨은키 ''        ← 사라진다
 *
 * blur 까지 가 본다. 누른 직후만 보면 이 탈은 안 잡힌다.
 */
const puppeteer = require('C:/Users/newny/AppData/Roaming/npm/node_modules/puppeteer');
const BASE = 'http://127.0.0.1:9000/p/autojira/';
const 찾을말 = '35264';

let 통과 = 0; const 실패 = [];
const 봐 = (이름, 조건, 덧) => {
  if (조건) { 통과++; console.log('  OK  ' + 이름); }
  else { 실패.push(이름); console.log('  ×   ' + 이름 + (덧 !== undefined ? '  → ' + JSON.stringify(덧) : '')); }
};
const 칸보기 = (p) => p.evaluate(() => ({
  보이는값: document.getElementById('jcNewParent').value,
  숨은키: document.getElementById('jcNewParentKey').value,
}));

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const 터짐 = [];
  p.on('pageerror', (e) => 터짐.push(String(e).split('\n')[0].slice(0, 170)));
  await p.setViewport({ width: 1400, height: 1000 });
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => openJiraCreate());
  await new Promise((r) => setTimeout(r, 2500));

  await p.evaluate((q) => {
    const e = document.getElementById('jcNewParent');
    e.focus(); e.value = q;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, 찾을말);
  await new Promise((r) => setTimeout(r, 4000));

  const 목록 = await p.evaluate(() => [...document.querySelectorAll('.ac-box .ac-item[data-val]')].map((x) => x.textContent));
  봐('번호만 쳐도 목록이 뜬다', 목록.length > 0, 목록);
  if (!목록.length) { await b.close(); process.exit(1); }

  await p.evaluate(() => {
    document.querySelector('.ac-box .ac-item[data-val]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const 누른뒤 = await 칸보기(p);
  봐('누르면 고른 티켓이 칸에 남는다', /^\[[A-Z]+-\d+\]/.test(누른뒤.보이는값), 누른뒤);
  봐('숨은 키가 찬다', /^[A-Z]+-\d+$/.test(누른뒤.숨은키), 누른뒤);

  await p.evaluate(() => document.getElementById('jcNewParent').dispatchEvent(new Event('blur', { bubbles: true })));
  await new Promise((r) => setTimeout(r, 2500));
  const blur뒤 = await 칸보기(p);
  봐('다른 데를 눌러도 안 사라진다 (보이는 값)', blur뒤.보이는값 === 누른뒤.보이는값, blur뒤);
  봐('다른 데를 눌러도 안 사라진다 (숨은 키)', blur뒤.숨은키 === 누른뒤.숨은키, blur뒤);

  // 칸을 지우면 키도 같이 지워져야 한다 — 남아 있으면 엉뚱한 상위에 붙는다
  await p.evaluate(() => {
    const e = document.getElementById('jcNewParent');
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('blur', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const 지운뒤 = await 칸보기(p);
  봐('칸을 지우면 숨은 키도 지워진다', 지운뒤.숨은키 === '', 지운뒤);

  봐('화면에서 터진 것이 없다', 터짐.length === 0, 터짐.slice(0, 3));

  await b.close();
  console.log(`\n통과 ${통과} · 실패 ${실패.length}`);
  실패.forEach((x) => console.log('  · ' + x));
  process.exit(실패.length ? 1 : 0);
})().catch((e) => { console.error('검사가 탈났습니다:', e.message); process.exit(2); });
