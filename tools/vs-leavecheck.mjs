// 单元验证：开局的图会被强制成 campus；退出对局要还原菜单里选的图，并回到菜单
const PORT=9223, sleep=ms=>new Promise(r=>setTimeout(r,ms));
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
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url:`http://127.0.0.1:8765/.perf-real.html?q=low&v=${Date.now()}`},120000);
for(let i=0;i<240;i++){ if(await ev('typeof window.__game==="object" && !!window.__game.player')) break; await sleep(500); }

console.log('step1 设成城市 →', JSON.stringify(await ev(`(() => { const G=window.__game; G.setHomeTheme('city'); return G.getHomeTheme(); })()`)));
await ev(`document.getElementById('vsBtn').click(); true`);
await sleep(400);
// 直接喂 matchStart（绕过握手，只为验证开局/退出这一段）
console.log('step2 开局 →', JSON.stringify(await ev(`(() => { const a=window.__PKVS_APP;
  a.lobby.onVSEvent({type:'matchStart', seed:12345, startAtLocal: Date.now()+1800, mode:'race', countdownMs:1800});
  return { phase:a.phase, home:window.__game.getHomeTheme(), state:window.__game.S.state, prev:a.prevHome, D:Math.round(window.__game.S.D) }; })()`)));
await sleep(1000);
console.log('step3 倒计时中 →', JSON.stringify(await ev(`({ phase:window.__PKVS_APP.phase, D:Math.round(window.__game.S.D), scene:window.__game.Scene.id })`)));
await sleep(1600);
console.log('step4 解冻 →', JSON.stringify(await ev(`({ phase:window.__PKVS_APP.phase, D:Math.round(window.__game.S.D) })`)));
await sleep(1200);
console.log('step5 跑起来了 →', JSON.stringify(await ev(`({ phase:window.__PKVS_APP.phase, D:Math.round(window.__game.S.D) })`)));
// 退出房间
await ev(`window.__PKVS_APP.lobby.onVSEvent({type:'phase', phase:'idle'}); true`);
await sleep(900);
console.log('step6 退出后 →', JSON.stringify(await ev(`(() => { const a=window.__PKVS_APP, G=window.__game;
  return { phase:a.phase, active:a.active, home:G.getHomeTheme(), state:G.S.state, menuHidden:document.getElementById('menu').classList.contains('hidden'),
           hudHidden:document.getElementById('hud').classList.contains('hidden'), scene:G.Scene.id }; })()`)));
console.log('caught', caught.length?caught:'none');
process.exit(0);
