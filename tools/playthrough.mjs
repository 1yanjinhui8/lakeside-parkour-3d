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
    for (let i = 0; i < 460; i++) {
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

// ============================================================================
//  真实跑满一局：不瞬移、不强制刷道具，只看「正常玩下来是什么样」。
//  关心的是体验指标而不是断言：一局出几个道具、间隔多少、吃了对手多久反应、
//  帧率稳不稳、有没有异常。
// ============================================================================
const R = [];
const ok = (n, pass, extra) => { R.push([n, !!pass]); console.log((pass ? '  ✓ ' : '  ✗ ') + n + (extra ? '  ' + extra : '')); };

// 等时钟对齐、按钮可点 —— head -114 截断时把这个等待截掉了，直接点会是死键
const clock = await A.wait(`(() => { const b = document.getElementById('pkStart');
  return b && !b.disabled && window.__PKVS_APP.lobby.clockReady ? 'ok' : ''; })()`, 30000);
console.log('clock', clock);
await A.ev(`document.getElementById('pkStart').click(); true`);
for (const P of [A, B]) {
  await P.ev(`window.__pkGod = setInterval(() => { if (window.__game) window.__game.S.transGrace = 999; }, 80); true`);
  // 独立的帧率计数器（游戏自己的 rAF 数不到）
  await P.ev(`window.__fps = { n: 0, t0: performance.now() };
    (function f(){ window.__fps.n++; requestAnimationFrame(f); })(); true`);
}
for (let i = 0; i < 30; i++) {
  await sleep(500);
  if (await A.ev(`window.__PKVS_APP.phase`) === 'run' && await B.ev(`window.__PKVS_APP.phase`) === 'run') break;
}
ok('双方开跑', await A.ev(`window.__PKVS_APP.phase`) === 'run');
const t0 = Date.now();

const SAMPLE = `(() => {
  const g = window.__game, I = window.__PKITEMS;
  const ps = g.pickups.filter(p => typeof p.type === 'string' && p.type.indexOf('pk_') === 0);
  const now = performance.now();
  const hits = Object.keys(I.state.hits).filter(k => I.state.hits[k] && I.state.hits[k] > now);
  return {
    D: Math.round(g.S.D), spd: +g.S.speed.toFixed(1),
    onTrack: ps.map(p => p.type.slice(3) + '@' + Math.round(g.S.D - p.z) + '/' + p.x),
    hits, picked: I.state.picked, evil: I.state.evil || 0, rounds: I.state.rounds,
    fps: +((window.__fps.n * 1000) / Math.max(1, now - window.__fps.t0)).toFixed(1),
  };
})()`;

const seen = { A: new Set(), B: new Set() };
const eaten = [];            // 吃到的时刻（每人）
const effSpan = {};          // 效果实测持续时长
const prevHits = { A: [], B: [] };
const effStart = {};
const fpsSamples = [];
let lastD = { A: 0, B: 0 };
let anomaly = [];

console.log('\n— 实时采样（每 300ms）—');
for (let i = 0; i < 460; i++) {
  const a = await A.ev(SAMPLE), b = await B.ev(SAMPLE);
  if (!a || !b) { console.log('  ! 采样中断 i=' + i + ' a=' + JSON.stringify(a) + ' b=' + JSON.stringify(b)); break; }

  for (const [who, s] of [['A', a], ['B', b]]) {
    (s.onTrack || []).forEach(k => seen[who].add(k));
    // 吃到的时刻：picked 增加
    if (!eaten.length || eaten[eaten.length - 1][who] !== s.picked) {
      if (!eaten.length) eaten.push({ A: 0, B: 0, t: 0, D: {} });
      if (eaten[eaten.length - 1][who] !== s.picked) {
        eaten.push({ A: who === 'A' ? s.picked : (eaten[eaten.length - 1].A || 0),
                     B: who === 'B' ? s.picked : (eaten[eaten.length - 1].B || 0),
                     t: (Date.now() - t0) / 1000, D: { [who]: s.D }, who });
      }
    }
    // 效果出现 / 消失的时刻
    for (const k of s.hits) {
      if (prevHits[who].indexOf(k) < 0) { effStart[who + k] = Date.now(); }
    }
    for (const k of prevHits[who]) {
      if (s.hits.indexOf(k) < 0 && effStart[who + k]) {
        const dur = (Date.now() - effStart[who + k]) / 1000;
        (effSpan[who + ':' + k] = effSpan[who + ':' + k] || []).push(+dur.toFixed(2));
        delete effStart[who + k];
      }
    }
    prevHits[who] = s.hits;
    fpsSamples.push(s.fps);
    // 里程卡住 = 游戏停了
    if (s.D === lastD[who] && s.D < 1000 && i > 12) anomaly.push(who + ' 里程停在 ' + s.D + '(i=' + i + ')');
    lastD[who] = s.D;
  }

  if (i % 6 === 0) {
    console.log(`  t+${((Date.now() - t0) / 1000).toFixed(0)}s  A ${a.D}m ${a.spd}m/s fps=${a.fps}` +
      ` picked=${a.picked} 道具[${(a.onTrack || []).join(',')}] 效果[${a.hits.join(',')}]` +
      `  |  B ${b.D}m fps=${b.fps}`);
  }
  if (a.D >= 1000 || b.D >= 1000) break;
  if (Date.now() - t0 > 220000) { console.log('  ! 超时'); break; }
  await sleep(300);          // 注释写着「每 300ms」，之前漏了这一行，循环全速跑 60 次就完了
}

const dur = (Date.now() - t0) / 1000;
const finA = await A.ev(SAMPLE), finB = await B.ev(SAMPLE);
const spp = fpsSamples.filter(x => x > 0).sort((x, y) => x - y);

console.log('\n================ 一局数据 ================');
console.log('耗时            ', dur.toFixed(1) + 's');
console.log('A 里程/吃掉(其中负面)/刷出', finA.D + 'm / ' + finA.picked + '(' + finA.evil + ') / ' + finA.rounds);
console.log('B 里程/吃掉(其中负面)/刷出', finB.D + 'm / ' + finB.picked + '(' + finB.evil + ') / ' + finB.rounds);
console.log('A 见过道具      ', [...seen.A].sort().join(' ') || '(无)');
console.log('B 见过道具      ', [...seen.B].sort().join(' ') || '(无)');
console.log('帧率 中位/最低  ', (spp[Math.floor(spp.length / 2)] || 0) + ' / ' + (spp[0] || 0) + ' fps');
console.log('效果实测时长    ', JSON.stringify(effSpan));
console.log('吃掉时间线      ', JSON.stringify(eaten.filter(e => e.who).map(e => e.who + '@' + e.t + 's')));

ok('双方都跑到终点附近', Math.max(finA.D, finB.D) >= 999 && Math.min(finA.D, finB.D) >= 940,
  finA.D + ' / ' + finB.D + '（一人冲线即结束，另一个本来就跑不完）');
ok('一局刷出 3~6 个道具', finA.rounds >= 3 && finA.rounds <= 6, 'rounds=' + finA.rounds);
ok('两端各自刷出 3~6 个道具', seen.A.size >= 3 && seen.B.size >= 3,
  'A=' + seen.A.size + ' B=' + seen.B.size);
// 改成本地随机就是为了这一条：以前两端拿到同一个道具，互相扔，效果正好抵消
ok('两端道具不再完全相同', JSON.stringify([...seen.A].sort()) !== JSON.stringify([...seen.B].sort()),
  [...seen.A].sort().join(',') + ' vs ' + [...seen.B].sort().join(','));
ok('机器人吃到了道具', finA.picked > 0, 'picked=' + finA.picked);
ok('帧率没塌到卡死（>10fps）', (spp[0] || 0) > 10, 'min=' + (spp[0] || 0) + '（headless 软渲染，真机有 GPU 不是这个数）');
ok('全程没有卡住里程', anomaly.length === 0, anomaly.slice(0, 3).join('; '));

await A.shot('screenshots/play-A.png');
await B.shot('screenshots/play-B.png');
const bad = R.filter(x => !x[1]);
console.log('\n通过 ' + (R.length - bad.length) + '/' + R.length);
console.log('caught A', A.caught.slice(0, 4));
console.log('caught B', B.caught.slice(0, 4));
process.exit(bad.length ? 1 : 0);
