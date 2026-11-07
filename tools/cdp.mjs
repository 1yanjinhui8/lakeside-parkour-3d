// 用 Chrome DevTools Protocol 驱动无头 Edge：加载游戏、在页面里执行场景脚本、截图，
// 并把页面异常/console 一起打印出来（比 --screenshot 稳定，能看到真实报错）。
// 用法： node tools/cdp.mjs <scene> <outfile> [urlBase]
// 需要先启动： msedge --headless=new --remote-debugging-port=9222 ...（见 tools/cdp.cmd.ps1）
import fs from 'node:fs';

const [, , scene = 'menu', out = 'screenshots/_cdp.png', urlBase = 'http://127.0.0.1:8765/'] = process.argv;
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getPage() {
    for (let i = 0; i < 80; i++) {
        try {
            const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = tabs.find(t => t.type === 'page');
            if (page) return page;
        } catch { /* Edge 还没起来 */ }
        await sleep(300);
    }
    throw new Error('连不上 CDP 端口 9222');
}

const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

let seq = 0;
const pending = new Map();
const consoleLogs = [];
const exceptions = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') {
        consoleLogs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        exceptions.push((d.exception?.description || d.text || '').slice(0, 400));
    }
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const url = urlBase + (scene === 'menu' || scene === 'face' || scene === 'body' ? 'playable.html' : 'playable.html?autostart')
    + (urlBase.includes('?') ? '' : '') + (scene === 'menu' || scene === 'face' || scene === 'body' ? '?v=' : '&v=') + Date.now()
    + (scene.startsWith('q:') ? '&' + scene.slice(2) : '');

