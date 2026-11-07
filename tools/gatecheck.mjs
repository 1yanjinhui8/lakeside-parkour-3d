const PORT=9222, sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x=>x.type==='page')) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(()=>{});
await sleep(300);
const tgt=await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let seq=0; const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={},tmo=180000)=>new Promise((a,b)=>{const id=++seq;pend.set(id,x=>x.error?b(new Error(JSON.stringify(x.error))):a(x.result));ws.send(JSON.stringify({id,method:m,params:p}));
  setTimeout(()=>{if(pend.has(id)){pend.delete(id);b(new Error('tmo'));}},tmo);});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return {err:r.exceptionDetails.exception?.description}; return r.result?.value;};
await send('Page.enable'); await send('Runtime.enable');
// 直接进燕园（调试入口），跑到段尾看传送门
await send('Page.navigate',{url:`http://127.0.0.1:8765/.perf-real.html?q=low&theme=campus&v=${Date.now()}`},180000);
for(let i=0;i<240;i++){ if(await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(400); }
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
await sleep(600);
console.log(JSON.stringify(await ev(`(() => {
  const G = window.__game, C = G.CAMPUS;
  G.Scene.fanfareDone = true;
  let pressed = false, frames = 0;
  // 跑到段尾前 100m（传送门预览区）
  while (G.S.D < G.Scene.segEnd - 95 && frames < 60 * 600) {
    G.S.transGrace = 99; G.Scene.fanfareDone = true;
    const j = C.junctions[C.jIdx], dist = C.nextAbs - C.s;
    if (j && !pressed && dist > 0 && dist <= 30) { C.pendingDir = j.dir === 'L' ? -1 : 1; C.pendingAt = C.s; pressed = true; }
    const before = C.jIdx;
    G.step(1 / 60); frames++;
    if (C.jIdx !== before) pressed = false;
  }
  // 再跑几帧让 portal 生成
  for (let i = 0; i < 30; i++) { G.S.transGrace = 99; G.step(1 / 60); }
  return {
    scene: G.Scene.id, next: G.Scene.next, D: Math.round(G.S.D), segEnd: Math.round(G.Scene.segEnd),
    gateReady: G.GATE_FX ? !!(G.GATE_FX.ready) : null,
    portalKind: G.PortalFX ? G.PortalFX.kind : null,
    portalNext: G.PortalFX ? G.PortalFX.next : null,
    hasPortal: !!(G.PortalFX && G.PortalFX.group),
  };
})()`), null, 1));
process.exit(0);
