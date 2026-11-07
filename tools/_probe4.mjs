// ============================================================================
//  _probe4.mjs —— 雾/雨各自的屏幕覆盖率（只读）
//  用法: node tools/_probe4.mjs [--wx=mist|rain|clear]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9333, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE = process.argv.find(a => a.startsWith('--file='))?.slice(7) || '.perf-real.html';
const WX = process.argv.find(a => a.startsWith('--wx='))?.slice(5) || 'mist';
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

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', { userAgent: UA_MOBILE, platform: 'Android' });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=mid&theme=city&t=0.68&wx=${WX}&v=${stamp}` }, 120000);
for (let i = 0; i < 300; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(300);
}
console.error('ready');
await ev(`(()=>{const g=window.__game;g.startGame();g.QUALITY.adaptive=false;g.S.paused=false;return 1})()`);
// 让天气插值收敛
await sleep(4000);

const out = JSON.parse(await ev(`(() => {
  const g = window.__game, R = g.renderer, sc = g.scene, cam = g.camera;
  const W = R.domElement.width, H = R.domElement.height;
  const gl = R.getContext();
  const buf = new Uint8Array(W*H*4);
  const cover = () => { gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let n=0, sum=0; for (let i=0;i<buf.length;i+=4) { const v=Math.max(buf[i],buf[i+1],buf[i+2]); if (v>4) n++; sum+=v; }
    return { cover:+(n/(W*H)).toFixed(4), meanLum:+(sum/(W*H)/255).toFixed(4) }; };

  // 收集所有可渲染对象
  const all = []; sc.traverse(o => { if (o.isMesh||o.isSprite||o.isPoints) all.push(o); });
  const vis0 = all.map(o => o.visible);

  // 找雾组 / 雨点
  const mist = sc.children.find(o => o.isGroup && o.children.length >= 5 && o.children[0].isSprite);
  const rain = sc.children.find(o => o.isPoints && o.geometry.attributes.position.count > 500);
  const wxState = window.__wx ? window.__wx.state() : null;

  const isolate = (objs) => {
    all.forEach(o => o.visible = false);
    objs.forEach(o => o.visible = true);
    const bg = sc.background, fg = sc.fog;
    sc.background = new bg.constructor(0x000000); sc.fog = null;
    R.render(sc, cam);
    const r = cover();
    sc.background = bg; sc.fog = fg;
    all.forEach((o,i) => o.visible = vis0[i]);
    return r;
  };

  const res = { wx: wxState ? { weather: wxState.weather, rain: +wxState.rain.toFixed(2), mist: +wxState.mist.toFixed(2), fog: wxState.fog.map(v=>+v.toFixed(1)) } : null,
                buf: [W,H] };

  if (mist) {
    res.mistSprites = mist.children.length;
    res.mistVisible = mist.children.filter(c=>c.visible).length;
    res.mistScale = mist.children.map(c => [ +c.scale.x.toFixed(1), +c.scale.y.toFixed(1) ]);
    res.mistCover = isolate([mist]);
    // 逐片覆盖（每片单独）
    res.mistPerSprite = [];
    const vs = mist.children.map(c=>c.visible);
    mist.children.forEach(c => c.visible = false);
    for (const c of mist.children) {
      const keep = c.visible; c.visible = true;
      res.mistPerSprite.push(isolate([mist]).cover);
      c.visible = keep;
    }
    mist.children.forEach((c,i)=> c.visible = vs[i]);
  }
  if (rain) {
    res.rainPoints = rain.geometry.attributes.position.count;
    res.rainDrawRange = rain.geometry.drawRange ? rain.geometry.drawRange.count : null;
    res.rainSize = rain.material.size;
    res.rainSizeAttenuation = rain.material.sizeAttenuation;
    res.rainCover = isolate([rain]);
  }
  return JSON.stringify(res);
})()`));

console.log(JSON.stringify({ file: FILE, wx: WX, out }, null, 2));
ws.close();
