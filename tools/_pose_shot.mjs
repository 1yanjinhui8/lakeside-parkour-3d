import fs from 'node:fs';
const PORT = 9222;
const poses = JSON.parse(process.argv[2]);
const camDir = JSON.parse(process.argv[3]); // [x,y,z] 相对方位
const outName = process.argv[4];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = tabs.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 640, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8765/view-guard2.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) { const r = await evalJs('!!window.__ready'); if (r.result.value) break; await sleep(250); }
await evalJs(`(() => {
    window.__model.traverse(o => { if (o.isBone) o.rotation.set(0,0,0); });
    for (const [bn, x, y, z] of ${JSON.stringify(poses)})
        window.__model.traverse(o => { if (o.isBone && o.name === bn) o.rotation.set(x||0, y||0, z||0); });
    window.__model.updateMatrixWorld(true);
    const THREE = window.__THREE, m = window.__model;
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3()), s = 1.7, v = ${JSON.stringify(camDir)};
    window.__cam.position.set(c.x + v[0]*s, c.y + v[1]*s, c.z + v[2]*s);
    window.__cam.lookAt(c.x, c.y*0.9, c.z);
    window.__render();
    return 1;
})()`);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:////////Claude////////parkour-game////////screenshots////////_gaitcmp////////' + outName + '.png', Buffer.from(shot.data, 'base64'));
console.log('saved', outName);
ws.close(); process.exit(0);
