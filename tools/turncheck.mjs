// 手动转向 / 路口清场 / 复活回退 三项验证
const PORT=9222, PORT_HTTP=8765, sleep=ms=>new Promise(r=>setTimeout(r,ms));
for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x=>x.type==='page')) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(()=>{});
await sleep(300);
const tgt=await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
let seq=0; const pend=new Map(); const caught=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
  if(m.method==='Runtime.exceptionThrown') caught.push((m.params.exceptionDetails.exception?.description||'').slice(0,200));});
const send=(m,p={},tmo=180000)=>new Promise((a,b)=>{const id=++seq;pend.set(id,x=>x.error?b(new Error(JSON.stringify(x.error))):a(x.result));ws.send(JSON.stringify({id,method:m,params:p}));
  setTimeout(()=>{if(pend.has(id)){pend.delete(id);b(new Error('tmo '+m));}},tmo);});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) return {err:r.exceptionDetails.exception?.description}; return r.result?.value;};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT_HTTP}/.perf-real.html?autostart&q=low&theme=campus&v=${Date.now()}`},150000);
for(let i=0;i<240;i++){ if(await ev('typeof window.__game==="object" && !!window.__game.CAMPUS?.ready')) break; await sleep(300); }

// 公共准备：把游戏摆到 campus 起点，段尾推远
const setup = `(() => {
  const G = window.__game, C = G.CAMPUS;
  G.startGame(); G.QUALITY.adaptive=false;
  G.Scene.phase='run'; G.Scene.segEnd=1e9; G.Scene.next='lakeside'; G.S.state='playing';
  C.s=1400; C.jIdx=0; C.jLap=0;
  while (C.jIdx<C.junctions.length && C.junctions[C.jIdx].at<=C.s) C.jIdx++;
  C.nextAbs=C.jIdx<C.junctions.length?C.junctions[C.jIdx].at:Infinity;
  C.pendingDir=0; C.pendingAt=-1e9; C.theta=C.rawTheta;
  return {s:C.s, next:C.nextAbs};
})()`;

// A. 不按方向
const A = await ev(`(() => {
  ${setup};
  const G=window.__game, C=G.CAMPUS;
  let th25=null, th0=null;
  for (let i=0;i<3000 && G.S.state==='playing';i++) {
    clearObs();
    if (th25===null && C.nextAbs-C.s<=25) th25=C.theta;
    if (th0===null && C.nextAbs-C.s<=1) th0=C.theta;
    G.step(1/60);
  }
  return { dead:G.S.state, cause:G.S.lastDeathCause, at:+C.s.toFixed(0),
           th25:th25===null?null:+th25.toFixed(3), th0:th0===null?null:+th0.toFixed(3),
           theta:+C.theta.toFixed(3), diedAt:S_died(G) };
  function S_died(g){ return g.S.diedTurnAt==null?null:+g.S.diedTurnAt.toFixed(0); }
  function clearObs(){ for(let i=G.obstacles.length-1;i>=0;i--){const o=G.obstacles[i]; if(o.mesh&&o.mesh.parent)o.mesh.parent.remove(o.mesh); G.obstacles.splice(i,1);} }
})()`);
console.log('A 不按方向:', JSON.stringify(A));

// B. 按对方向
const B = await ev(`(() => {
  ${setup};
  const G=window.__game, C=G.CAMPUS;
  let pressed=false, thBefore=null, thAfter=null;
  for (let i=0;i<3000 && G.S.state==='playing';i++) {
    clearObs();
    const j=C.junctions[C.jIdx], d=j?C.nextAbs-C.s:1e9;
    if (!pressed && d>0 && d<=40) { C.pendingDir=j.dir==='L'?-1:1; C.pendingAt=C.s; pressed=true; thBefore=C.theta; }
    G.step(1/60);
    if (pressed && thAfter===null && C.s > 1556) thAfter=C.theta;
    if (C.s > 1580) break;
  }
  function clearObs(){ for(let i=G.obstacles.length-1;i>=0;i--){const o=G.obstacles[i]; if(o.mesh&&o.mesh.parent)o.mesh.parent.remove(o.mesh); G.obstacles.splice(i,1);} }
  return { state:G.S.state, s:+C.s.toFixed(0), pressed,
           turned: thBefore!==null && thAfter!==null && Math.abs(thAfter-thBefore)>0.5,
           thBefore:thBefore===null?null:+thBefore.toFixed(2), thAfter:thAfter===null?null:+thAfter.toFixed(2) };
})()`);
console.log('B 按对方向:', JSON.stringify(B));

// C. 带复活币，不按方向
const Cc = await ev(`(() => {
  ${setup};
  const G=window.__game, C=G.CAMPUS;
  G.S.revives = 1;
  let sAtDeath=null, sAfterRevive=null;
  for (let i=0;i<3000 && G.S.state==='playing';i++) {
    for(let k=G.obstacles.length-1;k>=0;k--){const o=G.obstacles[k]; if(o.mesh&&o.mesh.parent)o.mesh.parent.remove(o.mesh); G.obstacles.splice(k,1);}
    G.step(1/60);
    if (sAfterRevive===null && G.S.reviveUsed>0) sAfterRevive=C.s;
    if (G.S.state!=='playing' && sAtDeath===null) sAtDeath=C.s;
    if (sAfterRevive!==null && C.s>1600) break;
  }
  return { state:G.S.state, revives:G.S.revives, sAtDeath:sAtDeath===null?null:+sAtDeath.toFixed(0),
           sAfterRevive:sAfterRevive===null?null:+sAfterRevive.toFixed(0),
           sAfter:+C.s.toFixed(0), next:+C.nextAbs.toFixed(0), msg:document.getElementById('msg').textContent,
           obstacles:G.obstacles.length, diedTurnAt:G.S.diedTurnAt };
})()`);
console.log('C 复活回退:', JSON.stringify(Cc));

// D. 路口 45m 内是否还有障碍
const D = await ev(`(() => {
  ${setup};
  const G=window.__game, C=G.CAMPUS;
  G.S.transGrace = 999; G.S.revives = 0;
  let worst = 1e9, count = 0, sample = null;
  for (let i=0;i<60*90;i++) {          // 跑约 90 秒游戏时间
    G.S.transGrace = 999;               // 免撞，只为观察生成
    G.step(1/60);
    for (const o of G.obstacles) {
      const arc = C.s - o.z;
      const gap = G.campusJunctionGap(arc);
      if (gap !== null && gap < worst) { worst = gap; sample = { t:o.type, at:+arc.toFixed(0), gap:+gap.toFixed(1) }; }
      if (gap !== null && gap < 45) count++;
    }
  }
  return { s:+C.s.toFixed(0), worst:worst===1e9?null:+worst.toFixed(1), violations:count, sample };
})()`);
console.log('D 路口净空:', JSON.stringify(D));


// E. 第二圈复活回退：不能瞬移回第一圈
const E = await ev(`(() => {
  ${setup};
  const G=window.__game, C=G.CAMPUS;
  C.s = 4452;                         // 第二圈（3011 + 1441）
  const ok = G.campusRewindTo(4452);
  return { ok, s:+C.s.toFixed(0), next:+C.nextAbs.toFixed(0), jLap:C.jLap, jIdx:C.jIdx };
})()`);
console.log('E 第二圈回退:', JSON.stringify(E));

console.log('caught:', caught.length?caught:'none');
process.exit(0);
