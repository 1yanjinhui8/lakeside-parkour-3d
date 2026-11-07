// ============================================================================
//  _probe2.mjs —— 过度绘制（overdraw）与档位开销实测（只读）
//  用法: node tools/_probe2.mjs
//  依赖: 9333 端口的无头 Edge + 8766 静态服务
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9333, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = process.argv.find(a => a.startsWith('--file='))?.slice(7) || '.perf-real.html';
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}, tmo = 120000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 120000) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo);
    if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    return r.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE, platform: 'Android' });

const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=mid&theme=city&t=0.68&wx=rain&v=${stamp}` }, 120000);
for (let i = 0; i < 300; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
console.error('ready');
await ev(`(()=>{const g=window.__game;g.startGame();g.QUALITY.adaptive=false;g.S.paused=false;return 1})()`);
await sleep(1000);

// ---- 1) 过度绘制：逐类隔离渲染，用 readPixels 数出真实覆盖像素 ----
const overdraw = JSON.parse(await ev(`(() => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera;
  const gl = R.getContext();
  const W = R.domElement.width, H = R.domElement.height;

  // 把每个顶层对象归类
  const cls = new Map();   // obj -> set of tags
  sc.traverse(o => {
    if (!(o.isMesh || o.isSprite || o.isPoints)) return;
    const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : [];
    const tags = new Set();
    for (const m of ms) {
      if (!m) continue;
      if (m.blending === 2) tags.add('additive');
      if (m.transparent) tags.add('transparent');
      if (o.isPoints) tags.add('points');
      if (o.isSprite) tags.add('sprite');
    }
    cls.set(o, tags);
  });

  const buf = new Uint8Array(W * H * 4);
  const count = () => {
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] > 4 || buf[i+1] > 4 || buf[i+2] > 4) n++;
    return n / (W * H);
  };

  const savedBg = sc.background;
  const savedFog = sc.fog;
  sc.fog = null;
  sc.background = new (sc.background.constructor)(0x000000);
  const vis0 = new Map();
  for (const o of cls.keys()) vis0.set(o, o.visible);

  const setOnly = (pred) => {
    for (const o of cls.keys()) o.visible = pred(cls.get(o));
  };

  const measure = (pred) => {
    setOnly(pred);
    R.render(sc, cam);
    return +count().toFixed(4);
  };

  // 全部可见（作为基准）
  for (const o of cls.keys()) o.visible = vis0.get(o);
  R.render(sc, cam); const allCover = +count().toFixed(4);

  const additive = measure(t => t.has('additive'));
  const transp   = measure(t => t.has('transparent'));
  const points   = measure(t => t.has('points'));
  const sprites  = measure(t => t.has('sprite'));
  // 雾片单独（mist 是 sprite + transparent，但非 additive；日月辉光是 sprite + additive）
  const mistOnly = measure(t => t.has('sprite') && !t.has('additive'));

  for (const o of cls.keys()) o.visible = vis0.get(o);
  sc.background = savedBg; sc.fog = savedFog;
  R.render(sc, cam);

  return JSON.stringify({ W, H, allCover, additive, transp, points, sprites, mistOnly });
})()`));

// ---- 2) 三档参数下的 drawcall / 三角面 / 像素数 ----
const tiers = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer;
  const out = {};
  const once = async () => { await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
    return { calls: R.info.render.calls, tris: R.info.render.triangles, points: R.info.render.points }; };
  for (const t of ['low','mid','high']) {
    g.setQuality(t);
    await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
    const f = await once();
    const dpr = devicePixelRatio, QP = g.QP();
    const base = Math.min(dpr, QP.pr);
    out[t] = Object.assign(f, {
      prBase: QP.pr, base, minScale: QP.minScale,
      bufferAt1: [Math.round(innerWidth*base), Math.round(innerHeight*base)],
      bufferAtFloor: [Math.round(innerWidth*base*QP.minScale), Math.round(innerHeight*base*QP.minScale)],
      physical: [innerWidth*dpr, innerHeight*dpr],
      upscaleAt1: +(innerWidth*dpr/(innerWidth*base)).toFixed(2),
      upscaleAtFloor: +(innerWidth*dpr/(innerWidth*base*QP.minScale)).toFixed(2),
      shadow: QP.shadow, shadowEvery: QP.shadowEvery, pointLights: QP.pointLights,
      rain: QP.rain, mist: QP.mist, aa: QP.aa, fpsCap: QP.fpsCap,
      actualPr: R.getPixelRatio(),
    });
  }
  return JSON.stringify(out);
})()`));

