// 截"保安追人"画面：等模型加载完 → 暂停步进 → 走到出拳帧 → 强制渲染截图
import fs from 'node:fs';
const [, , out = 'screenshots/_guard.png', urlBase = 'http://127.0.0.1:8765/'] = process.argv;
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getPage() {
    for (let i = 0; i < 80; i++) {
        try {
            const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = tabs.find(t => t.type === 'page');
            if (page) return page;
        } catch { }
        await sleep(300);
    }
    throw new Error('连不上 CDP');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map(); const logs = [], exceptions = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; exceptions.push((d.exception?.description || d.text || '').slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) {
    const r = await evalJs('typeof window.__game !== "undefined"');
    if (r.result.value) break;
    await sleep(250);
}
// 等保安模型真正加进场景
let loaded = false;
for (let i = 0; i < 60; i++) {
    const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)');
    if (r.result.value) { loaded = true; break; }
    await sleep(300);
}
console.log('保安模型已加载:', loaded);

const r = await evalJs(`(() => {
    const g = window.__game, S = g.S, c = g.chaser;
    g.startGame(); S.paused = true; S.power.shield = 999;
    for (let i = 0; i < 40; i++) g.step(1/60);
    for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
    S.power.shield = 0;
    // 追到身后并停在出拳峰值
    let punch = 0, guard = 0;
    for (let i = 0; i < 400; i++) {
        S.chaserTimer = 20;
        g.step(1/60);
        const p = S.phase * 1.05 + 1;
        const pt = (S.D * 1.15 + p * 0.5) % 1;
        punch = pt < 0.3 ? Math.sin(pt / 0.3 * Math.PI) : 0;
        if (punch > 0.9 && S.chaserDist < 2.6) { guard++; if (guard > 2) break; }
    }
    g.renderer.render(g.scene, g.camera);
    return JSON.stringify({ dist: +S.chaserDist.toFixed(2), punch: +punch.toFixed(2),
        visible: c.root.visible, children: g.chaserModel.children.length });
})()`);
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({ ok: true, out, state: r.result.value ? JSON.parse(r.result.value) : r.result, logs: logs.slice(-4), exceptions: exceptions.slice(0, 3) }, null, 1));
ws.close(); process.exit(0);
