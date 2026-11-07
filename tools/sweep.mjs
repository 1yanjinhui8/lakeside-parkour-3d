// 整条校园路线按固定间距截图，用来肉眼找「挡路的楼」
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT=9222, PORT_HTTP=8765, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const argv=process.argv.slice(2);
const val=(f,d)=>{const kv=argv.find(a=>a.startsWith(f+'='));return kv?kv.slice(f.length+1):d;};
const THEME=val('--theme','campus'), STEP=+val('--step','50'), OUT=val('--out','screenshots/sweep');
const FILE=val('--file','.perf-real.html');
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x=>x.type==='page')) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(()=>{});
await sleep(300);
const tgt=await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let seq=0; const pend=new Map(); const caught=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown') caught.push((m.params.exceptionDetails.exception?.description||'').slice(0,200));});
const send=(m,p={},tmo=120000)=>new Promise((a,b)=>{const id=++seq;pend.set(id,x=>x.error?b(new Error(JSON.stringify(x.error))):a(x.result));ws.send(JSON.stringify({id,method:m,params:p}));
  setTimeout(()=>{if(pend.has(id)){pend.delete(id);b(new Error('tmo'));}},tmo);});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return {err:r.exceptionDetails.exception?.description}; return r.result?.value;};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=mid&theme=${THEME}&v=${Date.now()}`},150000);
for(let i=0;i<240;i++){ if(await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break; await sleep(300); }
await ev(`(()=>{ const G=window.__game; G.startGame(); G.QUALITY.adaptive=false; window.__noTurnFail=true;
  G.CONFIG.speed.start=0; G.CONFIG.speed.max=0; G.S.state='playing'; G.Scene.phase='run'; G.Scene.segEnd=1e9;
  (window.__wx&&window.__wx.setTime)?window.__wx.setTime(0.36):0; return 1; })()`);
await sleep(600);
const total = await ev('window.__game.CAMPUS.total');
fs.mkdirSync(path.join(ROOT,OUT),{recursive:true});
const arcs=[]; for(let s=0;s<total-STEP*0.5;s+=STEP) arcs.push(Math.round(s));
for (const arc of arcs) {
    await ev(`(()=>{ const G=window.__game, C=G.CAMPUS; C.s=${arc}; C.jIdx=0; C.jLap=0;
      while (C.jIdx<C.junctions.length && C.junctions[C.jIdx].at<=C.s) C.jIdx++;
      C.nextAbs=C.jIdx<C.junctions.length?C.junctions[C.jIdx].at:Infinity;
      C.pendingDir=0; C.pendingAt=-1e9;
      const d=G.campusDir(C.s); C.theta=Math.atan2(d.z,d.x)+Math.PI/2; C.rawTheta=C.theta;
      const p=G.campusPoint(C.s); C.px=p.x; C.pz=p.z;
      const ct=Math.cos(C.theta), st=Math.sin(C.theta);
      C.group.rotation.y=C.theta;
      C.group.position.set(-(p.x*ct+p.z*st),0,-(-p.x*st+p.z*ct));
      C.group.visible=true; return 1; })()`);
    await sleep(120);
    const s=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(ROOT,OUT,`a${String(arc).padStart(4,'0')}.png`), Buffer.from(s.data,'base64'));
}
console.log('shots', arcs.length, 'total', Math.round(total));
console.log('caught:', caught.length?caught:'none');
process.exit(0);
