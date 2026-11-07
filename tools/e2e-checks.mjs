// 行为验证：① 撞柱必死 ② 玩家提速后迎面火车同步提速 ③ 柱阵内同时最多一辆行驶火车
// 用法： node tools/e2e-checks.mjs [被测文件=playable.html]
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = process.argv[2] || 'playable.html';
const T0 = Date.now();
const log = m => console.log('[' + ((Date.now() - T0) / 1000).toFixed(1) + 's] ' + m);

function connect(page) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let seq = 0; const pending = new Map();
        const st = { ws };
        ws.addEventListener('open', () => {
            st.raw = (method, params = {}) => new Promise((res, rej) => {
                const id = ++seq;
                pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
                ws.send(JSON.stringify({ id, method, params }));
            });
            resolve(st);
        });
        ws.addEventListener('error', reject);
        ws.addEventListener('message', ev => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
    });
}
const pages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page');

let c = await connect((await pages())[0]);
await c.raw('Page.enable');
await c.raw('Page.navigate', { url: `http://127.0.0.1:8765/${FILE}?autostart&v=` + Date.now() });
await sleep(2200);

let ready = false;
for (let i = 0; i < 30; i++) {
    const p = (await pages()).find(p => p.url.includes('8765'));
    if (p) {
        try {
            const cc = await connect(p);
            const r = await Promise.race([cc.raw('Runtime.evaluate', { expression: 'typeof window.__game', returnByValue: true }), sleep(6000).then(() => null)]);
            if (r && r.result.value === 'object') { c = cc; ready = true; break; }
        } catch (e) { /* 继续等 */ }
    }
    await sleep(1500);
}
if (!ready) { log('页面没起来'); process.exit(2); }

const src = `(() => {
const g = window.__game, S = g.S;
const out = {};

// ① 撞柱必死：跑到柱段出现，把玩家塞进柱子所在的那一格里
g.startGame();
window.__forceTheme('tunnel');
S.transGrace = 999;                 // 先免死跑到柱段出现，否则半路被别的障碍撞死就永远等不到
let guard = 0;
while (!g.obstacles.some(o => o.type === 'pillar' && o.z > -30) && guard++ < 12000) g.step(1 / 60);
S.transGrace = 0;                   // 真撞柱这一下要按正常规则判死
const pil = g.obstacles.find(o => o.type === 'pillar' && o.z > -30);
if (!pil) { out.pillarCrash = '柱段没生成'; }
else {
    // 把柱子怼到玩家身上，玩家站中间道
    pil.z = 0.5; pil.mesh.position.z = 0.5;
    S.lane = 1; S.x = 0; S.prevLane = 1; S.y = 0; S.state = 'playing';
    let n = 0;
    while (S.state === 'playing' && n++ < 30) g.step(1 / 60);
    out.pillarCrash = S.state !== 'playing' ? ('死因=' + (document.getElementById('overTitle').textContent || '?')) : '没死（应必死）';
    out.pillarDeadlyFlag = !!pil.deadly;
}

// ② 火车提速：同一辆迎面车，玩家提速前后它的 extra 应跟着变
g.startGame();
window.__forceTheme('tunnel');
S.transGrace = 999;
guard = 0;
while (!g.obstacles.some(o => o.moving) && guard++ < 20000) g.step(1 / 60);
const tr = g.obstacles.find(o => o.moving);
if (!tr) { out.trainSpeed = '没等到迎面车'; }
else {
    const before = { speed: S.speed, extra: tr.extra };
    S.D += 900;                        // 直接推里程，速度按公式抬一档
    g.step(1 / 60);
    out.trainSpeed = {
        playerBefore: +before.speed.toFixed(2), playerAfter: +S.speed.toFixed(2),
        trainExtraBefore: +before.extra.toFixed(2), trainExtraAfter: +tr.extra.toFixed(2),
        scalesUp: tr.extra > before.extra,
    };
}

// ③ 柱阵内最多一辆行驶火车
out.maxMovingInPillar = 0;
g.startGame();
window.__forceTheme('tunnel');
S.transGrace = 999;
for (let i = 0; i < 60 * 240; i++) {
    g.step(1 / 60);
    const inPillar = g.obstacles.some(o => o.type === 'pillar');
    const mv = g.obstacles.filter(o => o.moving).length;
    if (inPillar && mv > out.maxMovingInPillar) out.maxMovingInPillar = mv;
}
return JSON.stringify(out);
})()`;

const r = await Promise.race([
    c.raw('Runtime.evaluate', { expression: src, returnByValue: true }),
    sleep(180000).then(() => { throw new Error('验证超时'); }),
]);
log('结果: ' + r.result.value);
process.exit(0);
