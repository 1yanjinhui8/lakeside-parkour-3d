// 从玩家视角试 4 个朝向偏移，找出"脸正对玩家"的那个
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
await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 520, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) { const r = await evalJs('typeof window.__game !== "undefined"'); if (r.result.value) break; await sleep(250); }
for (let i = 0; i < 80; i++) { const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)'); if (r.result.value) break; await sleep(300); }
await evalJs(`(() => {
    const g = window.__game, S = g.S;
    g.startGame(); S.paused = true; S.power.shield = 999;
    for (let i = 0; i < 30; i++) g.step(1/60);
    S.power.shield = 0; S.chaserTimer = 999;
    for (let i = 0; i < 120; i++) { S.chaserTimer = 999; g.step(1/60); }
    window.__freezeCam = true;
    return 1; })()`);
const offs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
for (let k = 0; k < offs.length; k++) {
    const r = await evalJs(`(() => {
        const g = window.__game, c = g.chaser, p = g.player.root.position;
        const dx = p.x - c.root.position.x, dz = p.z - c.root.position.z;
        g.chaserModel.rotation.y = Math.atan2(dx, dz) + (${offs[k]});
        g.camera.position.set(p.x, p.y + 1.45, p.z + 0.1);
        g.camera.lookAt(c.root.position.x, 0.9, c.root.position.z);
        g.camera.fov = 42; g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        return JSON.stringify({ yaw: +g.chaserModel.rotation.y.toFixed(2), guard: [+c.root.position.x.toFixed(2), +c.root.position.z.toFixed(2)], player: [+p.x.toFixed(2), +p.z.toFixed(2)] });
    })()`);
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('D:\\Claude\\parkour-game\\screenshots\\_pv_' + k + '.png', Buffer.from(shot.data, 'base64'));
    console.log(k, r.result.value);
}
ws.close(); process.exit(0);
