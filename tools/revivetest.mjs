// 复活币端到端验证：投放概率 → 拾取 → 死亡自动复活 → 普通死亡 → 上限
// 用法： node tools/revivetest.mjs [文件名=playable.html]
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
await c.raw('Runtime.enable');
await c.raw('Page.navigate', { url: 'http://127.0.0.1:8765/' + FILE + '?v=' + Date.now() });
await sleep(2500);

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
    await sleep(1000);
}
if (!ready) { console.log('页面没起来'); process.exit(2); }
log('就绪');

const src = `(() => {
const g = window.__game, S = g.S, R = g.REVIVE_CFG;
const pass = [], fail = [], info = [];
const ok = (name, cond, extra) => (cond ? pass : fail).push(name + (extra ? ' :: ' + extra : ''));
const LANE_X = [-2.4, 0, 2.4];
const origRandom = Math.random;
const later = (fn, ms) => new Promise(r => setTimeout(() => r(fn()), ms));

// ---------- T1：概率口径在真实生成管线里生效 ----------
// 把 Math.random 钉死成 0.999（永远掷不中），跑到 5300 米，只应该在 5000 米那一次刷出来
g.startGame();
window.__forceTheme('lakeside');
Math.random = () => 0.999;
S.transGrace = 9999;                    // 本项只看投放，不让主角死
const spawns = [];
const seen = new Set();
let pillarsBadLane = 0;
for (let i = 0; i < 60 * 60 * 20 && S.D < 5300; i++) {
    S.transGrace = 9999;        // 换场会把无敌重置成 1.2s，这里逐帧续上（主角全程不操作）
    if (S.state !== 'playing') { S.state = 'playing'; }   // 兜底：别让里程卡死
    g.step(1 / 60);
    for (const p of g.pickups) {
        if (p.type !== 'revive' || seen.has(p)) continue;
        seen.add(p);
        const at = S.D - p.z;                                  // z = D - s  →  s = D - z
        spawns.push({ at: Math.round(at), lane: p.lane, isTunnelMid: g.Scene.id === 'tunnel' && p.lane === 1 });
        if (g.Scene.id === 'tunnel' && S.pillar && S.pillar.active && p.lane === 1) pillarsBadLane++;
    }
}
Math.random = origRandom;
ok('T1 全程只出了 1 个复活币（钉死随机数到 5000 米才必出）', spawns.length === 1, JSON.stringify(spawns));
ok('T1 刷新位置正好落在 5000 米刻度', spawns[0] && Math.abs(spawns[0].at - 5000) <= 2, spawns[0] && ('at=' + spawns[0].at));
ok('T1 5000 米前一个都没提前出', !spawns.some(s => s.at < 5000));
// 命中后周期起点重置到 5000，后续刻度继续按 100 米推进；从新起点算起必须回到 n=1（1%）
const after = g.reviveRoll(S.reviveBase, S.reviveBase + R.step, () => 0.999);
ok('T1 命中后概率清零：周期起点=5000', S.reviveBase === 5000, 'base=' + S.reviveBase);
ok('T1 清零后下一个刻度从 1% 重新开始', after.n === 1 && Math.abs(after.p - 0.01) < 1e-12,
   'n=' + after.n + ' p=' + after.p);
ok('T1 刻度严格按 100 米推进', (S.nextReviveS - S.reviveBase) % R.step === 0 && S.nextReviveS > S.reviveBase,
   'base=' + S.reviveBase + ' next=' + S.nextReviveS);
info.push('T1 D=' + Math.round(S.D) + ' 累计出币=' + S.reviveSpawned);

// ---------- T2：拾取 ----------
g.startGame();
window.__forceTheme('lakeside');
S.transGrace = 9999;
const spot = g.placeRevive(S.D + 70);
for (const o of g.obstacles) { o.z = 900; o.mesh.position.z = 900; }     // 清掉障碍，专测拾取
S.lane = spot.lane; S.x = LANE_X[spot.lane]; S.prevLane = spot.lane; S.y = 0;
let picked = 0;
for (let i = 0; i < 60 * 8 && !picked; i++) {
    const before = S.revives;
    g.step(1 / 60);
    if (S.revives > before) picked = i;
}
ok('T2 走到复活币上能捡到（revives +1）', S.revives === 1, 'revives=' + S.revives + ' lane=' + spot.lane);
ok('T2 捡完后场上没有残留的复活币模型', !g.pickups.some(p => p.type === 'revive'));

// ---------- T3：死亡自动复活 ----------
const deathsBefore = S.reviveUsed;
S.transGrace = 0;
const lane = S.lane;
g.addObstacle('cone', lane, S.D + 9, 0.6, g.makeCone());
let revivedAt = -1;
for (let i = 0; i < 60 * 4; i++) {
    g.step(1 / 60);
    if (S.reviveUsed > deathsBefore) { revivedAt = i; break; }
}
ok('T3 撞上障碍时消耗复活币而不是结算', revivedAt >= 0 && S.revives === 0, 'reviveUsed=' + S.reviveUsed + ' revives=' + S.revives);
ok('T3 复活后仍处于 playing（没有进死亡动画）', S.state === 'playing', 'state=' + S.state);
ok('T3 死因有留档', !!S.lastDeathCause, 'cause=' + S.lastDeathCause);
ok('T3 复活后带无敌时间', S.transGrace > 1, 'transGrace=' + S.transGrace.toFixed(2));
const nearAfter = g.obstacles.filter(o => o.z + o.len / 2 > -R.clearAhead && o.z - o.len / 2 < 8).length;
ok('T3 复活后清空了身前 ' + R.clearAhead + ' 米障碍', nearAfter === 0, '剩余=' + nearAfter);
ok('T3 复活后保安被甩开', S.chaserTimer <= 0, 'chaserTimer=' + S.chaserTimer.toFixed(2));
// 无敌期内不该再被撞死
for (let i = 0; i < 60 * 1.5; i++) g.step(1 / 60);
ok('T3 复活后 1.5 秒内不会被立刻再撞死', S.state === 'playing', 'state=' + S.state);

// ---------- T3b：复活币用完后再死，结算面板要显示救场次数 ----------
S.transGrace = 0;
g.addObstacle('cone', S.lane, S.D + 9, 0.6, g.makeCone());
for (let i = 0; i < 60 * 4 && S.state === 'playing'; i++) g.step(1 / 60);
for (let i = 0; i < 60 * 2.2 && S.state === 'dying'; i++) g.step(1 / 60);
const ovTxt = (document.getElementById('overRevive') || {}).textContent || '';
ok('T3b 用掉复活币后再死会正常结算', S.state === 'over', 'state=' + S.state);
ok('T3b 结算面板显示「复活币救场 ×1」', ovTxt.includes('×1'), 'text=' + ovTxt);

// ---------- T4：没有复活币时照常死亡 ----------
g.startGame();
window.__forceTheme('lakeside');
S.transGrace = 0;
g.addObstacle('cone', S.lane, S.D + 9, 0.6, g.makeCone());
let diedFrame = -1;
for (let i = 0; i < 60 * 4; i++) {
    g.step(1 / 60);
    if (S.state === 'dying') { diedFrame = i; break; }
}
ok('T4 没有复活币时正常进入死亡', diedFrame >= 0 && S.state === 'dying', 'state=' + S.state);
for (let i = 0; i < 60 * 2.2 && S.state === 'dying'; i++) g.step(1 / 60);   // 推进到结算
ok('T4 死亡后照常弹结算面板', S.state === 'over' && S.overShown, 'state=' + S.state);
ok('T4 结算面板显示复活币救场次数为空（本局没用过）',
   (document.getElementById('overRevive') || {}).textContent === '', 'text=' + (document.getElementById('overRevive') || {}).textContent);

// ---------- T5：持有上限 ----------
g.startGame();
for (let i = 0; i < 8; i++) g.takeRevive();
ok('T5 复活币持有上限 = ' + R.maxHold, S.revives === R.maxHold, 'revives=' + S.revives);

// ---------- T6：重开一局后状态归零 ----------
g.startGame();
ok('T6 重开后复活币数量归零', S.revives === 0, 'revives=' + S.revives);
ok('T6 重开后概率周期归零', S.reviveBase === 0 && S.nextReviveS === R.step,
   'base=' + S.reviveBase + ' next=' + S.nextReviveS);
ok('T6 重开后计数归零', S.reviveSpawned === 0 && S.reviveUsed === 0);

// ---------- T7：复活币模型的资源安全（重复创建/销毁不炸） ----------
let boom = null;
try {
    for (let i = 0; i < 12; i++) {
        const p = g.placeRevive(S.D + 40 + i * 3);
        g.step(1 / 60);
        for (const q of g.pickups.slice()) { if (q.type === 'revive') { g.scene.remove(q.mesh); g.pickups.splice(g.pickups.indexOf(q), 1); } }
    }
} catch (e) { boom = e.message; }
ok('T7 反复生成/销毁复活币模型不报错', !boom, boom || '');

// ---------- T8：换场不清掉还没拿到的复活币 ----------
g.startGame();
window.__forceTheme('lakeside');
g.placeRevive(S.D + 100);
const hasBefore = g.pickups.filter(p => p.type === 'revive').length;
window.__forceTheme('city');                       // 换场会清空场上所有物体
const afterList = g.pickups.filter(p => p.type === 'revive');
ok('T8 换场前场上有 1 个复活币', hasBefore === 1, 'before=' + hasBefore);
ok('T8 换场后复活币被带到新地图（不是白丢）', afterList.length === 1, 'after=' + afterList.length);
ok('T8 携带过来的复活币在新地图前方', afterList[0] && afterList[0].z < 0, 'z=' + (afterList[0] || {}).z);

// 放一个到场上，留着截图用
g.startGame();
window.__forceTheme('lakeside');
S.transGrace = 9999;
const show = g.placeRevive(S.D + 30);
S.lane = show.lane; S.x = LANE_X[show.lane]; S.prevLane = show.lane;
g.step(1 / 60);

return JSON.stringify({ pass, fail, info, total: pass.length + fail.length, spot: show });
})()`;

const r = await Promise.race([
    c.raw('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true }),
    sleep(240000).then(() => null),
]);
if (!r) { console.log('执行超时'); process.exit(3); }
if (r.exceptionDetails) { console.log('页面异常：', JSON.stringify(r.exceptionDetails).slice(0, 1500)); process.exit(4); }

const res = JSON.parse(r.result.value);
for (const p of res.pass) console.log('  \x1b[32m✅\x1b[0m ' + p);
for (const f of res.fail) console.log('  \x1b[31m❌\x1b[0m ' + f);
for (const i of res.info) console.log('  · ' + i);
console.log(`\n复活币验证：${res.pass.length}/${res.total} 通过`);
process.exit(res.fail.length ? 1 : 0);
