// ============================================================================
//  perf.mjs —— 性能基准：帧时分布 / draw call / 三角面 / 显存 / 着色器数
//
//  · 每次运行新建独立标签页，跑完关掉（避免被上一轮卡死的页拖住）
//  · 无头 Edge 走 SwiftShader（纯 CPU 光栅）≈ 一块很弱的手机 GPU：
//    天生吃 fill rate / 片元着色 / 阴影 pass，正好用来量「光影有多重」
//  · --sweep：只加载一次，然后依次切 高→中→低 各测一遍（加载一次要两分钟，省时间）
//
//  用法：
//    node tools/perf.mjs --sweep --w=720 --h=450 --dpr=1 --secs=5
//    node tools/perf.mjs --w=720 --h=450 --q=low --secs=5
//    node tools/perf.mjs --mobile --sweep
//    node tools/perf.mjs --file=playable.bak-20261027b.html --secs=5   # 对照旧版
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
// 同时支持 --k=v 和 --k v 两种写法
const has = f => argv.includes(f) || argv.some(a => a.startsWith(f + '='));
const val = (f, d) => {
    const kv = argv.find(a => a.startsWith(f + '='));
    if (kv) return kv.slice(f.length + 1);
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const log = m => process.stderr.write('· ' + m + '\n');

const MOBILE = has('--mobile');
const SWEEP = has('--sweep');
const W = +val('--w', MOBILE ? 390 : 720);
const H = +val('--h', MOBILE ? 844 : 450);
const DPR = +val('--dpr', MOBILE ? 3 : 1);
const CPU = +val('--cpu', 1);
const SECS = +val('--secs', 5);
const THEME = val('--theme', 'tunnel');
const TAG = val('--tag', 'run');
const FILE = val('--file', 'playable.html');
const Q = val('--q', '');
const PORT_HTTP = val('--port', '8766');   // 8766 = 本地依赖测试服务器（_srv3.js）

const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14; 2211133C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';

// ---- 先清场：关掉所有残留的游戏标签页，否则多开会把 CPU 抢光 ----
const all = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const stale = all.filter(t => t.type === 'page' && (t.url.includes('8765') || t.url.includes('8766')));
for (const t of stale) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
if (stale.length) { log(`清掉 ${stale.length} 个残留标签页`); await sleep(1200); }

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const closeTarget = () => fetch(`http://127.0.0.1:${PORT}/json/close/${tgt.id}`).catch(() => { });

const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
        errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 240));
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

// 采样脚本：注入后等它自己 resolve，一次往返拿全部数据
const SAMPLE = (secs) => `(async () => {
    const t0 = performance.now();
    const frames = [];
    await new Promise(res => {
        const spin = () => {
            const n = performance.now();
            frames.push(n);
            if (n - t0 < ${secs * 1000}) requestAnimationFrame(spin);
            else res();
        };
        requestAnimationFrame(spin);
    });
    const g = window.__game;
    const d = [];
    for (let i = 1; i < frames.length; i++) d.push(frames[i] - frames[i - 1]);
    d.sort((a, b) => a - b);
    const pick = q => d.length ? +d[Math.min(d.length - 1, Math.floor(d.length * q))].toFixed(2) : 0;
    const mean = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;

    let meshes = 0, casters = 0, sprites = 0;
    g.scene.traverse(o => {
        if (o.isMesh) { meshes++; if (o.castShadow) casters++; }
        if (o.isSprite && o.visible) sprites++;
    });
    const dlight = g.scene.children.find(o => o.isDirectionalLight && o.castShadow);
    let litCount = 0; g.scene.traverse(o => { if (o.isPointLight && o.visible) litCount++; });
    return JSON.stringify({
        frames: d.length,
        fps: +(1000 / (mean || 1)).toFixed(1),
        avg: +mean.toFixed(2), p50: pick(0.5), p95: pick(0.95), p99: pick(0.99),
        calls: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        programs: g.renderer.info.programs ? g.renderer.info.programs.length : -1,
        dpr: +g.renderer.getPixelRatio().toFixed(2),
        buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
        shadow: g.renderer.shadowMap.enabled ? ('on/' + (dlight ? dlight.shadow.mapSize.x : 0)) : 'off',
        points: litCount,
        meshes, casters, sprites,
        tier: g.QUALITY ? g.QUALITY.tier : null,
        scale: g.QUALITY ? +g.QUALITY.scale.toFixed(2) : null,
        hz: g.QUALITY ? g.QUALITY.hz : null,
        dist: Math.round(g.S.D), state: g.S.state,
    });
})()`;

