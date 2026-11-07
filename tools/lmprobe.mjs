// ============================================================================
//  lmprobe.mjs —— 地标 GLB 接入验证
//
//  验证五件事：
//    1. GLB 真的被加载并注册（LMGLB.list() 里有对应 kind）
//    2. 归一化正确：高度 ≈ 54m、X 向占地 ≤ 16m
//    3. 材质按名字分类正确（tower_mass→mass / window_cool→window / neon_line→neon）
//    4. 场上真的有实例（遍历 worldGroup 数 userData.glbKind）
//    5. 没注册的 kind 仍走代码生成（不白屏）
//
//  用法：node tools/lmprobe.mjs [--file=.perf-real.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const WAIT = +val('--wait', 30);

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

let seq = 0; const pend = new Map(); const caught = []; const logs = [];
ws.addEventListener('message', evt => {
    const m = JSON.parse(evt.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 300));
    }
    if (m.method === 'Runtime.consoleAPICalled') {
        const s = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
        if (/\[landmark\]|\[lisboa\]/.test(s)) logs.push(s.slice(0, 240));
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
if (!ready) { console.log(JSON.stringify({ ready: false, caught: caught.slice(0, 4), logs }, null, 1)); ws.close(); process.exit(1); }

// 等一下让异步 GLB 加载全部落地（loadLandmarkGLBs 是 await 的，但建世界在 startGame 之后）
await sleep(1500);

const registered = await ev(`JSON.stringify(window.__game.LMGLB.list())`);
const models = await ev(`JSON.stringify(window.__game.LANDMARK_MODELS)`);

// 统计场上实例：遍历 worldGroup 找 glbKind 标记
const instances = await ev(`JSON.stringify((function(){
  const g = window.__game, byKind = {};
  let total = 0;
  g.worldGroup.traverse(o => {
    const k = o.userData && o.userData.glbKind;
    if (k) { byKind[k] = (byKind[k] || 0) + 1; total++; }
  });
  return { total, byKind };
})())`);

// 材质分类明细
const mats = await ev(`JSON.stringify((function(){
  const l = window.__game.LMGLB.list();
  const out = {};
  for (const x of l) out[x.kind] = x.mats;
  return out;
})())`);

const info = await ev(`JSON.stringify({
  dc: window.__game.renderer.info.render.calls,
  tris: window.__game.renderer.info.render.triangles,
  dist: Math.round(window.__game.S.D)
})`);

console.log(JSON.stringify({
    ready,
    models: JSON.parse(models || '{}'),
    registered: JSON.parse(registered || '[]'),
    instances: JSON.parse(instances || '{}'),
    materials: JSON.parse(mats || '{}'),
    render: JSON.parse(info || '{}'),
    logs,
    caught: caught.slice(0, 5),
}, null, 1));
ws.close();
