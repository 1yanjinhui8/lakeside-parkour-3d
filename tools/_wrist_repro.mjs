// 手腕特写复现：左手臂后摆+屈肘，近景拍手腕区域，看粘连/拉丝
import fs from 'node:fs';
const PORT = 9222;
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
await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8765/view-guard2.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) { const r = await evalJs('!!window.__ready'); if (r.result.value) break; await sleep(250); }

const shot = async (name, js) => {
    await evalJs(js);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:\\Claude\\parkour-game\\screenshots\\_wrist\\${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('saved', name);
};
fs.mkdirSync('D:\\Claude\\parkour-game\\screenshots\\_wrist', { recursive: true });

const poseBase = `(() => {
    window.__model.traverse(o => { if (o.isBone) o.rotation.set(0,0,0); });
    const set = (n,x,y,z) => window.__model.traverse(o => { if (o.isBone && o.name===n) o.rotation.set(x,y,z); });
    // 截图同款：左臂后摆 + 屈肘（带游戏里的外展）
    set('LeftArm', %ARMX%, 0, -0.15);
    set('LeftForeArm', %ELB%, 0, 0);
    window.__model.updateMatrixWorld(true);
    // 相机怼到左手腕：先算手腕世界坐标
    const THREE = window.__THREE;
    let hand = null; window.__model.traverse(o => { if (o.isBone && o.name==='LeftHand') hand = o; });
    const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
    window.__cam.position.set(hp.x - 0.55, hp.y + 0.15, hp.z + 0.45);
    window.__cam.lookAt(hp.x, hp.y, hp.z);
    window.__render();
    return hp.toArray().map(v=>+v.toFixed(3));
})()`;

for (const [tag, armX, elb] of [
    ['a_back_elb90', 0.5, -1.57],
    ['b_back_elb120', 0.5, -2.09],
    ['c_fwd_elb107', -0.58, -1.87],
    ['d_neutral_elb90', 0, -1.57],
]) {
    const js = poseBase.replace('%ARMX%', armX).replace('%ELB%', elb);
    const r = await evalJs(js);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:\\Claude\\parkour-game\\screenshots\\_wrist\\${tag}.png`, Buffer.from(s.data, 'base64'));
    console.log('saved', tag, 'handPos', r.result.value);
}
ws.close(); process.exit(0);
