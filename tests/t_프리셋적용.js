/* 프리셋을 불러오면 줄 설정이 전부 붙는지.
 *
 * 줄을 더할 때마다 addJcTaskRow 가 목록을 다시 그리는데, 그 줄의 설정은
 * **그린 뒤에** 들어간다. 그래서 늘 한 박자씩 밀렸고, 맨 마지막 줄은 영영
 * 안 보였다 (적용이 끝난 뒤 다시 그리는 데가 없었다).
 *
 *   여섯 줄짜리 프리셋 → 설정이 보이는 줄 다섯
 *
 * 지운 줄을 되살리려고 프리셋을 다시 부를 때 가장 또렷하다. 되살아난 줄이
 * 곧 마지막 줄이라, 불러왔는데 아무것도 안 들어온 것처럼 보인다.
 *
 * 그래서 **마지막 줄**과 **다시 불러오기**를 같이 본다. 첫 줄만 보면 안 잡힌다.
 */
const puppeteer = require('C:/Users/newny/AppData/Roaming/npm/node_modules/puppeteer');
const BASE = 'http://127.0.0.1:9000/p/autojira/';
const 프리셋 = '신규 서버 전용 던전';

let 통과 = 0; const 실패 = [];
const 봐 = (이름, 조건, 덧) => {
  if (조건) { 통과++; console.log('  OK  ' + 이름); }
  else { 실패.push(이름); console.log('  ×   ' + 이름 + (덧 !== undefined ? '  → ' + JSON.stringify(덧) : '')); }
};

(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const 터짐 = [];
  p.on('pageerror', (e) => 터짐.push(String(e).split('\n')[0].slice(0, 170)));
  await p.setViewport({ width: 1400, height: 1100 });
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1500));
  await p.evaluate(() => openJiraCreate());
  await new Promise((r) => setTimeout(r, 2500));

  // 줄마다 제목과 '접힌 요약' 을 본다. 요약이 곧 그 줄에 붙은 설정이다.
  const 보기 = () => p.evaluate(() => [...document.querySelectorAll('#jcNewMultiList .task-row')].map((d) => ({
    제목: d.querySelector('input[type=text]')?.value || '',
    요약: [...d.parentElement.children].slice(1).map((x) => x.textContent.trim()).join(' ').trim(),
  })));
  const 적용 = (이름) => p.evaluate(async (n) => {
    const sel = document.getElementById('jcNewPreset');
    const o = [...sel.options].find((x) => x.textContent.includes(n));
    if (!o) throw new Error('프리셋을 못 찾았습니다: ' + n);
    sel.value = o.value;
    applyPreset('new');
    await new Promise((r) => setTimeout(r, 600));
  }, 이름);

  await 적용(프리셋);
  const 한번 = await 보기();
  봐('프리셋의 줄이 다 들어온다', 한번.length >= 5, 한번.length);
  봐('**마지막 줄**에도 설정이 붙는다', !!(한번.at(-1) || {}).요약, 한번.at(-1));
  봐('모든 줄에 설정이 붙는다', 한번.every((x) => x.요약), 한번.filter((x) => !x.요약));
  봐('줄마다 담당자가 다르다 (프리셋 세부값이 살아 있다)',
    new Set(한번.map((x) => (/담당: ([^·]+)/.exec(x.요약) || [])[1])).size > 1,
    한번.map((x) => (/담당: ([^·]+)/.exec(x.요약) || [])[1]));

  // 가운데 줄을 지우고 프리셋을 다시 부른다 — 흔한 쓰임새다
  const 지울것 = 한번[2].제목;
  await p.evaluate(() => removeJcTaskRow('multi', 2));
  await new Promise((r) => setTimeout(r, 500));
  const 지운뒤 = await 보기();
  봐('지운 줄만 빠진다', 지운뒤.length === 한번.length - 1 && !지운뒤.some((x) => x.제목 === 지울것), 지운뒤.map((x) => x.제목));
  봐('남은 줄 설정은 한 칸씩 밀리지 않는다', 지운뒤.every((x) => x.요약), 지운뒤.filter((x) => !x.요약));

  await 적용(프리셋);
  const 두번 = await 보기();
  const 되살아난것 = 두번.find((x) => x.제목 === 지울것);
  봐('다시 부르면 지운 줄이 되살아난다', !!되살아난것, 두번.map((x) => x.제목));
  봐('되살아난 줄에도 설정이 붙는다', !!(되살아난것 || {}).요약, 되살아난것);
  봐('줄이 두 벌로 늘지 않는다', 두번.length === 한번.length, { 처음: 한번.length, 두번: 두번.length });

  봐('화면에서 터진 것이 없다', 터짐.length === 0, 터짐.slice(0, 3));

  await b.close();
  console.log(`\n통과 ${통과} · 실패 ${실패.length}`);
  실패.forEach((x) => console.log('  · ' + x));
  process.exit(실패.length ? 1 : 0);
})().catch((e) => { console.error('검사가 탈났습니다:', e.message); process.exit(2); });
