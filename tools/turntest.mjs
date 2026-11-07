// ============================================================================
//  turntest.mjs —— 校园路口转向验收
//    · 不按键 → 应该在路口被判负
//    · 按对方向 → 应该安全通过
//    · 按错方向 → 应该被判负
//  用法： node tools/turntest.mjs [--arc=130]
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const START_ARC = +val('--arc', '110');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page'))
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 60000) => { const id = ++seq; const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result)))); ws.send(JSON.stringify({ id, method: m, params: p })); return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]); };
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;
const key = async (code, keyName) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: keyName, code: keyName });
    await sleep(60);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: keyName, code: keyName });
    // 兜底：无头环境偶尔不投递真实按键，再补一次合成事件（走的是同一个 keydown 处理器）
    const got = await ev('window.__game.CAMPUS.pendingDir');
    if (!got) await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${keyName}', bubbles: true })), true`);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
const stamp = Math.round(fs.statSync(path.join(ROOT, '.perf-real.html')).mtimeMs);
const THEME = (process.argv.find(a => a.startsWith('--theme=')) || '--theme=campus').split('=')[1];
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=high&theme=${THEME}&v=${stamp}` }, 90000);
for (let i = 0; i < 200; i++) { if (await ev('typeof window.__game === "object" && !!window.__game.player && !!window.__game.CAMPUS').catch(() => 0)) break; await sleep(300); }
await ev('window.__game.QUALITY.adaptive = false; window.__wx.setTime(0.36); true');
await sleep(600);

const jumps = await ev('JSON.stringify(window.__game.CAMPUS.junctions)');
console.log('路口表:', jumps);

/** 把玩家放到 arc 处，返回下一个路口的期望方向 */
async function placeAt(arc) {
    return await ev(`(() => {
        const G = window.__game, C = G.CAMPUS;
        G.S.state = 'playing'; G.S.paused = false; G.Scene.phase = 'run';
        G.S.transGrace = 0; G.S.revives = 0; G.S.flight.active = false; G.S.flying = false;
        // 清空赛道：只验转向，不许被障碍撞死
        G.S.nextRowS = 1e9;
        for (const o of G.obstacles) { o.z = 1e6; o.mesh.visible = false; }
        for (const c of G.coins) { c.z = 1e6; c.mesh.visible = false; }
        for (const p of G.pickups) { p.z = 1e6; p.mesh.visible = false; }
        G.S.lane = 1; G.S.x = 0;
        G.CONFIG.speed.start = 55; G.CONFIG.speed.max = 55;   // 无头浏览器 fps 低，调速度免得等到超时
        C.s = ${arc} - 35;
        let i = 0;
        for (; i < C.junctions.length; i++) if (C.junctions[i].at >= ${arc} - 1) break;
        C.jLap = 0;
        if (i >= C.junctions.length) { i = 0; C.jLap = 1; }
        C.jIdx = i;
        C.nextAbs = C.jLap * C.total + C.junctions[i].at;
        C.pendingDir = 0; C.pendingAt = -1e9; C.lastTurn = null;
        return JSON.stringify({ next: C.nextAbs, dir: C.junctions[i].dir, deg: C.junctions[i].deg,
                                dist: +(C.nextAbs - C.s).toFixed(1) });
    })()`);
}

const results = [];
async function runCase(label, press) {
    const info = JSON.parse(await placeAt(START_ARC));
    await sleep(300);
    if (press === 'L') await key(37, 'ArrowLeft', '\u0000');
    if (press === 'R') await key(39, 'ArrowRight', '\u0000');
    const lastTurn = await ev('JSON.stringify(window.__game.CAMPUS.lastTurn||null)');
    const pressInfo = await ev('JSON.stringify({pd:window.__game.CAMPUS.pendingDir, pa:+window.__game.CAMPUS.pendingAt.toFixed(0), s:+window.__game.CAMPUS.s.toFixed(0), st:window.__game.S.state, paused:window.__game.S.paused})');
    console.log('        按键后:', pressInfo);
    // 等它跑过路口
    const need = info.dist + 22;
    const t0 = Date.now();
    let state = 'playing', cause = null; const trace = [];
    while (Date.now() - t0 < 25000) {
        await sleep(200);
        const stRaw = await ev('JSON.stringify({s:window.__game.S.state,c:window.__game.S.lastDeathCause||null,d:+window.__game.CAMPUS.s.toFixed(0),lt:(window.__game.CAMPUS.lastTurn||{}).at||0})');
        if (!stRaw) continue;
        const st = JSON.parse(stRaw);
        state = st.s; cause = st.c; trace.push([st.d, st.s, st.lt]);
        // 已经判过这个路口，或已经死了 → 收工
        if (Math.abs(st.lt - info.next) < 1.5 || state !== 'playing') break;
    }
    console.log('        路口判定:', await ev('JSON.stringify(window.__game.CAMPUS.lastTurn||null)'));
    results.push({ label, need: info.dir + info.deg.toFixed(0) + '°', press: press || 'none', state, cause, trace });
    console.log(`  ${label.padEnd(16)} 路口方向=${info.dir}${info.deg.toFixed(0)}°  按下=${press || '无'}  →  state=${state}  cause=${cause || '-'}`);
    await ev("window.__game.startGame(); window.__noTurnFail = false; true");
    await sleep(900);
}

console.log(`\n路口在 ${START_ARC}m 之后的 ${JSON.parse(await placeAt(START_ARC)).dist}m 处\n`);
await runCase('不按键', null);
await runCase('按对方向', JSON.parse(await placeAt(START_ARC)).dir);
await runCase('按错方向', JSON.parse(await placeAt(START_ARC)).dir === 'L' ? 'R' : 'L');

console.log('\n汇总:', JSON.stringify(results, null, 1));
const ok = results[0].state !== 'playing' && results[1].state === 'playing' && results[2].state !== 'playing';
console.log(ok ? '\n✅ 转向判定符合预期' : '\n❌ 转向判定不符合预期');
process.exit(ok ? 0 : 1);
