// ============================================================================
//  sceneseq.mjs —— 验证单人固定换图顺序：湖畔轨道 → 火车隧道 → 城市街区 → 燕园 → 回到轨道
//  用法： node tools/sceneseq.mjs [--dist=13000] [--file=.perf-real.html] [--theme=]
//  说明：无敌 + 自动按对方向，只验「换图顺序」和「每段里程」，不验躲避。
// ============================================================================
const PORT = 9222, PORT_HTTP = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const DIST = +val('--dist', '13000');
const FILE = val('--file', '.perf-real.html');
const THEME = val('--theme', '');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 240));
});
const send = (m, p = {}, tmo = 240000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 240000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const url = `http://127.0.0.1:${PORT_HTTP}/${FILE}?q=low${THEME ? '&theme=' + THEME : ''}&v=${Date.now()}`;
await send('Page.navigate', { url }, 240000);
for (let i = 0; i < 240; i++) {
    if (await ev('typeof window.__game==="object" && !!window.__game.player')) break;
    await sleep(300);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(500);

const out = await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  G.Scene.fanfareDone = true;
  const seen = [{ id: G.Scene.id, at: 0 }];
  let frames = 0, deaths = 0, pressed = false;
  const target = ${DIST};
  while (G.S.D < target && frames < 60 * 900) {
    G.S.transGrace = 99;
    G.Scene.fanfareDone = true;
    const j = C.junctions[C.jIdx];
    const dist = C.nextAbs - C.s;
    if (j && !pressed && dist > 0 && dist <= 30) {
      C.pendingDir = j.dir === 'L' ? -1 : 1; C.pendingAt = C.s; pressed = true;
    }
    const before = G.Scene.id, dBefore = G.S.D;
    G.step(1 / 60);
    frames++;
    if (C.jIdx !== (C.jIdx | 0)) pressed = false;
    if (G.Scene.id !== before) {
      seen.push({ id: G.Scene.id, from: before, at: Math.round(G.S.D), seg: Math.round(G.S.D - dBefore + (G.S.D - dBefore)) });
      pressed = false;
    }
    if (G.S.state !== 'playing') { deaths++; break; }
  }
  return { frames, D: Math.round(G.S.D), deaths, seen };
})()`);

const expect = ['lakeside', 'tunnel', 'city', 'campus', 'campus2', 'lakeside', 'tunnel'];
const got = (out.seen || []).map(x => x.id);
console.log('里程', out.D, '帧', out.frames, '死亡', out.deaths);
console.log('经过顺序：', got.join(' → '));
console.log('每段起点：', (out.seen || []).map(x => x.id + '@' + x.at + 'm').join('  '));
let ok = true;
for (let i = 0; i < got.length; i++) {
    if (got[i] !== expect[i]) { ok = false; console.log(`❌ 第 ${i + 1} 段应为 ${expect[i]}，实际 ${got[i]}`); }
}
console.log(ok ? '✅ 固定循环正确' : '❌ 顺序不符');
console.log('caught:', caught.length ? caught : 'none');
process.exit(ok && out.deaths === 0 ? 0 : 1);
