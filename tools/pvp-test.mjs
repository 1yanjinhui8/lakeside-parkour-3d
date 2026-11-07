// 双人对战端到端联调：两个**独立浏览器进程**（各自一个前台标签页，
// 不受后台 rAF 暂停影响），信令码手动中转 —— 和真人跨设备联机走同一条路径。
import fs from 'node:fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const HTTP = 8765;
const FILE = (process.argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || '.perf-real.html';

class Page {
  constructor(port, name) { this.port = port; this.name = name; }
  async open() {
    for (let i = 0; i < 30; i++) {
      try { await fetch(`http://127.0.0.1:${this.port}/json/version`); break; } catch (e) { await sleep(300); }
    }
    for (const t of (await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json()).filter(x => x.type === 'page'))
      await fetch(`http://127.0.0.1:${this.port}/json/close/${t.id}`).catch(() => { });
    await sleep(300);
    const tgt = await (await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' })).json();
    this.ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise(r => this.ws.addEventListener('open', r));
    this.seq = 0; this.pend = new Map(); this.caught = [];
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)(m); this.pend.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') this.caught.push((m.params.exceptionDetails.exception?.description || '').slice(0, 200));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        this.caught.push('ERR ' + (m.params.args.map(a => a.description || a.value).join(' ') || '').slice(0, 200));
    });
    await this.send('Page.enable'); await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 620, deviceScaleFactor: 1, mobile: false });
    // headless 下标签页会被判成不可见 → rAF 直接停摆，游戏里程一秒都不涨。
    // 两个浏览器窗口时尤其容易触发（后开的那个抢焦点）。
    // 三道一起上：提到前台 + 强制 active + 模拟焦点，缺一个都可能被节流。
    await this.send('Page.bringToFront', { }).catch(() => { });
    await this.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => { });
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => { });
  }
  send(m, p = {}, tmo = 120000) {
    const id = ++this.seq;
    const pr = new Promise((a, b) => this.pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
  }
  async goto(url) { await this.send('Page.navigate', { url }, 120000); }
  async ready() {
    for (let i = 0; i < 240; i++) {
      if (await this.ev('typeof window.__game==="object" && !!window.__game.player')) return true;
      await sleep(500);
    }
    return false;
  }
  async shot(path) {
    const s = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
  }
  async wait(expr, tmo = 30000, gap = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < tmo) {
      const v = await this.ev(expr);
      if (v) return v;
      await sleep(gap);
    }
    return null;
  }
}

const A = new Page(9222, 'host');
const B = new Page(9223, 'guest');
await A.open(); await B.open();
// three.js 走 jsdelivr，偶发拉不到就直接白屏 —— 加载失败就重试（最多 4 次）
async function boot(P) {
  for (let i = 0; i < 4; i++) {
    await P.goto(`http://127.0.0.1:${HTTP}/${FILE}?q=low&theme=campus&v=${Date.now()}-${i}`);
    if (await P.ready()) return true;
    console.log('  ' + P.name + ' 加载失败，重试 ' + (i + 1));
    await sleep(1500);
  }
  return false;
}
console.log('A ready', await boot(A));
console.log('B ready', await boot(B));

// 打开大厅（关掉同机自动传码，走真实的手动信令流程）
await A.ev(`document.getElementById('vsBtn').click(); true`);
await B.ev(`document.getElementById('vsBtn').click(); true`);
await sleep(400);
for (const P of [A, B]) {
  await P.ev(`const c=document.getElementById('pkBridgeChk'); c.checked=false; c.dispatchEvent(new Event('change')); true`);
}
await A.ev(`const n=document.getElementById('pkName'); n.value='房主'; n.dispatchEvent(new Event('input')); true`);
await B.ev(`const n=document.getElementById('pkName'); n.value='客人'; n.dispatchEvent(new Event('input')); true`);

// ---- 三步曲：创建 → 邀请码 → 回执码 → 确认 ----
await A.ev(`document.getElementById('pkCreate').click(); true`);
const invite = await A.wait(`(() => { const el=document.getElementById('pkInviteOut'); const v=el&&el.value||''; return v.indexOf('PK1')===0 && v.length>300 ? v : ''; })()`, 30000);
console.log('invite len', invite ? invite.length : 0);
if (!invite) { console.log('A caught', A.caught); process.exit(1); }

await B.ev(`document.getElementById('pkJoin').click(); true`);
await sleep(300);
await B.ev(`const el=document.getElementById('pkInviteIn'); el.value=${JSON.stringify(invite)}; el.dispatchEvent(new Event('input')); true`);
await B.ev(`document.getElementById('pkJoinGo').click(); true`);
const reply = await B.wait(`(() => { const el=document.getElementById('pkReplyOut'); const v=el&&el.value||''; return v.indexOf('PK1')===0 && v.length>300 ? v : ''; })()`, 30000);
console.log('reply len', reply ? reply.length : 0);
if (!reply) { console.log('B caught', B.caught); process.exit(1); }

