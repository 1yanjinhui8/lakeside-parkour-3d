// ============================================================================
//  lisboaprobe.mjs —— 验证新葡京路标：段落尾声是否生成、位置是否在传送门正后方
//  用法：node tools/lisboaprobe.mjs [--file=.perf-real.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');

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
        if (!/chrome-extension:/.test(desc)) caught.push(desc.slice(0, 400));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&t=0.68&wx=clear&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(800);

const snap = async () => JSON.parse(await ev(`(()=>{
  const g = window.__game;
  return JSON.stringify({
    D: Math.round(g.S.D), segEnd: Math.round(g.Scene.segEnd), next: g.Scene.next,
    phase: g.Scene.phase,
    lisboa: !!g.LisboaFX.group, lisboaZ: g.LisboaFX.group ? +g.LisboaFX.group.position.z.toFixed(1) : null,
    portal: !!g.PortalFX.group, portalZ: g.PortalFX.group ? +g.PortalFX.group.position.z.toFixed(1) : null,
    camFar: g.camera.far
  });
})()`) || '{}');

console.log('起步:', JSON.stringify(await snap()));
// 推进到段落尾声
for (const target of [2700, 2850, 2900, 2930, 2960, 2990]) {
    await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<${target}&&n++<200000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
    await sleep(120);
    console.log(String(target).padStart(5) + ' →', JSON.stringify(await snap()));
}
// 清理验证：换场后 / 重开后不能残留
const before = await snap();
await ev('window.__game.doSelfCheckSwap && window.__game.doSelfCheckSwap(); true').catch(() => false);
const afterSwap = await ev(`(()=>{
  const g = window.__game;
  // 直接调 resetState：模拟死亡重开
  g.S.D = 0; g.Scene.segEnd = 3000;
  const had = !!g.LisboaFX.group;
  g.resetState();
  let inWorld = 0;
  g.worldGroup.traverse(o => { if (o === g.LisboaFX.group) inWorld++; });
  return JSON.stringify({ hadBefore: had, afterReset: !!g.LisboaFX.group, stillInWorld: inWorld });
})()`);
console.log('清理验证:', afterSwap);
console.log('异常:', JSON.stringify(caught.slice(0, 4)));
ws.close();