// ---- 3) 自适应：scale 会不会一路钉死在地板 ----
const adapt = JSON.parse(await ev(`(async () => {
  const g = window.__game, Q = g.QUALITY;
  g.setQuality('mid');
  Q.adaptive = true; Q.scale = 1; Q.ms = 16.7; Q.win = 0; Q.good = 0;
  const trace = [];
  const t0 = performance.now();
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 100));
    trace.push({ t: Math.round(performance.now() - t0), scale: +Q.scale.toFixed(3), ms: +Q.ms.toFixed(1), hz: Q.hz, pr: +g.renderer.getPixelRatio().toFixed(3) });
  }
  const uniq = [];
  for (const p of trace) if (!uniq.length || uniq[uniq.length-1].scale !== p.scale) uniq.push(p);
  return JSON.stringify({ hz: Q.hz, final: trace[trace.length-1], transitions: uniq, frames: trace.length });
})()`));

// ---- 4) 纹理明细：哪几张是 4K ----
const tex = JSON.parse(await ev(`(() => {
  const g = window.__game, sc = g.scene, seen = new Map();
  sc.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material)?o.material:[o.material]) : [];
    for (const m of ms) { if (!m) continue;
      for (const k of ['map','emissiveMap','alphaMap','normalMap','roughnessMap','metalnessMap','aoMap']) {
        const t = m[k]; if (!t || !t.image || seen.has(t.uuid)) continue;
        seen.set(t.uuid, { w: t.image.width||0, h: t.image.height||0, mips: t.generateMipmaps, aniso: t.anisotropy, cs: t.colorSpace, name: (t.name||k), owner: m.name || m.type, src: (t.image.src||'').slice(0,48) });
      }
    }
  });
  const arr = [...seen.values()].sort((a,b)=>b.w*b.h-a.w*a.h);
  let tot = 0; for (const t of arr) tot += t.w*t.h*4*1.333;
  return JSON.stringify({ totalMB: +(tot/1048576).toFixed(1), count: arr.length, list: arr.map(t=>({ wh: t.w+'x'+t.h, mb: +(t.w*t.h*4*1.333/1048576).toFixed(1), aniso: t.aniso, cs: t.cs, src: t.src })) });
})()`));

// ---- 5) 程序数与灯光数（改灯会不会重编译）----
const prog = JSON.parse(await ev(`(async () => {
  const g = window.__game, R = g.renderer;
  const snap = () => R.info.programs.length;
  const before = snap();
  const lights = []; g.scene.traverse(o => { if (o.isPointLight) lights.push(o); });
  const visibleBefore = lights.filter(l=>l.visible).length;
  // 少留一盏灯
  const v = lights.map(l=>l.visible);
  let on = 0; lights.forEach(l => { l.visible = on++ < Math.max(1, visibleBefore-1); });
  await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
  R.render(g.scene, g.camera);
  const after = snap();
  lights.forEach((l,i)=> l.visible = v[i]);
  await new Promise(r=>requestAnimationFrame(r)); R.render(g.scene, g.camera);
  return JSON.stringify({ programsBefore: before, programsAfterDrop: after, recompiled: after - before, visiblePointLights: visibleBefore, totalPointLights: lights.length });
})()`));

console.log(JSON.stringify({ file: FILE, overdraw, tiers, adapt, tex, prog }, null, 2));
ws.close();
