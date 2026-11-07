// ============================================================================
//  selftest-loop.mjs —— 在同一个页面里连跑 N 次 selfTest，抓出「偶发失败」
//  用来区分：真回归 vs 本来就有的随机抖动
//  用法： node tools/selftest-loop.mjs [--file=.perf-real.html] [--n=5]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    if (kv) return kv.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const FILE = val('--file', '.perf-real.html');
const N = +val('--n', 5);
const PORT_HTTP = val('--port', '8766');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);
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
const ev = async (e, tmo = 120000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?v=${stamp}` }, 60000);
for (let i = 0; i < 150; i++) {
    if ((await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false))) break;
    await sleep(300);
}

const tally = {};
for (let i = 0; i < N; i++) {
    const r = JSON.parse(await ev(`JSON.stringify(window.__game.selfTest())`));
    console.log(`第 ${i + 1} 次: ${r.pass}/${r.total}` + (r.fail ? '  ❌ ' + r.results.filter(x => !x.pass).map(x => x.name + '(' + x.info + ')').join(' | ') : ''));
    for (const x of r.results) if (!x.pass) tally[x.name] = (tally[x.name] || 0) + 1;
    await sleep(300);
}
console.log('\n失败统计:', JSON.stringify(tally, null, 1));
await fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`).catch(() => { });
process.exit(0);
