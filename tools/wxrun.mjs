// 天气节拍验证：晴/雨按 2000 米切、薄雾不吃里程节拍、换场 3000 米
// 用法： node tools/wxrun.mjs [目标里程=9000] [被测文件=playable.html]
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = +(process.argv[2] || 9000);
const FILE = process.argv[3] || 'playable.html';
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
const g = window.__game, S = g.S, A = window.__wx;
const target = ${TARGET};
g.startGame();
window.__forceTheme('tunnel');     // 隧道里不会有行驶车撞人，好观察
S.transGrace = 999;

// 记录：天气每次变化发生在多少米
const changes = [];
let lastWx = A.state().weather;
let lastScene = g.Scene.id;
const sceneAt = [];

// 先强制起一次薄雾，专门验「薄雾不被 2000 米那一刀砍断」
A.setWeather('mist', false);
const mistStartD = S.D;
let mistEndD = null, mistCutByBoundary = false;
const mistStartSeg = Math.floor(S.D / 2000);

for (let i = 0; i < 60 * 60 * 8 && S.D < target; i++) {
    S.power.shield = 999;          // 观测天气用，别让主角半路被撞死把里程卡住
    S.transGrace = 999;
    g.step(1 / 60);
    A.update(1 / 60, S.D);         // 天气模块挂在 rAF 上，直接 step 不会跑，得手动驱动
    if (S.state !== 'playing') { S.state = 'playing'; }   // 兜底：死了也继续跑里程
    const w = A.state().weather;
    if (w !== lastWx) {
        if (lastWx === 'mist' && mistEndD === null) mistEndD = S.D;
        changes.push({ wx: w, at: Math.round(S.D), from: lastWx });
        lastWx = w;
    }
    // 薄雾期间如果跨过了 2000 米刻度却提前变天，就是被砍断了
    if (w === 'mist') {
        const seg = Math.floor(S.D / 2000);
        if (seg > mistStartSeg && mistEndD === null) mistCutByBoundary = mistCutByBoundary || (A._st.mistLeft < 0);
    }
    if (g.Scene.id !== lastScene) { sceneAt.push({ scene: g.Scene.id, at: Math.round(S.D) }); lastScene = g.Scene.id; }
}

// 连续跑图时晴/雨应该严格落在 2000 的整数倍附近
const rainClear = changes.filter(c => c.wx === 'rain' || (c.wx === 'clear' && c.from !== 'mist'));
const offGrid = rainClear.filter(c => Math.abs(c.at % 2000) > 25 && Math.abs((c.at % 2000) - 2000) > 25);

return JSON.stringify({
    D: Math.round(S.D),
    changes,
    mistStartD: Math.round(mistStartD), mistEndD: mistEndD === null ? null : Math.round(mistEndD),
    mistCutByBoundary,
    nonGridSwitches: offGrid.map(c => ({ wx: c.wx, at: c.at })),
    scenes: sceneAt,
    finalWx: A.state().weather,
});
})()`;

const r = await Promise.race([
    c.raw('Runtime.evaluate', { expression: src, returnByValue: true }),
    sleep(180000).then(() => { throw new Error('超时'); }),
]);
log('结果: ' + r.result.value);
process.exit(0);
