const tgt = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find(x => x.type === 'page');
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => { const id = ++seq; const pr = new Promise(a => pend.set(id, a)); ws.send(JSON.stringify({ id, method: m, params: p })); return pr; };
const expr = `JSON.stringify({
  url: location.href,
  dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight,
  tier: window.__game.QUALITY.tier, scale: window.__game.QUALITY.scale,
  ms: +window.__game.QUALITY.ms.toFixed(2), hz: window.__game.QUALITY.hz,
  adaptive: window.__game.QUALITY.adaptive,
  pr: window.__game.renderer.getPixelRatio(),
  buf: [window.__game.renderer.domElement.width, window.__game.renderer.domElement.height],
  ls: (()=>{try{return localStorage.getItem('huyifan.quality')}catch(e){return 'ERR'}})(),
  ua: navigator.userAgent.slice(0,60),
  cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory
})`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(JSON.stringify(JSON.parse(r.result.result.value), null, 2));
ws.close();
