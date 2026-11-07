// 诊断2：把相机直接对准保安，看它到底渲染不渲染
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
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
    if (r.result.value) break;
    await sleep(250);
}
await sleep(1000);
const r = await send('Runtime.evaluate', {
    expression: `(() => {
        const g = window.__game, S = g.S, c = g.chaser;
        g.startGame(); S.paused = true; S.power.shield = 999;
        for (let i = 0; i < 40; i++) g.step(1/60);
        for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
        S.power.shield = 0;
        for (let i = 0; i < 160; i++) { S.chaserTimer = 20; g.step(1/60); }
        // 把相机对准保安
        const p = c.root.position;
        g.camera.position.set(p.x + 0.1, 1.6, p.z + 3.2);
        g.camera.lookAt(p.x, 0.8, p.z);
        g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene, g.camera);
        // 保安子模型的包围盒（世界坐标）
        const m = g.chaserModel.children[0];
        let box = null;
        if (m) {
            const b = new (g.camera.position.constructor === Object ? Object : Object)();
            const THREE_Box3 = g.player.root.position.constructor === Object ? null : null;
            box = { hasMesh: !!m.children.length };
        }
        return JSON.stringify({ pos: p.toArray().map(x => +x.toFixed(2)), children: g.chaserModel.children.length,
            camPos: g.camera.position.toArray().map(x => +x.toFixed(2)), visible: c.root.visible });
    })()`, returnByValue: true,
});
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:\\Claude\\parkour-game\\screenshots\\_guard_lookat.png', Buffer.from(shot.data, 'base64'));
console.log(r.result.value);
ws.close(); process.exit(0);
