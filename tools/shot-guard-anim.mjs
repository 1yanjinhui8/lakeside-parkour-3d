// 抓保安追人的连续帧，用于拼 GIF 检查动作
import fs from 'node:fs';
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
const outDir = process.argv[3] || 'D:\\Claude\\parkour-game\\screenshots\\_anim';
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
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 400, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) {
    const r = await evalJs('typeof window.__game !== "undefined"');
    if (r.result.value) break;
    await sleep(250);
}
for (let i = 0; i < 60; i++) {
    const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)');
    if (r.result.value) break;
    await sleep(300);
}
await evalJs(`(() => {
    const g = window.__game, S = g.S;
    g.startGame(); S.paused = true; S.power.shield = 999;
    for (let i = 0; i < 40; i++) g.step(1/60);
    for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
    S.power.shield = 0;
    for (let i = 0; i < 200; i++) { S.chaserTimer = 999; g.step(1/60); }
    return 1;
})()`);
fs.mkdirSync(outDir, { recursive: true });
const N = 24;
for (let k = 0; k < N; k++) {
    await evalJs(`(() => { const g = window.__game, S = g.S;
        S.paused = true; S.chaserTimer = 999;
        for (let i = 0; i < 5; i++) g.step(1/60);
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${outDir}/f${String(k).padStart(2, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('frames saved to', outDir);
ws.close(); process.exit(0);
