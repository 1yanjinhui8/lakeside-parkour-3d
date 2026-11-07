// 判定保安脸的朝向：相机固定看 +Z 方向，分别截 rotation.y=0 和 π
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
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 600, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) { const r = await evalJs('typeof window.__game !== "undefined"'); if (r.result.value) break; await sleep(250); }
for (let i = 0; i < 80; i++) { const r = await evalJs('!!(window.__game && window.__game.chaserModel && window.__game.chaserModel.children.length)'); if (r.result.value) break; await sleep(300); }
for (const rot of [0, Math.PI]) {
    await evalJs(`(() => {
        const g = window.__game, S = g.S, c = g.chaser;
        g.startGame(); S.paused = true;
        window.__freezeCam = true;
        c.root.visible = true;
        c.root.position.set(0, 0, 0);
        c.root.rotation.set(0, 0, 0);
        g.chaserModel.rotation.set(0, ${rot}, 0);
        g.chaserModel.position.set(0, 0, 0);
        g.camera.position.set(0, 0.8, 3.2);
        g.camera.lookAt(0, 0.7, 0);
        g.camera.fov = 45; g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        return 1; })()`);
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('D:\\Claude\\parkour-game\\screenshots\\_rot_' + (rot === 0 ? '0' : 'pi') + '.png', Buffer.from(shot.data, 'base64'));
}
console.log('saved rot test');
ws.close(); process.exit(0);
