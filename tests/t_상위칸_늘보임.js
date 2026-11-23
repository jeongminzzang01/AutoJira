/* 상위 티켓 칸이 하위 작업 줄 없이도 보이는지.
 *
 * 여태는 하위 작업 줄을 먼저 넣어야 이 칸이 나타났다. 사람은 '어느 티켓 밑에
 * 달 건가' 를 먼저 정하고 줄을 넣는데, 칸이 안 보이니 줄부터 넣고 그제야
 * 위로 다시 올라가 채워야 했다.
 */
const puppeteer = require('C:/Users/newny/AppData/Roaming/npm/node_modules/puppeteer');
let 통과 = 0; const 실패 = [];
const 봐 = (n, c, d) => { if (c) { 통과++; console.log('  OK  ' + n); } else { 실패.push(n); console.log('  ×   ' + n + (d !== undefined ? '  → ' + JSON.stringify(d) : '')); } };
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const 터짐 = [];
  p.on('pageerror', (e) => 터짐.push(String(e).split('\n')[0].slice(0, 180)));
  await p.setViewport({ width: 1400, height: 1000 });
  await p.goto('http://127.0.0.1:9000/p/autojira/', { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => openJiraCreate());
  await new Promise((r) => setTimeout(r, 2500));

  const 처음 = await p.evaluate(() => {
    const g = document.getElementById('jcNewParentGroup');
    return { 보임: getComputedStyle(g).display !== 'none', 안내: document.getElementById('jcNewParentHint')?.textContent || '' };
  });
  console.log('하위 줄 없을 때:', JSON.stringify(처음));
  봐('하위 작업 줄이 없어도 상위 칸이 보인다', 처음.보임 === true, 처음);
  봐('아직 안 붙는다고 알려 준다', /Sub-task 로 고른 줄에만/.test(처음.안내), 처음.안내);

  // 줄을 하나 넣고 Sub-task 로
  const 뒤 = await p.evaluate(() => {
    if (typeof addJcTaskRow === 'function') addJcTaskRow('multi');
    if (typeof setJcRowType === 'function') setJcRowType(0, 'Sub-task');
    return { 보임: getComputedStyle(document.getElementById('jcNewParentGroup')).display !== 'none',
             안내: document.getElementById('jcNewParentHint')?.textContent || '' };
  });
  console.log('Sub-task 줄을 넣은 뒤:', JSON.stringify(뒤));
  봐('Sub-task 줄을 넣으면 함께 붙는다고 바뀐다', /함께 붙습니다/.test(뒤.안내), 뒤.안내);
  봐('화면에서 터진 것이 없다', 터짐.length === 0, 터짐.slice(0, 3));

  await b.close();
  console.log(`\n통과 ${통과} · 실패 ${실패.length}`);
  process.exit(실패.length ? 1 : 0);
})().catch((e) => { console.error('탈남:', e.message); process.exit(2); });
