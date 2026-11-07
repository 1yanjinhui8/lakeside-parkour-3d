// 干净渲染测试：关阴影、关骨骼辅助线，看跑步姿态下肩部的黑色碎面到底是不是网格撕裂
import fs from 'node:fs';
const urlBase = 'http://127.0.0.1:8765/';
const outDir = 'D:\\Claude\\parkour-game\\screenshots\\_limb';
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = tabs.find(t => t.type === 'page');
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
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'view-guard2.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) {
    const r = await evalJs('!!window.__ready');
    if (r.result.value) break;
    await sleep(250);
}
await evalJs(`(() => {
    // 关阴影、藏骨骼辅助线
    window.__model.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    window.__model.parent.traverse(o => { if (o.isDirectionalLight) o.castShadow = false; });
    // SkeletonHelper 是 model 的兄弟节点
    for (const c of [...window.__model.parent.children]) if (c.type === 'SkeletonHelper') c.visible = false;
    return 1;
})()`);
// new_6 同款姿势：摆动期峰值（左膝110°，肩0°，肘90°，臂外展）
await evalJs(`(() => {
    const set = (n, x, z) => window.__model.traverse(o => { if (o.isBone && o.name === n) { o.rotation.x = x; if (z !== undefined) o.rotation.z = z; } });
    window.__model.traverse(o => { if (o.isBone) o.rotation.set(0, 0, 0); });
    set('LeftUpLeg', 0.21 + 0.54 * 0); // ph=6/8*TAU: hipL = -(0.21+0.54cos) → cos(1.5PI)=0 → -0.21
    set('LeftUpLeg', -0.21); set('RightUpLeg', 0.21);
    set('LeftLeg', 1.92); set('RightLeg', 0.42);
    set('LeftArm', 0, -0.28); set('RightArm', 0, 0.28);
    set('LeftForeArm', -1.57); set('RightForeArm', -1.57);
    set('Spine', 0.06);
    window.__model.updateMatrixWorld(true);
    const THREE = window.__THREE, m = window.__model;
    const box = new THREE.Box3().setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    window.__cam.position.set(c.x - 1.7, c.y + 0.45, c.z + 0.6);
    window.__cam.lookAt(c.x, c.y * 0.9, c.z);
    window.__render();
    return 1;
})()`);
const s1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${outDir}/clean_noshadow.png`, Buffer.from(s1.data, 'base64'));
console.log('saved clean_noshadow');
ws.close(); process.exit(0);
