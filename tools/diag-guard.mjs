// 诊断保安是否可见：node tools/diag-guard.mjs
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
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
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
await sleep(1500);
const r = await send('Runtime.evaluate', {
    expression: `(() => {
        const g = window.__game, S = g.S, c = g.chaser, m = g.chaserModel, THREE = null;
        g.startGame(); S.paused = true;
        for (let i = 0; i < 30; i++) g.step(1/60);
        S.chaserTimer = 30;
        for (let i = 0; i < 150; i++) g.step(1/60);
        const info = { dist: +S.chaserDist.toFixed(2), rootVisible: c.root.visible,
            rootPos: c.root.position.toArray().map(v => +v.toFixed(2)),
            modelChildren: m.children.length,
            modelPos: m.position.toArray().map(v => +v.toFixed(2)),
            modelScale: m.scale.toArray().map(v => +v.toFixed(2)) };
        let meshes = 0, visMeshes = 0, matName = '';
        m.traverse(o => { if (o.isMesh) { meshes++; if (o.visible) visMeshes++; if (o.material && !matName) matName = o.material.type + '/' + (o.material.name || ''); } });
        info.meshes = meshes; info.visMeshes = visMeshes; info.mat = matName;
        if (m.children[0]) {
            m.children[0].updateWorldMatrix(true, true);
            const v = m.children[0].position.clone();
            m.children[0].getWorldPosition(v);
            info.modelWorld = v.toArray().map(x => +x.toFixed(2));
            info.localBox = JSON.stringify(m.children[0].geometry ? null : null);
        }
        return JSON.stringify(info);
    })()`, returnByValue: true,
});
console.log(r.result.value);
console.log(logs.filter(l => l.includes('保安') || l.includes('角色')).join('\n'));
ws.close(); process.exit(0);