try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    // 注意：不要禁用缓存——63MB 内联脚本靠 V8 code cache 才能秒开，禁了每次都要冷解析
    await send('Emulation.setUserAgentOverride', { userAgent: MOBILE ? UA_MOBILE : UA_DESKTOP });
    await send('Emulation.setDeviceMetricsOverride', {
        width: W, height: H, deviceScaleFactor: DPR, mobile: MOBILE, screenWidth: W, screenHeight: H,
    });
    if (CPU > 1) await send('Emulation.setCPUThrottlingRate', { rate: CPU });
    log(`viewport ${W}x${H}@${DPR} mobile=${MOBILE} theme=${THEME} file=${FILE}${Q ? ' q=' + Q : ''}`);

    const qs = Q ? '&q=' + Q : '';
    // 缓存键用文件 mtime：同一份文件重复跑走 V8 code cache（秒开），改了文件才重新冷解析
    let stamp = Date.now();
    try { stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs); } catch (e) { }
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&perf=1${qs}&v=${stamp}` }, 60000);

    let ready = false;
    for (let i = 0; i < 400; i++) {
        try { if (await evalJS('typeof window.__game === "object" && !!window.__game.player', 8000)) { ready = true; break; } } catch (e) { }
        await sleep(400);
        if (i % 15 === 14) log('still loading... ' + (i + 1));
    }
    if (!ready) { console.log(JSON.stringify({ tag: TAG, ready: false, err: errs.slice(0, 3) })); await closeTarget(); process.exit(2); }
    log('game ready');

    if (THEME && THEME !== 'lakeside') {
        await evalJS(`(window.__forceTheme || function () { }).call(null, ${JSON.stringify(THEME)}); window.__game.startGame(); true`);
    }
    // 基准测试期间冻结自适应分辨率，否则「测的」和「改的」互相干扰
    await evalJS(`if (window.__game.QUALITY) window.__game.QUALITY.adaptive = false; true`);
    await sleep(3000);
    log('warmup done');

    const out = [];
    const tiers = SWEEP ? ['high', 'mid', 'low'] : (Q || null);
    if (SWEEP) {
        for (const t of tiers) {
            await evalJS(`window.__game.setQuality(${JSON.stringify(t)}); window.__game.startGame(); window.__game.QUALITY.adaptive = false; true`);
            await sleep(2000);   // 等一张新阴影贴图 + 着色器重编译
            const r = JSON.parse(await evalJS(SAMPLE(SECS), SECS * 1000 + 120000));
            out.push({ tier: t, ...r });
            log(`${t}: ${r.fps}fps  p50=${r.p50}ms  calls=${r.calls}  points=${r.points}  shadow=${r.shadow}`);
        }
        console.log(JSON.stringify({
            tag: TAG, cfg: { W, H, DPR, THEME, FILE, CPU },
            runs: out, err: errs.slice(0, 3),
        }, null, 1));
    } else {
        const r = JSON.parse(await evalJS(SAMPLE(SECS), SECS * 1000 + 120000));
        console.log(JSON.stringify({ tag: TAG, cfg: { W, H, DPR, THEME, FILE, CPU, Q }, ...r, err: errs.slice(0, 3) }));
    }
} catch (e) {
    console.log(JSON.stringify({ tag: TAG, error: e.message, err: errs.slice(0, 3) }));
}
await closeTarget();
process.exit(0);
