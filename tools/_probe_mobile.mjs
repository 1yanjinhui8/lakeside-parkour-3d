// ============================================================================
//  _probe_mobile.mjs —— 移动端开销代理指标探针（只读，不改任何文件）
//  用法: node tools/_probe_mobile.mjs [--file=playable.html] [--q=mid] [--theme=city]
//  产出: 一帧的 renderer.info / programs / 纹理显存估算 / 阴影 pass drawcall
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9333, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const Q = val('--q', 'mid');
const THEME = val('--theme', 'city');
const W = +(val('--w', '390')), H = +(val('--h', '844')), DPR = +(val('--dpr', '3'));

const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (m, p = {}, tmo = 180000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 180000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable');
await send('Runtime.enable');
// —— 关键：伪装成手机，让 detectQualityTier() 走手机分支 ——
await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: DPR, mobile: true,
    screenWidth: W, screenHeight: H,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE, platform: 'Android' });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
const url = `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=${Q}&theme=${THEME}&t=0.68&wx=rain&v=${stamp}`;
console.error('navigate:', url);
await send('Page.navigate', { url }, 180000);
for (let i = 0; i < 900; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(400);
}
console.error('ready');

await ev(`(()=>{const g=window.__game;g.startGame();g.QUALITY.adaptive=false;g.S.paused=false;return true})()`);
await sleep(1200);

// —— 静态结构统计（不依赖帧率）——
const stat = await ev(`(() => {
  const g = window.__game, R = g.renderer, sc = g.scene;
  const mats = new Map(); let meshes=0, sprites=0, points=0, casters=0, additiveMeshes=0, transparentMeshes=0;
  const texSizes = new Map();
  sc.traverse(o => {
    if (o.isMesh || o.isSprite || o.isPoints) {
      if (o.isMesh) meshes++; else if (o.isSprite) sprites++; else points++;
      const visible = o.visible !== false;
      if (o.castShadow) casters++;
      const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of ms) {
        if (!m) continue;
        if (!mats.has(m.uuid)) mats.set(m.uuid, { name: m.type, blending: m.blending, transparent: !!m.transparent, side: m.side, aniso: 0, tex: 0, visible: m.visible !== false });
        if (m.blending === 2 /* AdditiveBlending */ && visible) additiveMeshes++;
        if (m.transparent && visible) transparentMeshes++;
        const e = mats.get(m.uuid);
        for (const k of ['map','emissiveMap','alphaMap','normalMap','roughnessMap','metalnessMap','aoMap']) {
          const t = m[k];
          if (t && t.image) {
            e.tex++;
            const key = (t.image.width||0)+'x'+(t.image.height||0);
            texSizes.set(key, (texSizes.get(key)||0)+1);
            if (t.anisotropy > e.aniso) e.aniso = t.anisotropy;
          }
        }
      }
    }
  });
  const byType = {}; const byBlend = {0:0,1:0,2:0,3:0,4:0};
  let matList = [];
  for (const m of mats.values()) {
    byType[m.name] = (byType[m.name]||0)+1;
    byBlend[m.blending] = (byBlend[m.blending]||0)+1;
    if (m.blending === 2) matList.push(m.name+'/'+(m.tex?'tex':'flat'));
  }
  // 纹理显存估算：w*h*4 * 1.333(mipmap) ，只统计唯一 image
  let vram = 0, texCount = 0; const seen = new Set();
  sc.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : [];
    for (const m of ms) { if(!m) continue;
      for (const k of ['map','emissiveMap','alphaMap','normalMap','roughnessMap','metalnessMap','aoMap']) {
        const t = m[k]; if (!t || !t.image || seen.has(t.uuid)) continue; seen.add(t.uuid);
        const w = t.image.width||0, h = t.image.height||0;
        vram += w*h*4*1.333; texCount++;
      }
    }
  });
  return JSON.stringify({
    tier: g.QUALITY.tier, dpr: devicePixelRatio, pr: R.getPixelRatio(),
    css: [innerWidth, innerHeight], drawBuffer: [R.domElement.width, R.domElement.height],
    meshes, sprites, points, casters, additiveMeshes, transparentMeshes,
    materials: mats.size, byType, byBlend, additiveList: matList,
    texCount, vramMB: +(vram/1048576).toFixed(1), texSizes: Object.fromEntries(texSizes),
    programs: R.info.programs.length,
    memGeometries: R.info.memory.geometries, memTextures: R.info.memory.textures,
    shadowEnabled: R.shadowMap.enabled, shadowType: R.shadowMap.type,
    shadowSize: g.scene && window.__game ? (window.__game.S && 0) : 0,
    fog: [sc.fog.near, sc.fog.far], fogColor: sc.fog.color.getHexString(),
    camFar: g.camera.far, fov: g.camera.fov, aspect: +g.camera.aspect.toFixed(3),
  });
})()`);
const S = JSON.parse(stat);

