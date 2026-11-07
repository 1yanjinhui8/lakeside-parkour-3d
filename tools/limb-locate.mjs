// 四肢定位：输出保安模型各关节世界坐标 + 侧面/正面截图标定四肢位置
import fs from 'node:fs';
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
const outDir = process.argv[3] || 'D:\\Claude\\parkour-game\\screenshots\\_limb';
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
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: urlBase + 'view-guard2.html?v=' + Date.now() });
for (let i = 0; i < 100; i++) {
    const r = await evalJs('!!window.__ready');
    if (r.result.value) break;
    await sleep(250);
}

// 1) 打印所有四肢关节的世界坐标（rest pose）
const joints = await evalJs(`(() => {
    const out = {};
    window.__model.traverse(o => {
        if (!o.isBone) return;
        if (/Hips|Spine$|Head|UpLeg|[^e]Leg$|Foot|[^e]Arm$|ForeArm|Hand/.test(o.name)) {
            const v = new window.__THREE.Vector3();
            o.getWorldPosition(v);
            out[o.name] = [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
        }
    });
    return JSON.stringify(out);
})()`);
console.log('JOINTS', joints.result.value);

fs.mkdirSync(outDir, { recursive: true });
const shoot = async (name, view, poses) => {
    await evalJs(`__view('${view}', ${JSON.stringify(poses || [])})`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.data, 'base64'));
    console.log('saved', name);
};

// 2) 标定截图：rest（四肢自然位）→ 各关节正负向试动，确认旋转符号约定
await shoot('a_rest_side', 'left');
await shoot('b_rest_front', 'front');
// 髋：+x / -x 哪个是前屈
await shoot('c_hip_pos', 'left', [['LeftUpLeg', 0.7]]);
await shoot('d_hip_neg', 'left', [['LeftUpLeg', -0.7]]);
// 膝：+x / -x 哪个是屈膝
await shoot('e_knee_pos', 'left', [['LeftLeg', 1.0]]);
await shoot('f_knee_neg', 'left', [['LeftLeg', -1.0]]);
// 肩：+x / -x 哪个是前摆
await shoot('g_shoulder_pos', 'left', [['LeftArm', 0.7]]);
await shoot('h_shoulder_neg', 'left', [['LeftArm', -0.7]]);
// 肘：+x / -x 哪个是屈肘
await shoot('i_elbow_pos', 'left', [['LeftForeArm', 1.0]]);
await shoot('j_elbow_neg', 'left', [['LeftForeArm', -1.0]]);
// 肩外展：z 正负哪个让手臂离开肚子（poses 格式 [骨名, x, y, z]）
await shoot('k_armz_pos', 'front', [['LeftArm', 0, 0, 0.4]]);
await shoot('l_armz_neg', 'front', [['LeftArm', 0, 0, -0.4]]);
// 组合跑步姿态预览：肩前摆 + 屈肘90° + 外展
await shoot('m_runpose_front', 'front', [['LeftArm', -0.5, 0, 0.25], ['LeftForeArm', -1.57, 0, 0], ['RightArm', 0.5, 0, -0.25], ['RightForeArm', -1.57, 0, 0], ['LeftUpLeg', -0.6, 0, 0], ['RightUpLeg', 0.35, 0, 0], ['RightLeg', 1.6, 0, 0]]);
await shoot('n_runpose_side', 'left', [['LeftArm', -0.5, 0, 0.25], ['LeftForeArm', -1.57, 0, 0], ['RightArm', 0.5, 0, -0.25], ['RightForeArm', -1.57, 0, 0], ['LeftUpLeg', -0.6, 0, 0], ['RightUpLeg', 0.35, 0, 0], ['RightLeg', 1.6, 0, 0]]);
console.log('saved armz + runpose tests');
ws.close(); process.exit(0);