// 机器人长跑：?scene=botrun:3000 → 不换主题跑满 3000m，跨 ≥3 次转场，断言无异常/无 NaN/无障碍断档
if (scene.startsWith('botrun')) {
    const target = +(scene.split(':')[1] || 3000);
    await send('Page.navigate', { url });
    let readyR = false;
    for (let i = 0; i < 120; i++) {
        const r0 = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
        if (r0.result.value) { readyR = true; break; }
        await sleep(250);
    }
    if (!readyR) { console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions })); process.exit(2); }
    const botSrc = `(function (target) { const g = window.__game, S = g.S;
        const errs = [];
        window.addEventListener('error', e => errs.push(e.message));
        g.startGame();
        const ahead = lane => g.obstacles.filter(o => o.lane === lane && o.z + o.len / 2 > -Math.max(16, S.speed * 0.9) && o.z - o.len / 2 < 1);
        const rampBefore = (lane, o) => g.obstacles.some(r => r.type === 'ramp' && r.lane === lane && Math.abs((r.z - r.len / 2) - (o.z + o.len / 2)) < 0.6);
        const riding = o => o.ride && S.y >= o.h1 - 0.6 && o.z - o.len / 2 < 0.2 && o.z + o.len / 2 > -0.2 && Math.abs(o.x - S.x) < 1.5;
        const blocked = lane => ahead(lane).some(o => o.ride && o.h1 > 1.6 && !riding(o) && !rampBefore(lane, o) && o.z + o.len / 2 < 0.5);
        // 车道威胁度 = 该道即将到达的最近障碍前沿（front 越接近 0 越危险；已掠过的忽略）
        const threat = lane => { let m = -Infinity; for (const o of ahead(lane)) { const f = o.z + o.len / 2; if (f < 2 && f > m) m = f; } return m; };
        function bot() {
            if (blocked(S.lane)) {   // 空中也能换道（moveLane 无落地限制）
                // 换道时选「威胁最小」的车道，别刚变道就撞上新障碍
                let best = null, bestThreat = Infinity;
                for (const d of [-1, 1]) { const l = S.lane + d;
                    if (l < 0 || l > 2 || blocked(l)) continue;
                    // 目标道正被车体占据（并线=撞侧面）→ 排除
                    if (g.obstacles.some(o => o.lane === l && o.ride && o.z - o.len / 2 < 1 && o.z + o.len / 2 > -3)) continue;
                    const t = threat(l);
                    if (t < bestThreat) { best = l; bestThreat = t; } }
                if (best !== null) g.moveLane(best - S.lane);
            }
            for (const o of ahead(S.lane)) {
                const front = o.z + o.len / 2;
                if (front > -S.speed * 0.5 && front < -S.speed * 0.12) {
                    if (o.ride && o.h1 <= 1.6) g.jump();          // 矮车顶（小汽车）：跳上去触发弹跳
                    else if (!o.ride && o.type !== 'ramp' && (o.h0 || 0) <= 0.5) g.jump();
                    else if (!o.ride && (o.h0 || 0) > 0.5) g.roll();
                }
            }
        }
        const visits = [g.Scene.id];
        let died = null, nanAt = -1, i = 0;
        let lastSwapD = 0, spawnGapMax = 0;
        const trace = [];   // 死亡前 90 帧回放
        const maxFrames = 60 * 60 * 10;
        for (; i < maxFrames && S.D < target; i++) {
            if (S.state === 'playing' && !S.flying) bot();
            g.step(1 / 60);
            trace.push({ D: +S.D.toFixed(1), lane: S.lane, x: +S.x.toFixed(2), y: +S.y.toFixed(2),
                blk: [0, 1, 2].map(l => blocked(l) ? 1 : 0).join(''),
                veh: [0, 1, 2].map(l => { const v = ahead(l).filter(o => o.ride && o.h1 > 1.6 && !rampBefore(l, o)); return v.length ? +(v[0].z + v[0].len / 2).toFixed(1) : null; }) });
            if (trace.length > 90) trace.shift();
            if (![S.x, S.y, S.vy, S.D].every(Number.isFinite)) { nanAt = i; break; }
            if (g.Scene.id !== visits[visits.length - 1]) { visits.push(g.Scene.id); lastSwapD = S.D; }
            if (visits.length > 1 && g.obstacles.length > 0 && S.D - lastSwapD > spawnGapMax) spawnGapMax = S.D - lastSwapD;
            if (S.state !== 'playing') {
                const near = g.obstacles.filter(o => o.z - o.len / 2 < 1 && o.z + o.len / 2 > -1 && Math.abs(o.x - S.x) < 1.8)
                    .map(o => o.type + '@z' + o.z.toFixed(1) + ' x' + o.x.toFixed(2) + ' h0=' + o.h0 + ' h1=' + o.h1 + ' wob=' + o.wobble);
                died = (document.getElementById('overTitle') || {}).textContent + ' @D=' + S.D.toFixed(0) + ' scene=' + g.Scene.id
                    + ' y=' + S.y.toFixed(2) + ' rolling=' + S.rolling.toFixed(2) + ' chaserDist=' + S.chaserDist.toFixed(2) + ' near=[' + near.join(' | ') + ']'
                    + ' trace=' + JSON.stringify(trace.filter((t, idx) => idx % 6 === 0 || idx > trace.length - 8));
                break;
            }
        }
        return JSON.stringify({
            D: Math.floor(S.D), frames: i, visits, swaps: visits.length - 1,
            died, nanAt, errs: errs.slice(0, 5), spawnGapMax: +spawnGapMax.toFixed(1),
            obstacles: g.obstacles.length, state: S.state, scene: g.Scene.id,
        });
    })(${target})`;
    const r = await send('Runtime.evaluate', { expression: botSrc, returnByValue: true, awaitPromise: true });
    await sleep(300);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({
        scene, ok: true, out,
        result: r.result.value ? JSON.parse(r.result.value) : null,
        exceptions: exceptions.slice(0, 8), logs: consoleLogs.slice(-8),
    }, null, 1));
    ws.close();
    process.exit(0);
}

// 通用模型查看器截图：?scene=viewer → 打开 _view_model.html
if (scene === 'viewer') {
    await send('Page.navigate', { url: urlBase + '_view_model.html?f=screenshots/model_preview.glb&v=' + Date.now() });
    await sleep(5000);
    const shot0 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot0.data, 'base64'));
    console.log(JSON.stringify({ scene, ok: true, out, exceptions: exceptions.slice(0, 5) }, null, 1));
    ws.close();
    process.exit(0);
}

