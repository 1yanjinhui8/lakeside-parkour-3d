// 探针：导航到 playable.html，轮询 window.__game 出现的时间，并 dump 控制台/异常
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const url = process.argv[2] || 'http://127.0.0.1:8765/playable.html?autostart&v=' + Date.now();

const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = tabs.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

let seq = 0; const pending = new Map(); const logs = []; const errs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 500));
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const t0 = Date.now();
await send('Page.navigate', { url });
let ok = false, t = 0;
for (let i = 0; i < 240; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
    if (r.result.value) { ok = true; t = Date.now() - t0; break; }
    await sleep(250);
}
const info = await send('Runtime.evaluate', {
    expression: `(() => { try {
        const g = window.__game;
        return JSON.stringify({
            ready: !!g, merge: g && g.mergeState, calls: g && g.renderer.info.render.calls,
            meshes: g && (() => { let n = 0; g.worldGroup.traverse(o => { if (o.isMesh) n++; }); return n; })(),
            D: g && Math.round(g.S.D), scene: g && g.Scene.id, state: g && g.S.state,
            playerLoaded: g && !!g.player && g.player.root.visible,
            loadingHidden: document.getElementById('loading') ? document.getElementById('loading').classList.contains('hidden') : null,
            docState: document.readyState,
        });
    } catch (e) { return 'ERR ' + e.message; } })()`, returnByValue: true,
});
console.log(JSON.stringify({ readyMs: ok ? t : null, info: info.result.value, errs: errs.slice(0, 5), logs: logs.slice(-15) }, null, 1));
ws.close(); process.exit(0);