await A.ev(`const el=document.getElementById('pkReplyIn'); el.value=${JSON.stringify(reply)}; el.dispatchEvent(new Event('input')); true`);
await A.ev(`document.getElementById('pkConfirm').click(); true`);
const connA = await A.wait(`(() => { const lb=window.__PKVS_APP.lobby; return lb && lb.vs && lb.vs.info().phase==='connected' ? { peer: lb.peerName, role: lb.role } : null; })()`, 30000);
const connB = await B.wait(`(() => { const lb=window.__PKVS_APP.lobby; return lb && lb.vs && lb.vs.info().phase==='connected' ? { peer: lb.peerName, role: lb.role } : null; })()`, 30000);
console.log('connected A', JSON.stringify(connA), 'B', JSON.stringify(connB));
await A.shot('screenshots/pvp-lobby.png');

// 等时钟对齐
const clock = await A.wait(`(() => { const b=document.getElementById('pkStart'); return b && !b.disabled && window.__PKVS_APP.lobby.clockReady ? 'ok' : ''; })()`, 30000);
console.log('clock', clock);
await A.ev(`document.getElementById('pkStart').click(); true`);
// 两边都先开着无敌：测试机器人不会躲障碍，否则开局 45m 就双双撞死，测不到后续分支
for (const P of [A, B]) {
  await P.ev(`window.__pkGod = setInterval(() => { if (window.__game) window.__game.S.transGrace = 999; }, 80); true`);
}

// 倒计时 → 开跑
for (let i = 0; i < 20; i++) {
  await sleep(500);
  const a = await A.ev(`({ p: window.__PKVS_APP.phase, D: Math.round(window.__game.S.D) })`);
  const b = await B.ev(`({ p: window.__PKVS_APP.phase, D: Math.round(window.__game.S.D) })`);
  if (i % 2 === 0) console.log('  t+' + (i * 0.5).toFixed(1), JSON.stringify(a), JSON.stringify(b));
  if (a.p === 'run' && b.p === 'run' && a.D > 20) break;
}

// 跑一会儿：进度同步 + 关卡一致性
await sleep(4000);
const fp = `(() => { const g=window.__game, S=g.S;
  // 窗口收窄到 50~130：两端里程差 1~2m，贴边界的障碍会一端有一端没有（假阳性）
  return g.obstacles.filter(o => { const arc=S.D-(o.z+o.len/2); return arc>50 && arc<130; })
    .map(o => o.type + ':' + o.lane + '@' + Math.round(S.D-(o.z+o.len/2))).sort(); })()`;
const fpA = await A.ev(fp), fpB = await B.ev(fp);
const pr = await A.ev(`(() => { const a=window.__PKVS_APP, r=a.lobby.race; return r? { me:Math.round(r.me), peer:Math.round(r.peer) } : null; })()`);
console.log('progress', JSON.stringify(pr), 'D A', await A.ev('Math.round(window.__game.S.D)'), 'D B', await B.ev('Math.round(window.__game.S.D)'));
console.log('layout A', JSON.stringify(fpA));
console.log('layout B', JSON.stringify(fpB));
const match = JSON.stringify(fpA) === JSON.stringify(fpB);
console.log('layout match', match);

// 干扰道具：两端在同一里程必须刷出同一个（类型 + 车道）。
// 位置由 seed 派生的独立随机源决定，跟障碍那条流分开，所以不该受里程差影响。
// 道具只在「提前 128m」以内才会被摆出来（LEAD_M）。固定写 200 会撞在这个边界上：
// D=70 时要求 s<=198，差 2 米就不生成 —— 上一版就是这么空手而归的。
// 等双方都跑过 90m，再给同一个绝对里程。
for (let i = 0; i < 12; i++) {
  const da = await A.ev(`Math.round(window.__game.S.D)`);
  const db = await B.ev(`Math.round(window.__game.S.D)`);
  if (Math.min(da, db) >= 92) break;
  await sleep(400);
}
await A.ev(`window.__PKITEMS._setNext(200); true`);
await B.ev(`window.__PKITEMS._setNext(200); true`);
await sleep(1200);
const ITEMS = `(() => window.__game.pickups
  .filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0)
  .map(p => p.type + '@' + Math.round(window.__game.S.D - p.z) + '/' + Math.round(p.x * 10) / 10)
  .sort())()`;
const itA = await A.ev(ITEMS), itB = await B.ev(ITEMS);
// 空数组和空数组也"相等"，得确认真的生成了才有意义
const ist = await A.ev(`({ alive: window.__PKITEMS.state.alive, next: Math.round(window.__PKITEMS.state.nextItemS),
  rounds: window.__PKITEMS.state.rounds, picked: window.__PKITEMS.state.picked,
  hasFn: typeof window.__game.placePowerUp, phase: window.__PKVS_APP.phase, D: Math.round(window.__game.S.D),
  allPickups: window.__game.pickups.length })`);
