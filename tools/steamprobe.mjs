// ============================================================================
//  steamprobe.mjs —— 验证地面蒸汽在"按材质大合并"后仍然存活
//  蒸汽材质特征：transparent + opacity≈0.1 + DoubleSide(2)，全场景只有它用这一组合
//  用法：node tools/steamprobe.mjs [--file=.perf-real.html]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(400);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push('EXC: ' + desc.slice(0, 200));
    }
});
const send = (m, p = {}, tmo = 90000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 90000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&v=${stamp}` }, 120000);
for (let i = 0; i < 200; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
await ev('window.__game.startGame(); true');
await sleep(3000);

const out = await ev(`JSON.stringify((function(){
  var g = window.__game, sprites = 0, meshes = 0, steam = 0, steamTris = 0;
  g.worldGroup.traverse(function(o){
    if (o.isSprite) sprites++;
    if (!o.isMesh) return;
    meshes++;
    var m = o.material;
    if (m && !Array.isArray(m) && m.transparent && Math.abs(m.opacity - 0.1) < 0.002 && m.side === 2) {
      steam++;
      var p = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (p) steamTris += (o.geometry.index ? o.geometry.index.count : p.count) / 3;
    }
  });
  return { merge: g.mergeState, sprites: sprites, meshes: meshes,
           steamBatches: steam, steamTris: Math.round(steamTris),
           dc: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
})())`);
console.log('STEAM', out);
console.log('CAUGHT', JSON.stringify(caught.slice(0, 4)));
ws.close();
