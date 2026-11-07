// 数值探针：逐帧记录保安的 位置/朝向/骨骼/时钟，找高频振荡（抖动）源
// 场景：A段 直线跑 100 帧；B段 每 20 帧强制换道 ×6；C段 chaserTimer 自然过期
const urlBase = process.argv[2] || 'http://127.0.0.1:8765/';
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
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: urlBase + 'index.html?autostart&v=' + Date.now() });
for (let i = 0; i < 120; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__game !== "undefined"', returnByValue: true });
    if (r.result.value) break;
    await sleep(250);
}
await sleep(1500);   // 等 GLB 加载
const r = await send('Runtime.evaluate', {
    expression: `(() => {
        const g = window.__game, S = g.S, c = g.chaser;
        g.startGame(); S.paused = true; S.power.shield = 999;
        for (let i = 0; i < 30; i++) g.step(1/60);
        for (const o of g.obstacles) { o.x = 99; o.mesh.position.x = 99; }
        const rec = [];
        const snap = (tag) => {
            const b = c.bones || {};
            rec.push({
                tag,
                x: +c.root.position.x.toFixed(4),
                z: +c.root.position.z.toFixed(4),
                yaw: +((g.chaserModel.rotation.y)).toFixed(4),
                mz: +g.chaserModel.position.z.toFixed(4),
                legA: b.LegA ? +b.LegA.rotation.x.toFixed(4) : null,
                armR: b.ArmR ? +b.ArmR.rotation.x.toFixed(4) : null,
                px: +S.x.toFixed(4),
                dist: +S.chaserDist.toFixed(4),
                spd: +S.speed.toFixed(2),
            });
        };
        // A：直线追近
        for (let i = 0; i < 100; i++) { S.chaserTimer = 999; g.step(1/60); snap('A'); }
        // B：反复换道
        const lanes = [0, 2, 1, 2, 0, 1];
        for (let k = 0; k < lanes.length; k++) {
            g.moveLane(lanes[k] - S.lane);
            for (let i = 0; i < 20; i++) { S.chaserTimer = 999; g.step(1/60); snap('B' + k); }
        }
        // C：停止续时，让 chaserTimer 自然过期（5s 后远离）
        for (let i = 0; i < 400; i++) { g.step(1/60); snap('C'); }
        return JSON.stringify(rec);
    })()`, returnByValue: true,
});
const rows = JSON.parse(r.result.value);
// 分析：相邻帧 delta 的符号翻转次数（高频振荡指标）+ 最大单帧跳变
const keys = ['x', 'z', 'yaw', 'mz', 'legA', 'armR', 'px', 'dist'];
const stats = {};
for (const k of keys) {
    let flips = 0, maxJump = 0, maxJumpAt = -1, prevD = 0;
    for (let i = 1; i < rows.length; i++) {
        const d = rows[i][k] - rows[i - 1][k];
        if (Math.abs(d) > Math.abs(maxJump)) { maxJump = d; maxJumpAt = i; }
        if (i > 1 && d !== 0 && prevD !== 0 && Math.sign(d) !== Math.sign(prevD)) flips++;
        if (d !== 0) prevD = d;
    }
    stats[k] = { flips, maxJump: +maxJump.toFixed(4), maxJumpAt, tagAt: rows[maxJumpAt] ? rows[maxJumpAt].tag : '' };
}
console.log('总行数', rows.length);
console.log(JSON.stringify(stats, null, 1));
// 打印 maxJumpAt 附近窗口 + 每段采样
const idx = stats.yaw.maxJumpAt;
console.log('--- yaw 最大跳变窗口 (i=' + idx + ') ---');
for (let i = Math.max(0, idx - 4); i < Math.min(rows.length, idx + 5); i++) console.log(i, JSON.stringify(rows[i]));
console.log('--- A 段每 10 帧 ---');
for (let i = 0; i < 100; i += 10) console.log(i, JSON.stringify(rows[i]));
console.log('--- B 段换道点附近 ---');
for (const i of [98, 99, 100, 101, 118, 119, 120, 121, 140, 141]) if (rows[i]) console.log(i, JSON.stringify(rows[i]));
console.log('--- C 段每 40 帧（chaserTimer 过期过程） ---');
const cStart = 100 + 6 * 20;
for (let i = cStart; i < rows.length; i += 40) console.log(i, JSON.stringify(rows[i]));
ws.close(); process.exit(0);