// 浏览器内置自检场景：直接打开 ?selftest 看结果
if (scene === 'selftest') {
    await send('Page.navigate', { url: urlBase + 'playable.html?selftest&v=' + Date.now() });
    await sleep(6000);
    const txt = await send('Runtime.evaluate', {
        expression: `(() => { const els = document.querySelectorAll('div');
            for (const el of els) if (el.textContent.includes('全部通过') || el.textContent.includes('有失败')) return el.textContent;
            return '(没找到自检结果面板)'; })()`, returnByValue: true,
    });
    const shot0 = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot0.data, 'base64'));
    console.log(JSON.stringify({ scene, ok: true, out, report: txt.result.value, exceptions: exceptions.slice(0, 5) }, null, 1));
    ws.close();
    process.exit(0);
}
// 转场三连拍：?scene=trans → <out>-fade.png（黑场）/ <out>-swap.png（换场瞬间）/ <out>-in.png（新场景）
if (scene === 'trans') {
    await send('Page.navigate', { url });
    let readyT = false;
    for (let i = 0; i < 120; i++) {
        const r0 = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
        if (r0.result.value) { readyT = true; break; }
        await sleep(250);
    }
    if (!readyT) { console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions })); process.exit(2); }
    const evalJs = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true });
    const base = out.replace(/\.png$/i, '');
    // 1) 开局并把本段缩短到 50m，推进到 fadeOut
    const s1 = await evalJs(`(() => { const g = window.__game, S = g.S;
        g.startGame(); S.power.shield = 99; S.paused = true;
        g.Scene.segEnd = S.D + 50;
        let n = 0;
        while (g.Scene.phase === 'run' && n++ < 20000) g.step(1/60);
        return JSON.stringify({ phase: g.Scene.phase, D: +S.D.toFixed(1), id: g.Scene.id, n });
    })()`);
    await sleep(700);   // 等 CSS 黑场动画走完
    const shotA = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(base + '-fade.png', Buffer.from(shotA.data, 'base64'));
    // 2) 推过 fadeOut：黑场中完成换世界，进入 fadeIn
    const s2 = await evalJs(`(() => { const g = window.__game;
        for (let i = 0; i < 30; i++) g.step(1/60);
        return JSON.stringify({ phase: g.Scene.phase, id: g.Scene.id, segEnd: +g.Scene.segEnd.toFixed(1), obstacles: g.obstacles.length });
    })()`);
    await sleep(120);
    const shotB = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(base + '-swap.png', Buffer.from(shotB.data, 'base64'));
    // 3) 走完 fadeIn，恢复正常跑动
    const s3 = await evalJs(`(() => { const g = window.__game;
        for (let i = 0; i < 60; i++) g.step(1/60);
        return JSON.stringify({ phase: g.Scene.phase, id: g.Scene.id, grace: +g.S.transGrace.toFixed(2), buf: +(g.S.nextRowS - g.S.D).toFixed(1) });
    })()`);
    await sleep(900);
    const shotC = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(base + '-in.png', Buffer.from(shotC.data, 'base64'));
    console.log(JSON.stringify({
        scene, ok: true,
        s1: JSON.parse(s1.result.value), s2: JSON.parse(s2.result.value), s3: JSON.parse(s3.result.value),
        exceptions: exceptions.slice(0, 5), logs: consoleLogs.slice(-6),
    }, null, 1));
    ws.close();
    process.exit(0);
}
// 车顶弹跳测试：?scene=bounce → 强制城市场景，放小汽车在脚下，验证弹起
if (scene === 'bounce') {
    await send('Page.navigate', { url });
    let readyB = false;
    for (let i = 0; i < 120; i++) {
        const r0 = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
        if (r0.result.value) { readyB = true; break; }
        await sleep(250);
    }
    if (!readyB) { console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions })); process.exit(2); }
    const r = await send('Runtime.evaluate', {
        expression: `(() => { const g = window.__game, S = g.S;
            g.startGame();                 // 先开局（startGame 会重置场景）
            window.__forceTheme('city');   // 再切城市（清场）
            S.paused = true;
            for (let i = 0; i < 5; i++) g.step(1/60);
            for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
            g.addObstacle('car', S.lane, S.D + 1, 4.2, g.makeCar(0xd23c2e));
            S.y = 2.6; S.vy = 0; S.grounded = false;
            let bounced = 0, maxVy = -99;
            for (let i = 0; i < 120 && !bounced; i++) {
                g.step(1/60);
                if (S.vy > maxVy) maxVy = S.vy;
                if (S.vy > 5) bounced = 1;
            }
            return JSON.stringify({ bounced, maxVy: +maxVy.toFixed(2), y: +S.y.toFixed(2), scene: g.Scene.id });
        })()`, returnByValue: true,
    });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({
        scene, ok: true,
        result: r.result.value ? JSON.parse(r.result.value) : null,
        exceptions: exceptions.slice(0, 5), logs: consoleLogs.slice(-6),
    }, null, 1));
    ws.close();
    process.exit(0);
}
// 跳跃弧线测量：?scene=jarc[:campus] → 清场后跳一次，逐帧记录 y/vy，验证跳跃参数
if (scene.startsWith('jarc')) {
    const theme = scene.split(':')[1] || '';
    await send('Page.navigate', { url });
    let readyJ = false;
    for (let i = 0; i < 120; i++) {
        const r0 = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
        if (r0.result.value) { readyJ = true; break; }
        await sleep(250);
    }
    if (!readyJ) { console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions })); process.exit(2); }
    const r = await send('Runtime.evaluate', {
        expression: `(() => { const g = window.__game, S = g.S;
            g.startGame();
            if ('${theme}') window.__forceTheme('${theme}');
            S.paused = true;
            for (const o of g.obstacles) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; }
            g.jump();
            const arc = [];
            for (let i = 0; i < 120; i++) {
                g.step(1/60);
                arc.push({ y: +S.y.toFixed(3), vy: +S.vy.toFixed(2), g: S.grounded ? 1 : 0 });
                if (S.grounded && i > 10) break;
            }
            const peak = Math.max(...arc.map(a => a.y));
            return JSON.stringify({ peak, airFrames: arc.length, scene: g.Scene.id,
                arc: arc.filter((_, i) => i % 3 === 0).map(a => a.y + '/' + a.vy).join(' ') });
        })()`, returnByValue: true,
    });
    console.log(JSON.stringify({ scene, ok: true, result: r.result.value ? JSON.parse(r.result.value) : null, exceptions: exceptions.slice(0, 5) }, null, 1));
    ws.close();
    process.exit(0);
}
// 场景物件探查：?scene=probe:campus → 列出镜头附近高物件（排查遮挡）
if (scene.startsWith('probe')) {
    const theme = scene.split(':')[1] || 'campus';
    await send('Page.navigate', { url });
    let readyP = false;
    for (let i = 0; i < 120; i++) {
        const r0 = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
        if (r0.result.value) { readyP = true; break; }
        await sleep(250);
    }
    if (!readyP) { console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions })); process.exit(2); }
    const r = await send('Runtime.evaluate', {
        expression: `(() => { const g = window.__game;
            g.startGame(); window.__forceTheme('${theme}'); g.S.paused = true;
            for (let i = 0; i < 3; i++) g.step(1/60);
            const out = [];
            const T = window.THREE;
            g.scene.traverse(o => {
                if (!o.isMesh) return;
                o.updateWorldMatrix(true, false);
                const p = new T.Vector3().setFromMatrixPosition(o.matrixWorld);
                if (p.z > 6 || p.z < -14 || p.x < -3 || p.x > 9) return;
                o.geometry.computeBoundingBox?.();
                const bb = o.geometry.boundingBox;
                if (!bb) return;
                const h = bb.max.y - bb.min.y, w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
                if (h < 2.5 && w < 1.2) return;
                out.push({ geo: o.geometry.type, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
                    w: +w.toFixed(1), h: +h.toFixed(1), d: +d.toFixed(1),
                    color: o.material && o.material.color ? o.material.color.getHexString() : '?',
                    name: o.name || (o.parent && o.parent.name) || '' });
            });
            return JSON.stringify(out);
        })()`, returnByValue: true,
    });
    console.log(JSON.stringify({ scene, ok: true, result: r.result.value ? JSON.parse(r.result.value) : null, exceptions: exceptions.slice(0, 5) }, null, 1));
    ws.close();
    process.exit(0);
}
await send('Page.navigate', { url });
await sleep(2500);   // 63MB 单页，等解析跑起来再问；导航提交期发的 evaluate 会被丢掉