// —— 一帧的 drawcall / 三角面（info.reset 在 shadow pass 之后，所以不含阴影）——
const frame = await ev(`(() => {
  const g = window.__game, R = g.renderer;
  // 手动接管 info：关掉 autoReset，先 reset 再让下一帧自己跑，这样能拿到"含阴影"的累计
  R.info.autoReset = false;
  return JSON.stringify({autoReset: R.info.autoReset});
})()`);

// 测量 A：正常一帧（autoReset=true，标准口径 = 主 pass only）
await ev(`(()=>{window.__game.renderer.info.autoReset=true;return 1})()`);
await sleep(700);
const A = JSON.parse(await ev(`JSON.stringify({
  calls: window.__game.renderer.info.render.calls,
  tris: window.__game.renderer.info.render.triangles,
  points: window.__game.renderer.info.render.points,
})`));

// 测量 B：包住 shadowMap.render 数出阴影 pass 的 drawcall
const B = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer, SM = R.shadowMap;
  let shadowCalls = 0, shadowTris = 0, shadowFrames = 0, totalFrames = 0;
  const orig = SM.render.bind(SM);
  SM.render = function(shadows, scene, camera) {
    const c0 = R.info.render.calls, t0 = R.info.render.triangles;
    orig(shadows, scene, camera);
    shadowCalls += (R.info.render.calls - c0);
    shadowTris  += (R.info.render.triangles - t0);
    shadowFrames++;
  };
  await new Promise(r => setTimeout(r, 2500));
  SM.render = orig;
  return JSON.stringify({ shadowCalls, shadowTris, shadowFrames, note: 'shadowFrames=实际执行阴影pass次数/2.5s' });
})()`));

// 测量 C：JS 侧每帧耗时（不含 GPU，SwiftShader 下 GPU 时间无意义）
const C = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera;
  const N = 60; const ts = [];
  for (let i = 0; i < N; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    R.render(sc, cam);
    ts.push(performance.now() - t0);
  }
  ts.sort((a,b)=>a-b);
  const sum = ts.reduce((a,b)=>a+b,0);
  return JSON.stringify({ n: N, mean: +(sum/N).toFixed(2), p50: +ts[Math.floor(N*0.5)].toFixed(2), p95: +ts[Math.floor(N*0.95)].toFixed(2), max: +ts[N-1].toFixed(2) });
})()`));

// 测量 D：把关键特性逐项关掉，看 drawcall / 三角面怎么变
const D = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer, sc = g.scene;
  const snap = () => ({ calls: R.info.render.calls, tris: R.info.render.triangles, points: R.info.render.points });
  const once = async () => { await new Promise(r => requestAnimationFrame(r)); await new Promise(r => requestAnimationFrame(r)); return snap(); };
  const base = await once();
  // 关阴影
  const sh = R.shadowMap.enabled; R.shadowMap.enabled = false;
  const noShadow = await once(); R.shadowMap.enabled = sh;
  // 关所有 additive
  const addMats = []; sc.traverse(o => { const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : []; for (const m of ms) if (m && m.blending === 2) addMats.push(m); });
  const vis = addMats.map(m => m.visible);
  addMats.forEach(m => m.visible = false);
  const noAdd = await once();
  addMats.forEach((m,i) => m.visible = vis[i]);
  // 关透明
  const trMats = []; sc.traverse(o => { const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : []; for (const m of ms) if (m && m.transparent) trMats.push(m); });
  const vis2 = trMats.map(m => m.visible);
  trMats.forEach(m => m.visible = false);
  const noTr = await once();
  trMats.forEach((m,i) => m.visible = vis2[i]);
  return JSON.stringify({ base, noShadow, noAdd, noTr, addMatCount: addMats.length, trMatCount: trMats.length });
})()`));

console.log(JSON.stringify({ file: FILE, q: Q, theme: THEME, static: S, frameA: A, shadow: B, jsRender: C, toggles: D }, null, 2));
ws.close();
