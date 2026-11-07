// 截图器（分阶段重连 + 超时 + 日志）
// 用法： node tools/shot.mjs <scene> <out.png> [--fresh]
// scene: castle | castle2 | tunnel-pillars | cyber | cyberfar | lakeside | tunnel | city | campus | run
import fs from 'node:fs';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const fresh = !process.argv.includes('--reuse');   // 默认每次重载：复用旧页面时主循环可能已经停了
const scene = args[0] || 'castle';
const out = args[1] || 'screenshots/_shot.png';
const PORT = 9222;
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log('[' + ((Date.now() - T0) / 1000).toFixed(1) + 's] ' + m);

function connect(page) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let seq = 0;
        const pending = new Map();
        const state = { ws, logs: [], errs: [], closed: false };
        ws.addEventListener('open', () => {
            const raw = (method, params = {}) => new Promise((res, rej) => {
                const id = ++seq;
                pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
                ws.send(JSON.stringify({ id, method, params }));
            });
            state.raw = raw;
            state.evalTimeout = (expr, ms) => Promise.race([
                raw('Runtime.evaluate', { expression: expr, returnByValue: true }),
                sleep(ms).then(() => { throw new Error('evaluate 超时'); }),
            ]);
            resolve(state);
        });
        ws.addEventListener('error', reject);
        ws.addEventListener('close', () => { state.closed = true; });
        ws.addEventListener('message', ev => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
            if (m.method === 'Runtime.consoleAPICalled') state.logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
            if (m.method === 'Runtime.exceptionThrown') state.errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 400));
        });
    });
}

const listPages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page');

async function findLive() {
    for (const p of await listPages()) {
        if (!p.url.includes('8765')) continue;
        try {
            const c = await connect(p);
            const r = await c.evalTimeout('document.title + "|" + (window.__game ? "y" : "n")', 5000);
            if (String(r.result.value).startsWith('胡艺凡') && String(r.result.value).endsWith('|y')) { log('复用已加载页面'); return c; }
            c.ws.close();
        } catch (e) { /* 不可用就跳过 */ }
    }
    return null;
}

let C = fresh ? null : await findLive();
if (!C) {
    let page = (await listPages()).find(p => p.url.includes('8765')) || (await listPages())[0];
    const c0 = await connect(page);
    const url = 'http://127.0.0.1:8765/playable.html?autostart&v=' + Date.now();
    log('navigate ' + url);
    try { await c0.raw('Page.navigate', { url }); } catch (e) { log('navigate 异常（正常，导航会断 WS）'); }
    await sleep(6000);
    // 导航会把 WS 断掉，重新找页面连
    let ok = false;
    for (let i = 0; i < 24; i++) {
        C = await findLive();
        if (C) { ok = true; break; }
        await sleep(2000);
    }
    if (!ok) { log('页面没起来'); process.exit(2); }
}
log('游戏就绪');

