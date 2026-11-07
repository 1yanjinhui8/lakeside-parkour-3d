// 两件事：①从玩家视角看保安朝向 ②高帧率侧面拍保安看抖动
import fs from 'node:fs';
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
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
const evalJs = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 480, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) { const r = await evalJs('typeof window.__game !== "undefined"'); if (r.result.value) break; await sleep(250); }
for (let i = 0; i < 80; i++) { const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)'); if (r.result.value) break; await sleep(300); }
// 初始化：开局，保安固定在玩家右后方
await evalJs(`(() => {
    const g = window.__game, S = g.S;
    g.startGame(); S.paused = true; S.power.shield = 999;
    for (let i = 0; i < 30; i++) g.step(1/60);
    S.power.shield = 0; S.chaserTimer = 999;
    for (let i = 0; i < 120; i++) { S.chaserTimer = 999; g.step(1/60); }
    window.__freezeCam = true;
    return 1; })()`);

// ① 玩家视角：相机放在玩家头部，看向保安
await evalJs(`(() => {
    const g = window.__game, c = g.chaser, p = g.player.root.position;
    g.camera.position.set(p.x, p.y + 1.45, p.z + 0.15);
    g.camera.lookAt(c.root.position.x, 0.95, c.root.position.z);
    g.camera.fov = 42; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
    return 1; })()`);
await sleep(300);
let shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:\\Claude\\parkour-game\\screenshots\\_face_player.png', Buffer.from(shot.data, 'base64'));

// ② 侧面高帧率：相机在保安侧前方 2.4m
await evalJs(`(() => { const g = window.__game, c = g.chaser;
    g.camera.position.set(c.root.position.x + 2.4, 1.25, c.root.position.z + 0.6);
    g.camera.lookAt(c.root.position.x, 0.75, c.root.position.z);
    g.camera.fov = 42; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
    return 1; })()`);
fs.mkdirSync('D:\\Claude\\parkour-game\\screenshots\\_jit', { recursive: true });
for (let k = 0; k < 30; k++) {
    await evalJs(`(() => { const g = window.__game, S = g.S, c = g.chaser;
        S.paused = true; S.chaserTimer = 999;
        g.step(1/60);
        c.root.position.set(1.9, 0, 2.2);
        g.camera.position.set(1.9 + 2.4, 1.25, 2.2 + 0.6);
        g.camera.lookAt(1.9, 0.75, 2.2);
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:\\Claude\\parkour-game\\screenshots\\_jit\\j${String(k).padStart(2, '0')}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('done');
ws.close(); process.exit(0);
