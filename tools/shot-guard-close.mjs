// 近距离侧面拍保安，检查跑动动作（输出 12 帧）
import fs from 'node:fs';
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
const outDir = 'D:\\Claude\\parkour-game\\screenshots\\_anim2';
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
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 480, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) { const r = await evalJs('typeof window.__game !== "undefined"'); if (r.result.value) break; await sleep(250); }
for (let i = 0; i < 80; i++) { const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)'); if (r.result.value) break; await sleep(300); }
await evalJs(`(() => {
    const g = window.__game, S = g.S, c = g.chaser;
    g.startGame(); S.paused = true; S.power.shield = 999;
    for (let i = 0; i < 40; i++) g.step(1/60);
    for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
    S.power.shield = 0;
    for (let i = 0; i < 200; i++) { S.chaserTimer = 999; g.step(1/60); }
    // 侧面近景机位
    const p = c.root.position;
    g.camera.position.set(p.x + 2.6, 1.15, p.z);
    g.camera.lookAt(p.x, 0.65, p.z);
    g.camera.fov = 40; g.camera.updateProjectionMatrix();
    window.__freezeCam = true;
    return 1; })()`);
fs.mkdirSync(outDir, { recursive: true });
for (let k = 0; k < 16; k++) {
    await evalJs(`(() => { const g = window.__game, S = g.S;
        S.paused = true; S.chaserTimer = 999;
        for (let i = 0; i < 4; i++) g.step(1/60);
        g.camera.position.set(g.chaser.root.position.x + 2.6, 1.15, g.chaser.root.position.z);
        g.camera.lookAt(g.chaser.root.position.x, 0.65, g.chaser.root.position.z);
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${outDir}/g${String(k).padStart(2, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('done');
ws.close(); process.exit(0);
