// 端到端跑图测试：机器人跑满指定里程，统计柱子/火车/场景切换，检查有没有必死局
// 用法： node tools/botrun.mjs [里程=3600] [起始场景=tunnel]
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = +(process.argv[2] || 3600);
const THEME = process.argv[3] || 'tunnel';
const FILE = process.argv[4] || 'playable.html';   // 可指定被测文件，方便和备份做对照
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
await c.raw('Page.navigate', { url: 'http://127.0.0.1:8765/' + FILE + '?autostart&v=' + Date.now() });
await sleep(2000);

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
if (!ready) { console.log('页面没起来'); process.exit(2); }
log('就绪，开始跑图');

const src = `(() => {
const g = window.__game, S = g.S;
const target = ${TARGET};
g.startGame();
if (${JSON.stringify(THEME)} !== 'lakeside') window.__forceTheme(${JSON.stringify(THEME)});
const ahead = lane => g.obstacles.filter(o => o.lane === lane && o.z + o.len / 2 > -Math.max(16, S.speed * 0.9) && o.z - o.len / 2 < 1);
const rampBefore = (lane, o) => g.obstacles.some(r => r.type === 'ramp' && r.lane === lane && Math.abs((r.z - r.len / 2) - (o.z + o.len / 2)) < 0.6);
const riding = o => o.ride && S.y >= o.h1 - 0.6 && o.z - o.len / 2 < 0.2 && o.z + o.len / 2 > -0.2 && Math.abs(o.x - S.x) < 1.5;
const blocked = lane => ahead(lane).some(o => (o.deadly || (o.ride && o.h1 > 1.6)) && !riding(o) && !rampBefore(lane, o) && o.z + o.len / 2 < 0.5);
const threat = lane => { let m = -Infinity; for (const o of ahead(lane)) { const f = o.z + o.len / 2; if (f < 2 && f > m) m = f; } return m; };

// 柱子：中间道已经被柱段占住（人可以横切过去，但不能在里面跑）
const pillarNear = lane => g.obstacles.some(o => o.type === 'pillar' && o.lane === lane && o.z + o.len / 2 > -60);
// 此刻中间道是不是柱段（不是空隙）：两侧之间横切只能在空隙里做
const pillarCover = () => g.obstacles.some(o => o.type === 'pillar' && o.z + o.len / 2 > -8 && o.z - o.len / 2 < 3);
const crossOK = () => !pillarCover();
const mustLeave = () => S.lane === 1 && pillarNear(1);

// 迎面驶来的障碍相对速度约 1.42 倍，必须提前很远就换道
const mvAhead = lane => g.obstacles.some(o => o.moving && o.lane === lane && o.z > -Math.max(90, S.speed * 4.5) && o.z < 4);

const crossTo = t => { while (S.lane !== t) g.moveLane(t > S.lane ? 1 : -1); };

// 迎面车在自己道上：横切到对面的侧道。柱阵里中间道只在柱段之间借一下，
// 所以柱子挡着的时候先等空隙——这就是真人玩家的做法（等两段柱子之间的空档冲过去）
function dodgeTrain() {
    if (!mvAhead(S.lane)) return false;
    if (S.lane === 1) { crossTo(blocked(0) ? 2 : 0); return true; }   // 正在借道，立刻穿过去
    const far = S.lane === 0 ? 2 : 0;
    const free = l => l >= 0 && l <= 2 && l !== S.lane && !mvAhead(l) && !blocked(l)
        && (!pillarNear(1) || crossOK());                             // 柱段挡着时中间道不能借
    // 优先横切到对面那条；对面被堵就退一步先躲进中间道（湖畔/城市/校园中间道是合法躲避位）
    for (const t of [far, 1]) {
        if (free(t)) { crossTo(t); return true; }
    }
    return false;
}

function bot() {
    if (dodgeTrain()) return;
    if (mustLeave()) {                     // 借中间道横切：一步跨到对面那条
        const t = S.lane < 1 ? 2 : (S.lane > 1 ? 0 : (blocked(2) ? 0 : 2));
        if (t !== S.lane && !blocked(t)) {
            crossTo(t);
            return;
        }
    }
    if (blocked(S.lane)) {
        let best = null, bestThreat = Infinity;
        for (const d of [-1, 1]) {
            const l = S.lane + d;
            if (l < 0 || l > 2 || blocked(l)) continue;
            if (l === 1 && pillarNear(1)) continue;      // 不往柱子区里钻
            if (g.obstacles.some(o => o.lane === l && o.ride && o.z - o.len / 2 < 1 && o.z + o.len / 2 > -3)) continue;
            const t = threat(l);
            if (t < bestThreat) { best = l; bestThreat = t; }
        }
        if (best !== null) g.moveLane(best - S.lane);
    }
    for (const o of ahead(S.lane)) {
        const front = o.z + o.len / 2;
        if (front > -S.speed * 0.5 && front < -S.speed * 0.12) {
            if (o.deadly) continue;                       // 柱子只能换道，跳/滚都没用
            if (o.ride && o.h1 <= 1.6) g.jump();
            else if (!o.ride && o.type !== 'ramp' && (o.h0 || 0) <= 0.5) g.jump();
            else if (!o.ride && (o.h0 || 0) > 0.5) g.roll();
        }
    }
}

const stats = { maxMoving: 0, twoMovingFrames: 0, pillarSections: 0, sawPillar: 0, trainInPillarZone: 0,
                laneMidWhilePillar: 0, visits: [g.Scene.id], maxSpeed: 0, pillarsSeen: 0,
                reviveSpawned: 0, reviveUsed: 0, reviveMissed: 0 };
let died = null, nanAt = -1, i = 0;
for (; i < 60 * 60 * 14 && S.D < target; i++) {
    if (S.state === 'playing' && !S.flying) bot();
    g.step(1 / 60);
    const mv = g.obstacles.filter(o => o.moving).length;
    if (mv > stats.maxMoving) stats.maxMoving = mv;
    if (mv >= 2) stats.twoMovingFrames++;
    const pil = g.obstacles.filter(o => o.type === 'pillar');
    if (pil.length) stats.sawPillar++;
    if (pil.length && mv > 0) stats.trainInPillarZone++;
    if (pil.length && S.lane === 1) stats.laneMidWhilePillar++;
    // 关键公平性：柱阵附近，左右两条道不能同时被封死，否则玩家无路可走
    if (pil.some(o => o.z + o.len / 2 > -60) && blocked(0) && blocked(2)) stats.trappedFrames = (stats.trappedFrames || 0) + 1;
    stats.maxSpeed = Math.max(stats.maxSpeed, S.speed);
    stats.reviveSpawned = S.reviveSpawned;   // 复活币：一共刷了几个 / 救了几次
    stats.reviveUsed = S.reviveUsed;
    if (S.pillar && S.pillar.sections > stats.pillarSections) stats.pillarSections = S.pillar.sections;
    if (![S.x, S.y, S.vy, S.D].every(Number.isFinite)) { nanAt = i; break; }
    if (g.Scene.id !== stats.visits[stats.visits.length - 1]) stats.visits.push(g.Scene.id);
    if (S.state !== 'playing') {
        const near = g.obstacles.filter(o => o.z - o.len / 2 < 1.2 && o.z + o.len / 2 > -1.2 && Math.abs(o.x - S.x) < 1.9)
            .map(o => o.type + '@z' + o.z.toFixed(1) + ' x' + o.x.toFixed(2) + ' h0=' + o.h0 + ' h1=' + o.h1 + (o.moving ? ' MOVING' : '') + (o.deadly ? ' DEADLY' : ''));
        // 取证：死了的那一刻，另外两条道是不是也被堵住了（判断有没有「必死局」）
        const lanes = [0, 1, 2].map(l => {
            const obs = g.obstacles.filter(o => o.lane === l && o.z + o.len / 2 > -34 && o.z - o.len / 2 < 2)
                .map(o => o.type + (o.moving ? 'M' : '') + '@' + (o.z - o.len / 2).toFixed(0));
            return l + ':' + (obs.length ? obs.join(',') : '-');
        }).join(' ');
        died = ((document.getElementById('overTitle') || {}).textContent || '?') + ' @D=' + S.D.toFixed(0) + ' scene=' + g.Scene.id
            + ' lane=' + S.lane + ' y=' + S.y.toFixed(2) + ' near=[' + near.join(' | ') + '] lanes[' + lanes + ']';
        break;
    }
}
return JSON.stringify({
    D: Math.round(S.D), frames: i, died, nanAt,
    stats: Object.assign(stats, { sections: S.pillar ? S.pillar.sections : -1 }),
    lane: S.lane, state: S.state, calls: g.renderer.info.render.calls,
});
})()`;

const r = await Promise.race([
    c.raw('Runtime.evaluate', { expression: src, returnByValue: true }),
    sleep(180000).then(() => { throw new Error('跑图超时'); }),
]);
log('结果: ' + r.result.value);
process.exit(0);
