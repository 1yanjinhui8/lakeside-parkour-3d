// ============================================================================
//  smoke.mjs —— 快速冒烟：页面能不能起来、有没有抛错、ATMO 接口齐不齐
//  比 diag-city 短（不等 60s 轮询），失败时直接把异常打出来
//  用法：node tools/smoke.mjs [--file=.perf-real.html] [--theme=city] [--wait=25]
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
const WAIT = +val('--wait', 25);

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
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 400));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const s = m.params.args.map(a => a.description || a.value).join(' ');
        if (!/chrome-extension:/.test(s)) caught.push('ERR: ' + s.slice(0, 400));
    }
});
const send = (m, p = {}, tmo = 40000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 40000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=${THEME}&v=${stamp}` }, 30000);

let ready = false;
for (let i = 0; i < WAIT; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) { ready = true; break; }
    if (caught.length) break;          // 已经抛错了就别干等
    await sleep(1000);
}

const info = ready ? await ev(`JSON.stringify({
    game: true,
    atmo: typeof window.__wx,
    atmoSetQuality: typeof (window.__wx && window.__wx.setQuality),
    atmoUpdate: typeof (window.__wx && window.__wx.update),
    wx: (function(){ var s = window.__wx && window.__wx.state && window.__wx.state(); return s ? { weather: s.weather, rain: s.rain, mist: s.mist, manual: s.manual } : null; })(),
    dc: window.__game.renderer.info.render.calls,
    tris: window.__game.renderer.info.render.triangles,
    merge: window.__game.mergeState,
    dist: Math.round(window.__game.S.D)
})`) : '{"game":false}';

console.log(JSON.stringify({ ready, info: JSON.parse(info || '{}'), caught: caught.slice(0, 6) }, null, 1));
ws.close();
