// ============================================================================
//  overlapprobe.mjs —— 找出「地标 GLB 被别的建筑穿插」的具体对象
//
//  做法：拿到指定 kind 的 GLB 实例，算世界 AABB；再遍历整个 worldGroup，
//  找所有 AABB 与它相交的 mesh，输出尺寸/位置/材质名，直接看出是被什么挡的。
//
//  用法：node tools/overlapprobe.mjs --kinds=cbd,gateSuzhou [--at=170]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const KINDS = val('--kinds', 'cbd,gateSuzhou').split(',');
const AT = +val('--at', 170);
const FILE = val('--file', '.perf-real.html');

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
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 200));
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
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) { ready = true; break; }
    if (caught.length) break;
    await sleep(1000);
}
if (!ready) { console.log(JSON.stringify({ ready: false, caught }, null, 1)); ws.close(); process.exit(1); }

// 推到指定里程，让目标地标进入世界
await ev(`(()=>{const g=window.__game;let n=0;
  while(g.S.D < ${AT} && n++ < 40000){ g.S.transGrace=1e9; g.step(1/60); }
  return Math.round(g.S.D);})()`);
await sleep(800);

const out = await ev(`JSON.stringify((function(){
  const g = window.__game, THREE = g.THREE || null;
  const kinds = ${JSON.stringify(KINDS)};
  const res = {};

  // 遍历整棵世界树，收集所有 mesh 的 AABB 和它属于哪个 glbKind
  const items = [];
  g.worldGroup.updateMatrixWorld(true);
  g.worldGroup.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    // 找到它属于哪个 glb 实例
    let kind = null, p = o;
    while (p) { if (p.userData && p.userData.glbKind) { kind = p.userData.glbKind; break; } p = p.parent; }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    items.push({
      kind,
      box: { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] },
      mat: m ? (m.name || m.type) : '?',
      tris: o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0),
    });
  });

  const overlap = (a, b) => a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
                           a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
                           a.min[2] < b.max[2] && a.max[2] > b.min[2];

  for (const k of kinds) {
    const mine = items.filter(it => it.kind === k);
    if (!mine.length) { res[k] = { found: false }; continue; }
    // 合并该 kind 所有 mesh 的 AABB
    const box = { min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] };
    for (const it of mine) for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], it.box.min[i]);
      box.max[i] = Math.max(box.max[i], it.box.max[i]);
    }
    // 找相交的外部 mesh（排除自己这个 kind）
    const hits = [];
    for (const it of items) {
      if (it.kind === k) continue;
      // 跳过「按材质大合并」产出的大批次：它们的 AABB 横跨整条街，
      // 和任何东西都相交，属于假阳性，会把真正的原因淹掉
      const sx = it.box.max[0] - it.box.min[0];
      const sy = it.box.max[1] - it.box.min[1];
      const sz = it.box.max[2] - it.box.min[2];
      if (sx > 60 || sz > 60) continue;
      if (!overlap(box, it.box)) continue;
      const ox = Math.min(box.max[0], it.box.max[0]) - Math.max(box.min[0], it.box.min[0]);
      const oy = Math.min(box.max[1], it.box.max[1]) - Math.max(box.min[1], it.box.min[1]);
      const oz = Math.min(box.max[2], it.box.max[2]) - Math.max(box.min[2], it.box.min[2]);
      hits.push({
        mat: it.mat,
        size: [it.box.max[0]-it.box.min[0], it.box.max[1]-it.box.min[1], it.box.max[2]-it.box.min[2]].map(v => +v.toFixed(1)),
        pos: [(it.box.min[0]+it.box.max[0])/2, (it.box.min[1]+it.box.max[1])/2, (it.box.min[2]+it.box.max[2])/2].map(v => +v.toFixed(1)),
        overlap: [ox, oy, oz].map(v => +v.toFixed(1)),
        tris: Math.round(it.tris),
      });
    }
    hits.sort((a, b) => (b.overlap[0]*b.overlap[1]*b.overlap[2]) - (a.overlap[0]*a.overlap[1]*a.overlap[2]));
    res[k] = {
      found: true,
      meshes: mine.length,
      box: {
        size: [box.max[0]-box.min[0], box.max[1]-box.min[1], box.max[2]-box.min[2]].map(v => +v.toFixed(1)),
        min: box.min.map(v => +v.toFixed(1)),
        max: box.max.map(v => +v.toFixed(1)),
      },
      hitCount: hits.length,
      topHits: hits.slice(0, 10),
    };
  }
  return res;
})())`, 60000);

console.log(JSON.stringify({ at: AT, result: JSON.parse(out || '{}'), caught: caught.slice(0, 3) }, null, 1));
ws.close();
