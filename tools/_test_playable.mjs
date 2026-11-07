// 验证 playable.html：打开页面、抓控制台错误、截图
import fs from 'node:fs';
const url = 'http://127.0.0.1:8765/playable.html?v=' + Date.now();
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getPage() {
    for (let i=0;i<40;i++) {
        try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = t.find(x=>x.type==='page'); if(p) return p; } catch {}
        await sleep(300);
    }
    throw new Error('no cdp');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej);});
let seq=0; const pend=new Map(); const logs=[];
ws.addEventListener('message',ev=>{
    const m=JSON.parse(ev.data);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.consoleAPICalled'){
        logs.push(m.params.type+': '+m.params.args.map(a=>a.value||a.description||'').join(' '));
    }
    if(m.method==='Runtime.exceptionThrown'){
        logs.push('EXCEPTION: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));
    }
});
const send=(method,params={})=>new Promise((res,rej)=>{const id=++seq;pend.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id,method,params}));});
const evalJs = e => send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
await send('Page.enable'); await send('Runtime.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url});
// 等 15 秒让 CDN 和大模型加载
for(let i=0;i<60;i++){
    await sleep(500);
    const r = await evalJs('typeof window.__game !== "undefined" && window.__game.chaser && window.__game.chaser.hasModel');
    if(r.result.value) { console.log('READY at', (i*0.5).toFixed(1),'s'); break; }
}
await sleep(2000);
const shot = await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('D:/Claude/parkour-game/screenshots/_playable_test.png', Buffer.from(shot.data,'base64'));
console.log('--- console logs (last 25) ---');
logs.slice(-25).forEach(l=>console.log(l));
ws.close(); process.exit(0);
