// ============================================================================
//  wxprobe.mjs —— 验证天气节拍按里程走（每 2500 米一次），薄雾仍走自己的计时器
//  用法：node tools/wxprobe.mjs [--file=.perf-real.html]
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

await send('Page.enable'); await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
// 关键：用 ?wx= 会进 manual 模式，自动节拍就不走了，所以这里不传 wx
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&theme=city&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); true');
await sleep(800);

const snap = async () => JSON.parse(await ev(`(()=>{
  const s = window.__wx._st;
  return JSON.stringify({ D: Math.round(window.__game.S.D), weather: s.weather, seg: s.seg,
                          lastDist: Math.round(s.lastDist), seqIdx: s.seqIdx, mistTimer: +s.mistTimer.toFixed(1) });
})()`) || '{}');

const rows = [await snap()];
for (const target of [2400, 2600, 4900, 5100]) {
    await ev(`(()=>{const g=window.__game;let n=0;while(g.S.D<${target}&&n++<400000){g.S.transGrace=1e9;g.step(1/60);}return Math.round(g.S.D)})()`);
    await sleep(300);
    rows.push(await snap());
}
console.log('里程 → 天气 / 段号 / 序号 / 薄雾计时');
for (const r of rows) console.log(`  ${String(r.D).padStart(5)}m  ${r.weather.padEnd(6)} seg=${r.seg} seq=${r.seqIdx} mistTimer=${r.mistTimer}`);
console.log('异常:', JSON.stringify(caught.slice(0, 3)));
ws.close();
