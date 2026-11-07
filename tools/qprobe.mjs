// ============================================================================
//  qprobe.mjs —— 手机档画质行为验证
//  验证三件事：
//    ① 手机 UA + 390×844 + dpr3 下，档位与像素比是多少（分辨率地板有没有生效）
//    ② 人为喂慢帧时，降级阶梯是否按「特性优先」往下走，而不是直接降分辨率
//    ③ 降到底之后像素比是否仍然 ≥ 1（不糊）
//  用法：node tools/qprobe.mjs [--file=.perf-real.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push(desc.slice(0, 300));
    }
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
await send('Network.enable');
await send('Network.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    screenWidth: 390, screenHeight: 844,
});
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&theme=city&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}

// 先关掉自适应，读出「手机档满配」的基线
const base = JSON.parse(await ev(`(()=>{
  const g = window.__game;
  g.startGame(); g.QUALITY.adaptive = false; g.QUALITY.level = 0; g.QUALITY.scale = 1;
  g.applyQualityOptions();
  const q = g.QP();
  return JSON.stringify({
    ua: navigator.userAgent.slice(0, 40),
    dpr: window.devicePixelRatio,
    tier: g.QUALITY.tier,
    pixelRatio: +g.renderer.getPixelRatio().toFixed(3),
    canvas: [g.renderer.domElement.width, g.renderer.domElement.height],
    shadow: q.shadow, pointLights: q.pointLights, rain: q.rain, mist: q.mist,
    far: q.cam.far, minPR: q.minPR, minScale: q.minScale, steps: (q.steps || []).length
  });
})()`) || '{}');

// 人为喂 40 个 40ms 的慢帧，看阶梯怎么走
const climb = [];
for (let k = 0; k < 5; k++) {
    const r = JSON.parse(await ev(`(()=>{
      const g = window.__game;
      g.QUALITY.adaptive = true;
      // 喂慢帧：tick 每 900ms 判一次，这里直接灌 25 次 40ms 撑满窗口
      for (let i = 0; i < 30; i++) g.PERF.tick(0.040);
      const q = g.QP();
      return JSON.stringify({
        level: g.QUALITY.level, scale: +g.QUALITY.scale.toFixed(2),
        pixelRatio: +g.renderer.getPixelRatio().toFixed(3),
        shadow: q.shadow, pointLights: q.pointLights, rain: q.rain, mist: q.mist, far: q.cam.far
      });
    })()`) || '{}');
    climb.push(r);
}

console.log('--- 手机档满配基线 ---');
console.log(JSON.stringify(base, null, 1));
console.log('--- 慢帧时逐级降级 ---');
for (const r of climb) console.log(JSON.stringify(r));
console.log('--- 结论 ---');
const prs = [base.pixelRatio, ...climb.map(r => r.pixelRatio)];
console.log('像素比全程:', prs.join(' → '));
console.log('最低像素比:', Math.min(...prs), Math.min(...prs) >= 1 ? '✅ ≥1（不会糊）' : '❌ 掉到 1 以下（会糊）');
console.log('阶梯走到的最高级:', Math.max(...climb.map(r => r.level)));
console.log('异常:', JSON.stringify(caught.slice(0, 4)));
ws.close();
