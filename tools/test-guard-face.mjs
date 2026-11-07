// 测试保安朝向：保安放玩家身后 5 米，相机站中间看保安，试 4 个 yaw
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
await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) { const r = await evalJs('typeof window.__game !== "undefined"'); if (r.result.value) break; await sleep(250); }
for (let i = 0; i < 80; i++) { const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)'); if (r.result.value) break; await sleep(300); }

const offs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
for (let k = 0; k < offs.length; k++) {
    const off = offs[k];
    await evalJs(`(() => {
        const g = window.__game, S = g.S, c = g.chaser, p = g.player.root.position;
        g.startGame(); S.paused = true;
        for (let i = 0; i < 20; i++) g.step(1/60);
        window.__freezeCam = true;
        c.root.position.set(1.9, 0, 5.0);
        const gx = c.root.position.x, gz = c.root.position.z;
        const dx = p.x - gx, dz = p.z - gz, len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        g.chaserModel.rotation.y = Math.atan2(dx, dz) + (${off});
        g.camera.position.set(gx + ux * 2.6, 1.15, gz + uz * 2.6);
        g.camera.lookAt(gx, 0.6, gz);
        g.camera.fov = 50; g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('D:\\Claude\\parkour-game\\screenshots\\_face_' + k + '.png', Buffer.from(shot.data, 'base64'));
}
console.log('saved 4 yaw tests');
ws.close(); process.exit(0);
