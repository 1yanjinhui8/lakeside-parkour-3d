// 验证「开门就是燕园」+ 菜单场景选择器
// 用法： node tools/defaultscene.mjs [--file=.perf-real.html]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = 'screenshots/campus';
const FILE = (process.argv.find(a => a.startsWith('--file=')) || '--file=.perf-real.html').split('=')[1];
const PORT_HTTP = 8766;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = list.find(t => t.type === 'page' && t.url.includes('127.0.0.1:' + PORT_HTTP));
if (!page) {
    for (const t of list.filter(x => x.type === 'page')) await fetch(`http://127.0.0.1:9222/json/close/${t.id}`).catch(() => { });
    page = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args || []).map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + JSON.stringify(m.params.exceptionDetails).slice(0, 260));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 45000) => {
    const id = ++seq;
    const pr = new Promise(a => pend.set(id, a));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 45000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.result?.value;
const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r.result?.data) { console.log('shot fail', name); return; }
    fs.writeFileSync(path.join(ROOT, OUT, name), Buffer.from(r.result.data, 'base64'));
    console.log('  → ' + name);
};

await send('Network.enable');
try { await send('Network.setCacheDisabled', { cacheDisabled: true }); } catch (e) { }
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);

// ---------- A. 菜单：看场景选择器 ----------
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?q=high&v=${stamp}` }, 90000);
let up = false;
for (let i = 0; i < 200; i++) {
    up = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS').catch(() => false);
    if (up) break;
    await sleep(300);
}
if (!up) { console.log('页面没起来'); process.exit(1); }
await sleep(1500);

const menuInfo = await ev(`JSON.stringify({
  chips: Array.from(document.querySelectorAll('#scenePick button')).map(b => [b.dataset.theme || 'random', b.textContent.trim(), b.classList.contains('on')]),
  tip: document.getElementById('sceneTip') && document.getElementById('sceneTip').textContent,
  menuVisible: !document.getElementById('menu').classList.contains('hidden')
})`);
console.log('菜单:', menuInfo);
await shot('_scene_menu.png');

// 点每一个 chip，确认预览世界跟着换
const clickResults = [];
for (const t of ['city', 'tunnel', 'lakeside', 'campus', '']) {
    const r = await ev(`(() => {
      const b = document.querySelector('#scenePick button[data-theme="${t}"]');
      if (!b) return 'no chip ${t}';
      b.click();
      return JSON.stringify({ picked: '${t}', urlTheme: window.__game.__urlTheme || null });
    })()`);
    await sleep(900);
    const st = await ev(`JSON.stringify({
      theme: window.__game.curTheme,
      plate: window.__game.CAMPUS.group.visible,
      on: Array.from(document.querySelectorAll('#scenePick button')).filter(b => b.classList.contains('on')).map(b => b.dataset.theme || 'random')
    })`);
    clickResults.push([t || '随机轮换', st]);
    if (t === 'campus') await shot('_scene_menu_campus.png');
}
console.log('点选结果:');
for (const [t, st] of clickResults) console.log('  ', t, '→', st);

// ---------- B. 不带 theme 直接开局 ----------
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&v=${stamp + 1}` }, 90000);
up = false;
for (let i = 0; i < 200; i++) {
    up = await ev('typeof window.__game === "object" && !!window.__game.CAMPUS').catch(() => false);
    if (up) break;
    await sleep(300);
}
await sleep(2500);
const boot = await ev(`JSON.stringify({
  theme: window.__game.curTheme,
  sceneName: (document.getElementById('hudScene') || {}).textContent,
  plate: window.__game.CAMPUS.group.visible,
  plateReady: window.__game.CAMPUS.ready,
  plateTris: (() => { let n = 0; window.__game.CAMPUS.group.traverse(o => { if (o.isMesh && o.geometry.index) n += o.geometry.index.count / 3; }); return Math.round(n); })(),
  dc: window.__game.renderer.info.render.calls,
  state: window.__game.S.state
})`);
console.log('开局:', boot);

await ev('window.__game.QUALITY.adaptive = false; window.__noTurnFail = true; true');
await sleep(600);
await shot('_scene_boot.png');

console.log('控制台:', logs.slice(-8).join(' | ') || '（无输出）');
process.exit(0);
