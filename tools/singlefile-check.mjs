// 单文件版冒烟：验证 playable.html（含 7 座内联地标）能加载、地标注册成功、无异常。
//   127MB 的文件比测试副本慢一个数量级，给足超时（默认 15 分钟）。
import fs from 'node:fs';
const PORT = +(process.env.CDP_PORT || 9222);
const HTTP = 8765;
const FILE = process.argv[2] || 'playable.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 240));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') caught.push('ERR ' + (m.params.args.map(a => a.value || a.description).join(' ') || '').slice(0, 240));
});
const send = (m, p = {}, tmo = 900000) => new Promise((a, b) => {
    const id = ++seq; pend.set(id, x => x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); b(new Error('tmo ' + m)); } }, tmo);
});
const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now();
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/${FILE}?q=low&theme=city` }, 900000);
let ok = false;
for (let i = 0; i < 420; i++) {
    ok = await ev('typeof window.__game==="object" && !!window.__game.player');
    if (ok) break;
    await sleep(2000);
}
console.log(JSON.stringify({
    file: FILE, loaded: ok, sec: Math.round((Date.now() - t0) / 1000),
    landmarks: ok ? await ev('window.__game.LMGLB.list().map(x => x.kind).join(",")') : null,
    size: (fs.statSync(FILE).size / 1048576).toFixed(1) + 'MB',
    caught: caught.slice(0, 4),
}, null, 1));
if (ok) {
    await ev('window.__game.startGame(); true');
    await sleep(3000);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshots/singlefile-landmarks.png', Buffer.from(s.data, 'base64'));
    console.log('shot ok');
}
process.exit(0);
