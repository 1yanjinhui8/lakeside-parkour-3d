// ============================================================================
//  perfsplit.mjs —— 把每帧耗时拆成「逻辑 / 渲染 / 阴影」，定位手机端真正的瓶颈
//  思路：同一帧里分别计时 step()（纯 JS 逻辑，不渲染）和 renderer.render()（GPU 提交），
//        再对比不同像素比 / 阴影开关下的变化。填充率瓶颈会随像素数线性涨，CPU 瓶颈不会。
//  用法：node tools/perfsplit.mjs [--file=.perf-real.html] [--theme=city]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const THEME = val('--theme', 'city');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=mid&theme=${THEME}&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; window.__game.S.paused=false; true');
await sleep(1200);

// 让场景进入城市街区的稳定段（有塔、有障碍）
await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<300&&n++<200000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
await sleep(600);

const probe = `
(function(){
  const g = window.__game, r = g.renderer, s = g.scene, c = g.camera;
  const gl = r.getContext();
  // 必须 gl.finish()：SwiftShader / 移动 GPU 的 draw 是异步排队的，
  // 不加 finish 测到的是「提交耗时」而不是「画完耗时」，会出现关阴影反而更慢这种反常识结果
  function timeIt(fn, n){
    fn(); gl.finish();
    const t0 = performance.now();
    for(let i=0;i<n;i++){ fn(); gl.finish(); }
    return (performance.now()-t0)/n;
  }
  // 逻辑：只跑 step（不渲染）
  const logic = timeIt(()=>{ g.S.transGrace = 1e9; g.step(1/60); }, 240);
  // 渲染：固定相机，只 render
  r.render(s, c);
  const render = timeIt(()=>{ r.render(s, c); }, 40);
  // 关阴影再测一次
  const smWas = r.shadowMap.enabled;
  r.shadowMap.enabled = false; r.shadowMap.needsUpdate = false;
  const renderNoShadow = timeIt(()=>{ r.render(s, c); }, 40);
  r.shadowMap.enabled = smWas;
  // 像素比减半再测（看填充率敏感度）
  const prWas = r.getPixelRatio();
  r.setPixelRatio(prWas * 0.5);
  const renderHalfPR = timeIt(()=>{ r.render(s, c); }, 40);
  r.setPixelRatio(prWas);
  return JSON.stringify({
    tier: g.QUALITY.tier, level: g.QUALITY.level, scale: +g.QUALITY.scale.toFixed(2),
    pixelRatio: +prWas.toFixed(2),
    size: [r.domElement.width, r.domElement.height],
    logicMs: +logic.toFixed(2), renderMs: +render.toFixed(2),
    renderNoShadowMs: +renderNoShadow.toFixed(2), renderHalfPRMs: +renderHalfPR.toFixed(2),
    dc: r.info.render.calls, tris: r.info.render.triangles,
    progs: r.info.programs ? r.info.programs.length : -1,
    tex: r.info.memory.textures, geo: r.info.memory.geometries
  });
})()`;

const out = JSON.parse(await ev(probe) || '{}');
console.log(JSON.stringify(out, null, 1));
const p = out;
if (p.logicMs != null) {
    console.log('---');
    console.log('逻辑 : 渲染 =', p.logicMs, ':', p.renderMs, '→', p.logicMs > p.renderMs ? 'CPU 瓶颈（逻辑）' : '渲染瓶颈');
    console.log('阴影 pass 开销 =', +(p.renderMs - p.renderNoShadowMs).toFixed(2), 'ms');
    console.log('像素比减半收益 =', +(p.renderMs - p.renderHalfPRMs).toFixed(2), 'ms（填充率敏感度）');
}
ws.close();