await C.raw('Runtime.enable').catch(() => {});
await C.raw('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }).catch(() => {});

const driver = `(() => {
    const g = window.__game, S = g.S;
    const step = n => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    const clearAll = () => { for (const o of g.obstacles) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; } };
    for (const id of ['menu','pause','over','loading','powers','msg']) {
        const el = document.getElementById(id); if (el) el.classList.add('hidden');
    }
    g.startGame();
    S.paused = true;
    window.__freezeCam = false;      // 清掉上一张截图留下的冻结机位
    const scene = ${JSON.stringify(scene)};

    if (scene === 'castle' || scene === 'castle2') {
        window.__forceTheme('lakeside');
        S.power.shield = 999;
        clearAll();
        step(scene === 'castle' ? 40 : 120);
        window.__freezeCam = true;
        const cam = g.camera;
        if (scene === 'castle') { cam.position.set(9, 11, 26); cam.lookAt(-16, 15, -46); cam.fov = 66; }
        else { cam.position.set(2.4, 6, 16); cam.lookAt(-18, 18, -40); cam.fov = 70; }
        cam.updateProjectionMatrix();
    } else if (scene === 'rain' || scene === 'mist') {
        // 天气截图：手动指定天气，再把过渡推到稳态
        window.__forceTheme('lakeside');
        S.power.shield = 999;
        step(30);
        window.__wx.setWeather(scene, true);
        for (let k = 0; k < 180; k++) window.__wx.update(1 / 60, S.D);
    } else if (scene === 'revive-close') {
        // 特写机位：判断币面图案和配色到底立不立得住
        window.__forceTheme('lakeside');
        S.transGrace = 9999;
        for (const o of g.obstacles) { o.z = 500; o.mesh.position.z = 500; }
        const spot = g.placeRevive(S.D + 200);
        const pk = g.pickups[g.pickups.length - 1];
        pk.z = -6; pk.mesh.position.z = pk.z;
        step(1);
        window.__freezeCam = true;
        const cam = g.camera;
        cam.position.set(pk.x + 0.9, pk.y + 0.7, pk.z + 3.6);
        cam.lookAt(pk.x, pk.y, pk.z);
        cam.fov = 50; cam.updateProjectionMatrix();
    } else if (scene === 'revive' || scene === 'revive-far') {
        // 复活币：摆在正前方 9 米 / 34 米，看造型和远处能不能认出来
        window.__forceTheme('lakeside');
        S.transGrace = 9999;
        for (const o of g.obstacles) { o.z = 500; o.mesh.position.z = 500; }
        const far = scene === 'revive-far';
        const spot = g.placeRevive(S.D + 200);
        const pk = g.pickups[g.pickups.length - 1];
        pk.z = far ? -46 : -8;                       // 直接摆到眼前（placeRevive 本身有 60m 下限）
        pk.mesh.position.z = pk.z;
        S.lane = spot.lane; S.x = [-2.4, 0, 2.4][spot.lane]; S.prevLane = spot.lane;
        step(1);
    } else if (scene === 'tunnel-train') {
        // 迎面火车逼近到 35m 以内，看车灯够不够亮
        window.__forceTheme('tunnel');
        S.transGrace = 999;
        let guard = 0;
        while (!g.obstacles.some(o => o.moving && o.z > -35) && guard++ < 14000) step(1);
        const tr = g.obstacles.find(o => o.moving);
        if (tr) { S.lane = tr.lane === 0 ? 2 : 0; S.x = tr.lane === 0 ? 2.4 : -2.4; S.prevLane = S.lane; }
        step(2);
    } else if (scene === 'tunnel-pillars') {
        window.__forceTheme('tunnel');
        S.transGrace = 999;
        let guard = 0;
        // 一直跑到柱段逼近到 45 米以内，才有东西可看
        while (!g.obstacles.some(o => o.type === 'pillar' && o.z > -45) && guard++ < 9000) step(1);
        // 把非柱子障碍清出画面，别让横杆抢前景
        for (const o of g.obstacles) {
            if (o.type !== 'pillar' && !o.moving) { o.z = 400; o.mesh.position.z = 400; }
        }
        // 再往前跑到柱段贴到 14 米，柱子才够大
        guard = 0;
        while (!g.obstacles.some(o => o.type === 'pillar' && o.z > -14) && guard++ < 900) step(1);
        S.lane = 0; S.x = -2.4; S.prevLane = 0;   // 站在左道看中间道的柱阵
    } else if (scene === 'pillars-far') {
        window.__forceTheme('tunnel');
        S.transGrace = 999;
        let guard = 0;
        while (!g.obstacles.some(o => o.type === 'pillar') && guard++ < 8000) step(1);
        step(4);
    } else if (scene === 'cyber' || scene === 'cyberfar') {
        window.__forceTheme('city');
        S.transGrace = 999;
        g.Scene.next = 'campus';
        g.Scene.segEnd = S.D + 40;
        step(scene === 'cyber' ? 295 : 170);
    } else if (['lakeside','tunnel','city','campus'].includes(scene)) {
        window.__forceTheme(scene);
        S.power.shield = 999;
        clearAll();
        step(40);
    } else {
        step(20);
    }
    S.paused = true;
    // 无头窗口里 rAF 可能不跑，手动摆好机位并强制渲染一帧，否则截到的是旧画面
    if (!window.__freezeCam) {
        const cam = g.camera;
        cam.position.set(S.x * 0.7, 4.3 + S.y * 0.75, 7.4);
        cam.lookAt(S.x * 0.5, 1.3 + S.y * 0.6, -9);
        cam.fov = cam.aspect < 1 ? 78 : 62;
        cam.updateProjectionMatrix();
    }
    g.renderer.render(g.scene, g.camera);
    return JSON.stringify({
        scene: g.Scene.id, D: Math.round(S.D), state: S.state,
        calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
        merge: g.mergeState, obstacles: g.obstacles.length,
        pillars: g.obstacles.filter(o => o.type === 'pillar').length,
        moving: g.obstacles.filter(o => o.moving).map(o => o.type),
        cam: g.camera.position.toArray().map(v => +v.toFixed(1)),
    });
})()`;

try {
    const r = await C.evalTimeout(driver, 90000);
    log('driver: ' + r.result.value);
} catch (e) { log('driver 失败: ' + e.message); }

await sleep(1500);
try {
    const shot = await Promise.race([
        C.raw('Page.captureScreenshot', { format: 'png' }),
        sleep(40000).then(() => { throw new Error('screenshot 超时'); }),
    ]);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    log('saved ' + out + ' (' + fs.statSync(out).size + ' bytes)');
    console.log(JSON.stringify({ ok: true, out, errs: C.errs.slice(0, 5), logs: C.logs.slice(-8) }, null, 1));
} catch (e) { log('截图失败: ' + e.message); process.exit(3); }
process.exit(0);
