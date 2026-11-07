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
await send('Page.navigate',{url:`http://127.0.0.1:8765/.perf-real.html?q=low&v=${Date.now()}`},180000);
for(let i=0;i<240;i++){ if(await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(400); }
console.log(JSON.stringify(await ev(`(() => {
  const wx = window.__wx, st = wx._st;
  function sample(id, segs) {
    st.id = id; st.seg = 0; st.lastDist = 0; st.seqIdx = 0;
    st.weather = 'clear'; st.manual = false; st.mistTimer = 1e9; st.mistLeft = 0;
    let rain = 0;
    for (let k = 1; k <= segs; k++) {
      wx.update(0.001, k * 2500 + 1);
      if (st.weather === 'rain') rain++;
    }
    return { id, segs, rain, pct: Math.round(rain / segs * 100) };
  }
  return { lakeside: sample('lakeside', 300), campus: sample('campus', 300), city: sample('city', 300), city2: sample('city', 300) };
})()`), null, 1));
process.exit(0);
