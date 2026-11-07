// 传送门功能验证：强制走「城市 → 学校」，检查洞口有没有生成、穿过去后是不是真的到了学校
// 用法： node tools/portalrun.mjs [目标里程=4200] [被测文件=playable.html]
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = +(process.argv[2] || 4200);
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
const g = window.__game, S = g.S;
const target = ${TARGET};
g.startGame();
window.__forceTheme('city');
g.Scene.next = 'campus';          // 把下一场锁成学校，专门走传送门这条支路

const log = { phases: [], portalSeen: 0, portalZAtMin: null, swapD: null, sceneAtSwap: null, fadeMax: 0, errors: [] };
let lastPhase = g.Scene.phase;
for (let i = 0; i < 60 * 240 && S.D < target; i++) {
    S.power.shield = 0;           // 让护盾不干扰，靠 S.transGrace 兜住不要死
    S.transGrace = 999;
    g.step(1 / 60);

    // 洞口是不是真的摆下场了（带 noMerge 标记的静态组）
    const grp = g.scene.children.some(o => o.userData && o.userData.noMerge && o.visible);
    if (grp) log.portalSeen++;

    if (g.Scene.phase !== lastPhase) {
        log.phases.push(g.Scene.phase + '@D' + Math.round(S.D));
        lastPhase = g.Scene.phase;
    }
    const fade = g.Scene.fade == null ? 0 : g.Scene.fade;
    if (fade > log.fadeMax) log.fadeMax = fade;

    if (!log.swapD && g.Scene.id === 'campus') {
        log.swapD = Math.round(S.D);
        log.sceneAtSwap = g.Scene.id;
        break;
    }
    if (![S.x, S.y, S.D].every(Number.isFinite)) { log.errors.push('NaN@' + i); break; }
}
return JSON.stringify({
    D: Math.round(S.D), scene: g.Scene.id, phase: g.Scene.phase,
    portalFrames: log.portalSeen, phases: log.phases,
    swappedAt: log.swapD, fadeMax: +log.fadeMax.toFixed(2), errors: log.errors,
});
})()`;

const r = await Promise.race([
    c.raw('Runtime.evaluate', { expression: src, returnByValue: true }),
    sleep(120000).then(() => { throw new Error('传送门测试超时'); }),
]);
log('结果: ' + r.result.value);
process.exit(0);
