// ============================================================================
//  perfcheck.mjs —— 一次加载跑完：页面自检(selfTest) + 高/中/低三档性能采样
//
//  无头环境冷启动要几分钟（63MB 内联脚本 + 模型解码 + 着色器编译），
//  所以把「验证」和「测量」塞进同一次加载，别来回重载。
//
//  用法： node tools/perfcheck.mjs [--w=720 --h=450 --dpr=1 --secs=4 --q=mid]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    if (kv) return kv.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const log = m => process.stderr.write('· ' + m + '\n');

const W = +val('--w', 720), H = +val('--h', 450), DPR = +val('--dpr', 1);
const SECS = +val('--secs', 4);
const THEME = val('--theme', 'tunnel');
const Q0 = val('--q', 'mid');
const FILE = val('--file', 'playable.html');
const PORT_HTTP = val('--port', '8766');
const NORM = +val('--normalize', 0);   // >0：所有档位强制用这个像素比渲染（对照光影开销）

const all = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
for (const t of all.filter(t => t.type === 'page' && (t.url.includes('8765') || t.url.includes('8766')))) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(800);

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
        errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    }
});
const send = (method, params = {}, tmo = 30000) => {
    const id = ++seq;
    const p = new Promise((res, rej) => pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))));
    ws.send(JSON.stringify({ id, method, params }));
    return Promise.race([p, sleep(tmo).then(() => { throw new Error('CDP timeout: ' + method); })]);
};
const evalJS = async (expression, tmo = 30000) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};

const SAMPLE = (secs) => `(async () => {
    const t0 = performance.now();
    const frames = [];
    await new Promise(res => {
        const spin = () => {
            const n = performance.now();
            frames.push(n);
            if (n - t0 < ${secs * 1000}) requestAnimationFrame(spin); else res();
        };
        requestAnimationFrame(spin);
    });
    const g = window.__game;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    const pick = q => d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * q))].toFixed(2) : 0;
    const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    let lit = 0, casters = 0;
    g.scene.traverse(o => { if (o.isPointLight && o.visible) lit++; if (o.isMesh && o.castShadow) casters++; });
    const dl = g.scene.children.find(o => o.isDirectionalLight && o.castShadow);
    return JSON.stringify({
        frames: d.length,
        fps: +(1000 / (mean || 1)).toFixed(1),
        avg: +mean.toFixed(2), p50: pick(0.5), p95: pick(0.95), p99: pick(0.99),
        calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
        programs: g.renderer.info.programs ? g.renderer.info.programs.length : -1,
        dpr: +g.renderer.getPixelRatio().toFixed(2),
        buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
        shadow: g.renderer.shadowMap.enabled ? ('on/' + (dl ? dl.shadow.mapSize.x : 0)) : 'off',
        lit, casters,
        blob: !!(g.BlobShadow && g.BlobShadow.mesh && g.BlobShadow.mesh.visible),
        tier: g.QUALITY.tier, scale: +g.QUALITY.scale.toFixed(2), hz: g.QUALITY.hz,
        dist: Math.round(g.S.D), state: g.S.state,
    });
})()`;

const report = { file: FILE, cfg: { W, H, DPR, THEME, Q0 } };
try {
    await send('Page.enable');
    await send('Runtime.enable');
    // 关键：新开的标签在无头窗口里默认是「后台页」，定时器和 rAF 会被节流到 1s 一次，
    // 63MB 脚本初始化能拖到十几分钟。必须把它提到前台 + 关闭焦点模拟。
    await send('Page.bringToFront').catch(() => { });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
    await send('Emulation.setDeviceMetricsOverride', {
        width: W, height: H, deviceScaleFactor: DPR, mobile: false, screenWidth: W, screenHeight: H,
    });
    const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
    const t0 = Date.now();
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&perf=1&q=${Q0}&v=${stamp}` }, 60000);
    log('navigating (cold load can take minutes)...');

    let ready = false;
    for (let i = 0; i < 400; i++) {
        try { if (await evalJS('typeof window.__game === "object" && !!window.__game.player', 8000)) { ready = true; break; } } catch (e) { }
        await sleep(400);
        if (i % 20 === 19) log(`still loading... ${((Date.now() - t0) / 1000) | 0}s`);
    }
    report.loadMs = Date.now() - t0;
    if (!ready) { report.error = 'not ready'; report.err = errs.slice(0, 5); console.log(JSON.stringify(report, null, 1)); process.exit(2); }
    log(`ready in ${(report.loadMs / 1000).toFixed(0)}s`);

    // ---- ① 页面自检 ----
    const st = JSON.parse(await evalJS(`JSON.stringify(window.__game.selfTest())`, 180000));
    report.selfTest = { pass: st.pass, fail: st.fail, total: st.total, failed: st.results.filter(r => !r.pass) };
    log(`selfTest ${st.pass}/${st.total}`);

    // ---- ② 三档性能 ----
    // 冻结游戏逻辑但保留渲染：画面停在障碍密集处，三档测的是「同一帧」的渲染开销，
    // 不会因为角色半路撞死/镜头切换引入噪声
    await evalJS(`(window.__forceTheme || function () { }).call(null, ${JSON.stringify(THEME)}); window.__game.startGame(); window.__game.QUALITY.adaptive = false; true`);
    await sleep(4000);
    await evalJS(`window.__game.S.paused = true; true`);
    await sleep(500);

    report.runs = [];
    for (const t of ['high', 'mid', 'low']) {
        await evalJS(`window.__game.setQuality(${JSON.stringify(t)}); window.__game.QUALITY.adaptive = false; window.__game.S.paused = true; true`);
        if (NORM > 0) {
            // 归一化像素比：让各档都按同一个分辨率为渲染，隔离掉「分辨率」这个变量，
            // 剩下的差异才是纯光影开销（阴影 pass / 点光数量 / 阴影滤波）
            await evalJS(`window.__game.renderer.setPixelRatio(${NORM}); window.__game.QUALITY.scale = -1; true`);
        }
        await sleep(2500);   // 等阴影贴图重建 + 着色器重编译（切档会触发一次）
        const r = JSON.parse(await evalJS(SAMPLE(SECS), SECS * 1000 + 180000));
        report.runs.push({ tier: t, ...r });
        log(`${t}: ${r.fps}fps p50=${r.p50} calls=${r.calls} points=${r.lit} shadow=${r.shadow} buffer=${r.buffer.join('x')}`);
    }
} catch (e) {
    report.error = e.message;
}
report.err = errs.slice(0, 5);
console.log(JSON.stringify(report, null, 1));
await fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`).catch(() => { });
process.exit(0);