console.log('item state A', JSON.stringify(ist));
console.log('items A', JSON.stringify(itA));
console.log('items B', JSON.stringify(itB));
// 道具已经改成本地随机（各刷各的），两端不必一致 —— 只要求两边都真的刷出来了
const itemsOk = Array.isArray(itA) && itA.length > 0 && Array.isArray(itB) && itB.length > 0;
console.log('items 两端各自刷出', itemsOk, itemsOk ? '' : '← 有一边没刷出来');
console.log('  A', JSON.stringify(itA), ' B', JSON.stringify(itB));
if (!match) {
  console.log('  scene', await A.ev('window.__game.Scene.id'), await B.ev('window.__game.Scene.id'));
  console.log('  D', await A.ev('Math.round(window.__game.S.D)'), await B.ev('Math.round(window.__game.S.D)'));
}
await A.shot('screenshots/pvp-race.png');
await B.shot('screenshots/pvp-race-b.png');
console.log('hud', JSON.stringify(await A.ev(`(() => { const r=document.getElementById('pk-root');
  const hud=r.querySelector('#pkHud');
  return { hudOn:hud.classList.contains('on'), me:(r.querySelector('#pkMeM')||{}).textContent, peer:(r.querySelector('#pkPeerM')||{}).textContent,
           gap:(r.querySelector('#pkGap')||{}).textContent, timer:(r.querySelector('#pkTimer')||{}).textContent,
           hudTop:getComputedStyle(document.getElementById('hud')).top }; })()`)));

// 房主先冲线 → 进入「等待对手」：游戏应冻结在终点、别的结算屏不许抢镜
await A.ev(`window.__game.S.D = window.__PKVS_APP.goal - 2; true`);
await sleep(2200);
console.log('A after line', JSON.stringify(await A.ev(`({p:window.__PKVS_APP.phase, rep:window.__PKVS_APP.reported, D:Math.round(window.__game.S.D),
  wait:document.getElementById('pkWait').classList.contains('on'), title:document.querySelector('#pkWait .t').textContent, sub:document.querySelector('#pkWait .s').textContent,
  live:document.querySelector('#pkWait .live').textContent, overHidden:document.getElementById('over').classList.contains('hidden')})`)));
const d1 = await A.ev('Math.round(window.__game.S.D)');
await sleep(900);
const d2 = await A.ev('Math.round(window.__game.S.D)');
console.log('frozen at line', d1, '->', d2, d1 === d2 ? 'OK' : '还在跑！');
await A.shot('screenshots/pvp-wait.png');
// 客人也跑到终点：两端都应收到终局
await B.ev(`clearInterval(window.__pkGod); window.__game.S.D = window.__PKVS_APP.goal - 2; true`);
await sleep(4000);
console.log('B after line', JSON.stringify(await B.ev(`({p:window.__PKVS_APP.phase, rep:window.__PKVS_APP.reported, D:Math.round(window.__game.S.D)})`)));

const res = `(() => { const r=document.getElementById('pk-root'); if(!r) return null;
  return { screen:[...r.querySelectorAll('.pk-screen')].filter(n=>n.classList.contains('on')).map(n=>n.dataset.screen),
           title:(r.querySelector('#pkResultTitle')||{}).textContent, sub:(r.querySelector('#pkResultSub')||{}).textContent,
           rows:[...r.querySelectorAll('.pk-score-row')].map(n=>n.textContent.replace(/\\s+/g,' ').trim()) }; })()`;
console.log('result A', JSON.stringify(await A.ev(res)));
console.log('result B', JSON.stringify(await B.ev(res)));
await A.shot('screenshots/pvp-result.png');
// 再来一局：双方都点，应换新种子重开
await sleep(600);
await A.ev(`document.getElementById('pkAgain').click(); true`);
await sleep(400);
await B.ev(`document.getElementById('pkAgain').click(); true`);
for (let i = 0; i < 24; i++) {
  await sleep(500);
  const a = await A.ev(`({p:window.__PKVS_APP.phase, D:Math.round(window.__game.S.D), seed:window.__PKVS_APP.seed})`);
  const b = await B.ev(`({p:window.__PKVS_APP.phase, D:Math.round(window.__game.S.D), seed:window.__PKVS_APP.seed})`);
  if (i % 3 === 0) console.log('  rematch', JSON.stringify(a), JSON.stringify(b));
  if (a.p === 'run' && b.p === 'run' && a.D > 15) { console.log('  rematch OK，同种子:', a.seed === b.seed); break; }
}
await A.shot('screenshots/pvp-rematch.png');
console.log('caught A', A.caught.slice(0, 4));
console.log('caught B', B.caught.slice(0, 4));
process.exit(0);
