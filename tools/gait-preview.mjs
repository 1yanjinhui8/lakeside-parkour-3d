// 步态预览：按 index.html 的步态公式摆姿势，连拍一个步态周期（侧面+正面），用于改参前后对比
// 用法: node tools/gait-preview.mjs [urlBase] [outDir] [tag] [参数JSON]
import fs from 'node:fs';
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
const tag = process.argv[4] || 'cur';
const outDir = (process.argv[3] || 'D:\\Claude\\parkour-game\\screenshots\\_gaitcmp') ;
const P = process.argv[5] ? JSON.parse(process.argv[5]) : {};
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
const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 640, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'view-guard2.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) {
    const r = await evalJs('!!window.__ready');
    if (r.result.value) break;
    await sleep(250);
}
// 把步态公式注入页面：与 index.html updateChaser 里的公式保持一致，参数可覆盖
await evalJs(`window.__gait = (ph, P) => {
    const TAU = Math.PI * 2;
    const HIP_MID = P.HIP_MID, HIP_AMP = P.HIP_AMP, SH_MID = P.SH_MID, SH_AMP = P.SH_AMP;
    const K_BASE = P.K_BASE, K_SWING = P.K_SWING, K_STANCE = P.K_STANCE;
    const ELB_MID = P.ELB_MID, ELB_AMP = P.ELB_AMP, ARM_Z = P.ARM_Z || 0;
    const hipX = (p) => -(HIP_MID + HIP_AMP * Math.cos(p));
    const kneeX = (p) => {
        const u = (((p % TAU) + TAU) % TAU) / TAU;
        if (u >= 0.5) return K_BASE + K_SWING * Math.pow(Math.max(0, Math.sin((u - 0.5) * 2 * Math.PI)), 0.9);
        return K_BASE + K_STANCE * Math.sin(Math.PI * Math.min(1, u / 0.5));
    };
    const phR = ph + Math.PI;
    const set = (name, x, z) => window.__model.traverse(o => {
        if (o.isBone && o.name === name) { o.rotation.x = x; if (z !== undefined) o.rotation.z = z; }
    });
    window.__model.traverse(o => { if (o.isBone) o.rotation.set(0, 0, 0); });
    set('LeftUpLeg', hipX(ph)); set('RightUpLeg', hipX(phR));
    set('LeftLeg', kneeX(ph)); set('RightLeg', kneeX(phR));
    set('LeftArm', SH_MID + SH_AMP * Math.cos(ph), ARM_Z);
    set('RightArm', SH_MID - SH_AMP * Math.cos(ph), -ARM_Z);
    set('LeftForeArm', -(ELB_MID - ELB_AMP * Math.cos(ph)));
    set('RightForeArm', -(ELB_MID + ELB_AMP * Math.cos(ph)));
    set('Spine', 0.06); set('Head', -0.02);
    window.__model.updateMatrixWorld(true);
    // 返回关键角度（度）便于核对
    const d = r => +(r * 180 / Math.PI).toFixed(1);
    return JSON.stringify({ hipL: d(hipX(ph)), kneeL: d(kneeX(ph)), shL: d(SH_MID + SH_AMP * Math.cos(ph)), elbL: d(-(ELB_MID - ELB_AMP * Math.cos(ph))) });
}`);
const paramsJson = JSON.stringify(P);
fs.mkdirSync(outDir, { recursive: true });
console.log('PARAMS', paramsJson);
for (let k = 0; k < 8; k++) {
    const phExpr = (k / 8) + ' * Math.PI * 2';
    const angles = await evalJs(`window.__gait(${phExpr}, ${paramsJson})`);
    // 渲染（复用 __view 的相机，但不重置骨骼：直接用页面里的 renderer 重渲）
    await evalJs(`(() => {
        const m = window.__model, THREE = window.__THREE;
        const box = new THREE.Box3().setFromObject(m);
        const c = box.getCenter(new THREE.Vector3()), s = 1.7;
        const v = [-1, 0.25, 0.35];
        window.__cam.position.set(c.x + v[0] * s, c.y + v[1] * s, c.z + v[2] * s);
        window.__cam.lookAt(c.x, c.y * 0.9, c.z);
        window.__render();
        return 1;
    })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${outDir}/${tag}_${k}.png`, Buffer.from(shot.data, 'base64'));
    console.log(tag, k, angles.result.value);
}
ws.close(); process.exit(0);
