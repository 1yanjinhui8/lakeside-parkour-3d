// ============================================================================
//  betaprobe.mjs —— 内测版验证：1000 米换图 + 人物无敌
//
//  验证四件事（每条都是行为验证，不看代码注释）：
//    1. 四张地图的段长都是 [1000, 1000]
//    2. 开局 segEnd 正好是 1000
//    3. 撞车不死（把车摆在玩家身上推 12 帧，state 仍是 playing）
//    4. 死亡机制本身没被改坏（直接调 die() 仍能进 dying）
//    5. 跑到 1005 米确实进入转场相位（不是继续跑）
//
//  用法：node tools/betaprobe.mjs [--file=playable-beta.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-beta.html');
const WAIT = +val('--wait', 25);

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', evt => {
    const m = JSON.parse(evt.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 300));
    }
});
const send = (m, p = {}, tmo = 40000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 40000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&v=${stamp}` }, 30000);

let ready = false;
for (let i = 0; i < WAIT; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) { ready = true; break; }
    if (caught.length) break;
    await sleep(1000);
}
if (!ready) { console.log(JSON.stringify({ ready: false, caught: caught.slice(0, 4) }, null, 1)); ws.close(); process.exit(1); }

// ---------------------------------------------------------------- ①② 段长
const lens = await ev(`JSON.stringify((function(){
  const T = window.__game.THEMES, out = {};
  for (const k of ['lakeside','tunnel','city','campus']) out[k] = T[k] && T[k].segLen;
  return out;
})())`);

// 干净开局
await ev(`(function(){
  const g = window.__game;
  g.startGame();
  g.QUALITY.adaptive = false;
  g.Scene.phase = 'run'; g.Scene.fanfareDone = false;
  return true;
})()`);
await sleep(400);

const seg0 = await ev(`JSON.stringify({ id: window.__game.Scene.id, segEnd: Math.round(window.__game.Scene.segEnd), D: Math.round(window.__game.S.D) })`);

// ---------------------------------------------------------------- ③ 撞车不死
const crashTest = await ev(`JSON.stringify((function(){
  const g = window.__game;
  g.S.state = 'playing'; g.S.flight.phase = 'idle'; g.S.flying = false;
  // 三项都清掉，确保测的是「内测版无敌」而不是别的保护在兜底：
  //   transGrace = 转场无敌；landGrace = 落地保护（会把玩家直接放到车顶而不是撞死）；
  //   power.shield = 护盾（会挡下撞击但不死，同样会掩盖结果）
  g.S.transGrace = 0; g.S.landGrace = 0; g.S.power.shield = 0;
  g.obstacles.length = 0;
  g.S.nextRowS = g.S.D + 99999;             // 暂停随机生成，场上只有我放的这一辆
  const before = g.S.state;
  // sFront 传的是「绝对里程」：addObstacle 内部算 zOf(sFront + len/2) = S.D - 2.3，
  // 即车中心在玩家前方 2.3m、车身覆盖 z ∈ [-4.6, 0]，与站在 z=0 的玩家必然重叠。
  const o = g.addObstacle('car', g.S.lane, g.S.D, 4.6, g.makeCar());
  for (let i = 0; i < 12; i++) {
    g.S.transGrace = 0; g.S.landGrace = 0; g.S.power.shield = 0;
    g.step(1/60);
  }
  return {
    before,
    after: g.S.state,
    dead: g.S.state === 'dying',
    carZ: +o.z.toFixed(2),
    cause: g.S.lastDeathCause || null
  };
})())`);

// ---------------------------------------------------------------- ④ 死亡机制没坏
const dieTest = await ev(`JSON.stringify((function(){
  const g = window.__game;
  g.S.state = 'playing';
  g.die('探针自测');
  return { after: g.S.state, cause: g.S.lastDeathCause || null };
})())`);

// ---------------------------------------------------------------- ⑤ 1005m 换场
// 关键：不要一看到 phase 变了就退出。portalIn 阶段是靠 scrollWorld 把传送门推近、
// 到位后 finishPortal() → swapTo() 才真正换场，而 scrollWorld 就在 updatePlaying 里，
// 所以 step() 能一路推到换场完成。这里一直 step 到 Scene.id 变了为止。
const swapTest = await ev(`JSON.stringify((function(){
  const g = window.__game;
  g.resetState();
  g.QUALITY.adaptive = false;
  g.S.state = 'playing';
  g.Scene.phase = 'run'; g.Scene.fanfareDone = true;   // 跳过终点环绕，直接测换场
  const startId = g.Scene.id;
  const startSegEnd = Math.round(g.Scene.segEnd);
  let n = 0, sawPhase = '';
  while (g.Scene.id === startId && n++ < 30000) {
    g.step(1/60);
    if (!sawPhase && g.Scene.phase !== 'run') sawPhase = g.Scene.phase;
  }
  return {
    startId, startSegEnd,
    D: Math.round(g.S.D),
    sceneId: g.Scene.id,
    changed: g.Scene.id !== startId,
    firstNonRunPhase: sawPhase,
    segEnd: Math.round(g.Scene.segEnd),
    gap: Math.round(g.Scene.segEnd - g.S.D),
    steps: n
  };
})())`, 90000);

console.log(JSON.stringify({
    ready,
    segLen: JSON.parse(lens || '{}'),
    seg0: JSON.parse(seg0 || '{}'),
    crash: JSON.parse(crashTest || '{}'),
    dieWorks: JSON.parse(dieTest || '{}'),
    swap: JSON.parse(swapTest || '{}'),
    caught: caught.slice(0, 5)
}, null, 1));

// ---------------------------------------------------------------- ⑥ 连换两段
// 只换一次说明不了"每 1000 米一次"。再跑一段，确认第二次也是 1000 米后就换。
const swap2 = await ev(`JSON.stringify((function(){
  const g = window.__game;
  const id0 = g.Scene.id, seg0 = Math.round(g.Scene.segEnd);
  let n = 0;
  while (g.Scene.id === id0 && n++ < 30000) g.step(1/60);
  return {
    from: id0, fromSegEnd: seg0,
    to: g.Scene.id, D: Math.round(g.S.D),
    segEnd: Math.round(g.Scene.segEnd),
    gap: Math.round(g.Scene.segEnd - g.S.D),
    steps: n
  };
})())`, 90000);
console.log('第二段换场:', swap2);
console.log('异常:', JSON.stringify(caught.slice(0, 5)));

ws.close();