// 等游戏初始化（单次 evaluate 加超时，页面主线程被解析卡住时不会把脚本吊死）
const evalWithTimeout = (expr, ms = 8000) => Promise.race([
    send('Runtime.evaluate', { expression: expr, returnByValue: true }).catch(() => null),
    sleep(ms).then(() => null),
]);
let ready = false;
for (let i = 0; i < 60; i++) {
    const r = await evalWithTimeout('typeof window.__game !== "undefined"');
    if (r && r.result && r.result.value) { ready = true; break; }
    await sleep(500);
}
if (!ready) {
    console.log(JSON.stringify({ scene, ok: false, reason: '游戏未初始化', exceptions, consoleLogs }, null, 1));
    process.exit(2);
}

const driver = (scene) => {
    const g = window.__game, S = g.S;
    const step = n => { for (let i = 0; i < n; i++) g.step(1 / 60); };
    const clearAhead = () => {
        for (const o of g.obstacles) {
            if (o.z - o.len / 2 < 3 && o.z + o.len / 2 > -80) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; }
        }
    };
    S.paused = true;

    // 骨骼探针：把运行中的骨骼旋转 / 世界位置都吐出来
    if (scene === 'probe') {
        g.startGame();
        S.power.shield = 99;
        for (let i = 0; i < 90; i++) { step(1); if (i % 6 === 0) clearAhead(); }
        S.power.shield = 0;
        step(8);
        const out = { keys: {}, bones: {}, world: {}, weights: {} };
        const V = g.player.root.position.constructor;
        for (const k of ['legL', 'kneeL', 'legR', 'kneeR', 'armL', 'elbowL', 'armR', 'elbowR', 'torso', 'head']) {
            const j = g.player[k];
            if (!j) { out.keys[k] = 'null'; continue; }
            const rec = { bone: j.bone ? j.bone.name : (j.bone === null ? 'null-bone' : 'group'), rot: { ...j.rotation } };
            if (j.bone) {
                rec.quat = j.bone.quaternion.toArray().map(v => +v.toFixed(3));
                rec.rest = j.rest ? j.rest.toArray().map(v => +v.toFixed(3)) : null;
                const w = new V(); j.bone.getWorldPosition(w);
                out.world[k] = w.toArray().map(v => +v.toFixed(3));
                // 骨骼末端（子骨）世界位置，用来判断这一节到底有没有转
                const child = j.bone.children.find(c => c.isBone);
                if (child) { const cw = new V(); child.getWorldPosition(cw); rec.childWorld = cw.toArray().map(v => +v.toFixed(3)); }
            }
            out.bones[k] = rec;
        }
        return JSON.stringify(out);
    }
    for (const id of ['menu', 'pause', 'over', 'loading', 'hud', 'powers', 'msg']) {
        const el = document.getElementById(id); if (el) el.classList.add('hidden');
    }
    if (scene === 'menu') {
        step(200);
        document.getElementById('menu').classList.remove('hidden');
    } else if (scene.startsWith('side')) {
        // 侧面机位看跑步动作（验证大臂/大腿是否在摆）；side:N 可指定额外步进的帧数
        g.startGame();
        S.power.shield = 99;
        for (let i = 0; i < 90; i++) { step(1); if (i % 6 === 0) clearAhead(); }
        step(+(scene.split(':')[1] || 6));
        window.__freezeCam = true;
        const cam = g.camera, p = g.player.root.position;
        cam.position.set(p.x + 3.2, 1.35, 0.2);
        cam.lookAt(p.x, 1.05, 0);
        cam.fov = 34;
        cam.updateProjectionMatrix();
    } else if (scene.startsWith('arm')) {
        // 背后/侧面近景看摆臂（arm:N 背后；armL:N / armR:N 分别从左侧/右侧看，N 为相位帧数）
        const sideX = scene.startsWith('armL') ? -1 : 1;
        g.startGame();
        S.power.shield = 99;
        for (let i = 0; i < 90; i++) { step(1); if (i % 6 === 0) clearAhead(); }
        step(+(scene.split(':')[1] || 6));
        window.__freezeCam = true;
        const cam = g.camera, p = g.player.root.position;
        if (scene.startsWith('armR') || scene.startsWith('armL')) {
            cam.position.set(p.x + sideX * 2.2, 1.5, 0.5);
            cam.lookAt(p.x, 1.2, -0.1);
        } else {
            cam.position.set(p.x + 0.1, 1.6, 2.3);
            cam.lookAt(p.x, 1.15, 0);
        }
        cam.fov = 36;
        cam.updateProjectionMatrix();
    } else if (scene.startsWith('leg')) {
        // 近景看腿部形变（leg:N 背后近景；legS:N 侧面）N 为相位帧数
        g.startGame();
        S.power.shield = 99;
        for (let i = 0; i < 90; i++) { step(1); if (i % 6 === 0) clearAhead(); }
        step(+(scene.split(':')[1] || 0));
        window.__freezeCam = true;
        const cam = g.camera, p = g.player.root.position;
        if (scene.startsWith('legS')) {
            cam.position.set(p.x + 1.9, 1.1, 0.35);
            cam.lookAt(p.x, 0.72, -0.05);
        } else {
            cam.position.set(p.x + 0.55, 1.6, 2.0);
            cam.lookAt(p.x, 0.8, 0);
        }
        cam.fov = 32;
        cam.updateProjectionMatrix();
    } else if (scene === 'face' || scene === 'body') {
        step(240);
        window.__freezeCam = true;
        const cam = g.camera, p = g.player.root.position;
        if (scene === 'face') {
            cam.position.set(p.x + 0.02, 1.93, 2.1);
            cam.lookAt(p.x, 1.87, 0);
            cam.fov = 22;
        } else {
            cam.position.set(p.x + 0.12, 1.15, 4.4);
            cam.lookAt(p.x, 1.02, 0);
            cam.fov = 30;
        }
        cam.updateProjectionMatrix();
    } else {
        g.startGame();
        S.power.shield = 99;
        for (let i = 0; i < 90; i++) { step(1); if (i % 6 === 0) clearAhead(); }
        S.power.shield = 0;
        if (scene.startsWith('run')) step(+(scene.split(':')[1] || 6));
        else if (scene === 'jump') { clearAhead(); g.jump(); step(16); }
        else if (scene === 'apex') { clearAhead(); g.jump(); step(30); }
        else if (scene === 'roll') { clearAhead(); g.roll(); step(17); }
        else if (scene === 'fly') { clearAhead(); g.startFlight(); step(150); clearAhead(); }
        else if (scene === 'land') {
            clearAhead(); g.startFlight(); step(10);
            for (let i = 0; i < 900 && S.flight.phase !== 'idle'; i++) step(1);
            step(6); clearAhead();
        }
        else if (scene === 'obsline') {
            // 校园障碍排队检阅：跨栏 / 自行车 / 横幅 / 校车
            g.startGame(); window.__forceTheme('campus');
            S.power.shield = 99;
            for (const o of g.obstacles) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; }
            g.addObstacle('hurdle', 1, S.D + 6, 0.6, g.makeHurdle());
            g.addObstacle('bike', 1, S.D + 13, 0.6, g.makeBikeObstacle());
            g.addObstacle('banner', 1, S.D + 21, 0.6, g.makeBanner());
            g.addObstacle('schoolbus', 1, S.D + 33, 14, g.makeSchoolBus(14));
            step(2);
        }
        else if (/^portal-(in|out)/.test(scene)) {
            // 隧道口过场：下一段设为隧道（或城市=出洞），段落终点定在 105m 后，
            // 再按帧推进，让洞口从 100m 外自然逼近
            const kind = scene.startsWith('portal-in') ? 'in' : 'out';
            const frames = +(scene.split(':')[1] || 200);
            window.__forceTheme(kind === 'in' ? 'lakeside' : 'tunnel');
            g.Scene.next = kind === 'in' ? 'tunnel' : 'city';
            g.Scene.segEnd = S.D + 105;
            S.transGrace = 999;          // 过场测试不因撞障碍中断
            step(frames);
        }
        else if (scene === 'castle') {
            // 湖畔城堡：侧后方高位机位，看左岸的城堡序列
            g.startGame(); window.__forceTheme('lakeside');
            S.power.shield = 999;
            for (const o of g.obstacles) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; }
            step(40);
            window.__freezeCam = true;
            const cam = g.camera;
            cam.position.set(9, 11, 26);
            cam.lookAt(-16, 15, -46);
            cam.fov = 66; cam.updateProjectionMatrix();
        }
        else if (scene === 'castle2') {
            // 城堡正面：从轨道上平视
            g.startGame(); window.__forceTheme('lakeside');
            S.power.shield = 999;
            for (const o of g.obstacles) { o.lane = -9; o.x = 99; o.mesh.position.x = 99; }
            step(120);
            window.__freezeCam = true;
            const cam = g.camera;
            cam.position.set(2.4, 6, 16);
            cam.lookAt(-18, 18, -40);
            cam.fov = 70; cam.updateProjectionMatrix();
        }
        else if (scene.startsWith('pillars')) {
            // 隧道柱阵：跑到柱阵出现，再按帧推进到指定距离
            g.startGame(); window.__forceTheme('tunnel');
            S.transGrace = 999;
            let guard = 0;
            while (!g.obstacles.some(o => o.type === 'pillar') && guard++ < 6000) step(1);
            step(+(scene.split(':')[1] || 40));
        }
        else if (scene.startsWith('cyber')) {
            // 赛博朋克传送门：城市场景尾段把传送门提前摆出来
            g.startGame(); window.__forceTheme('city');
            S.transGrace = 999;
            g.Scene.next = 'campus';
            g.Scene.segEnd = S.D + 40;
            step(+(scene.split(':')[1] || 300));
        }
        for (const id of ['pause', 'over']) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
    }
    S.paused = true;
    const V = g.player.root.position.constructor;
    const hv = new V();
    g.player.head.getWorldPosition(hv);
    g.camera.updateMatrixWorld();
    const ndc = hv.clone().project(g.camera);
    return JSON.stringify({
        phase: S.flight && S.flight.phase,
        y: +S.y.toFixed(2),
        player: g.player.root.position.toArray().map(v => +v.toFixed(2)),
        head: hv.toArray().map(v => +v.toFixed(2)),
        screen: [Math.round((ndc.x * 0.5 + 0.5) * 1280), Math.round((-ndc.y * 0.5 + 0.5) * 800), +ndc.z.toFixed(2)],
        cam: g.camera.position.toArray().map(v => +v.toFixed(2)),
        fov: +g.camera.fov.toFixed(1),
        scale: g.player.root.scale.toArray().map(v => +v.toFixed(2)),
        vis: g.player.root.visible,
        inScene: g.scene.children.indexOf(g.player.root) >= 0,
        calls: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        meshes: (() => { let n = 0; g.player.root.traverse(o => { if (o.isMesh) n++; }); return n; })(),
    });
};

const r = await send('Runtime.evaluate', {
    expression: `(${driver.toString()})(${JSON.stringify(scene)})`,
    returnByValue: true, awaitPromise: true,
});
await sleep(900);   // 多渲染几帧
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify({
    scene, ok: true, out,
    info: r.result.value ? JSON.parse(r.result.value) : null,
    exceptions: exceptions.slice(0, 5),
    logs: consoleLogs.slice(-10),
}, null, 1));
ws.close();
process.exit(0);
