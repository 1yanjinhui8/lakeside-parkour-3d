// 运行时内存基线：JS 堆 / 纹理数 / 几何数 / drawcall
//   node tools/memcheck.mjs [.perf-real.html]
const PORT = +(process.env.CDP_PORT || 9222), HTTP = 8765;
const FILE = process.argv[2] || '.perf-real.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 180000) => new Promise((a, b) => {
    const id = ++seq; pend.set(id, x => x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); b(new Error('tmo ' + m)); } }, tmo);
});
const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/${FILE}?q=mid&theme=city&t=0.72&v=${Date.now()}` }, 240000);
for (let i = 0; i < 300; i++) { if (await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(400); }
for (let i = 0; i < 60; i++) { const n = await ev('window.__game.LMGLB.list().length'); if (n) break; await sleep(1000); }
await ev('window.__game.startGame(); true'); await sleep(3000);
const out = await ev(`(() => {
  const G = window.__game, r = G.renderer;
  let tex = 0, kb = 0;
  // 统计地标贴图的实际尺寸
  const seen = new Set();
  G.worldGroup.traverse(o => { if (!(o.userData && o.userData.glbKind)) return;
    o.traverse(c => { if (!c.isMesh) return; const m = Array.isArray(c.material)?c.material[0]:c.material; if (!m || seen.has(m.uuid)) return; seen.add(m.uuid);
      for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap']) {
        const t = m[k]; if (!t || !t.image) continue; tex++;
        kb += (t.image.width * t.image.height * 4) / 1024;
      }
    });
  });
  return {
    jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    textures: r.info.memory.textures, geometries: r.info.memory.geometries,
    programs: r.info.programs ? r.info.programs.length : null,
    landmarkTex: tex, landmarkTexMB: +(kb / 1024).toFixed(1),
    sceneTexMB: (() => {          // 全场景贴图内存（按解码后 RGBA 估算）
      const seen2 = new Set(); let sum = 0;
      G.scene.traverse(o => {
        if (!o.isMesh) return;
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of arr) {
          if (!m) continue;
          for (const k of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','aoMap']) {
            const t = m[k]; if (!t || !t.image || seen2.has(t.uuid)) continue; seen2.add(t.uuid);
            sum += (t.image.width * t.image.height * 4) / 1048576;
          }
        }
      });
      return +sum.toFixed(1);
    })(),
    drawCalls: r.info.render.calls,
    landmarks: G.LMGLB.list().map(x => x.kind + ':' + x.w + 'x' + x.h).join(', ')
  };
})()`);
console.log(JSON.stringify(out, null, 1));
process.exit(0);
