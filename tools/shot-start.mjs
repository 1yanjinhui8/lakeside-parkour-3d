// 抓游戏刚开始的几帧，看人物是否被裁切
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
await sleep(500);

const steps = [1, 3, 8, 20, 45];
for (const n of steps) {
    const r = await send('Runtime.evaluate', {
        expression: `(() => { const g = window.__game, S = g.S;
            if (!window.__started) { g.startGame(); window.__started = 1; S.paused = true; }
            for (let i = 0; i < ${n}; i++) g.step(1/60);
            const p = g.player.root.position, cam = g.camera.position;
            return JSON.stringify({ step: ${n}, phase: S.phase || '', y: +p.y.toFixed(2), px: +p.x.toFixed(2), pz: +p.z.toFixed(2),
                cam: [+cam.x.toFixed(2), +cam.y.toFixed(2), +cam.z.toFixed(2)], running: S.running !== false });
        })()`,
        returnByValue: true,
    });
    await sleep(150);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:\\Claude\\parkour-game\\screenshots\\_start_${n}.png`, Buffer.from(shot.data, 'base64'));
    console.log('step', n, r.result.value);
}
ws.close(); process.exit(0);
