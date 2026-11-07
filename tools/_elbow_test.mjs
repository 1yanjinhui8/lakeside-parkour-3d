// 对比不同肘角度：复现问题 vs 试修
import fs from 'node:fs';
const urlBase = 'http://127.0.0.1:8765/';
const outDir = 'D:\\Claude\\parkour-game\\screenshots\\_elbow';
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getPage() {
    for (let i=0;i<60;i++) {
        try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = t.find(x=>x.type==='page'); if(p) return p; } catch {}
        await sleep(300);
    }
    throw new Error('no cdp');
}
const page = await getPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej);});
let seq=0; const pend=new Map();
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(method,params={})=>new Promise((res,rej)=>{const id=++seq;pend.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id,method,params}));});
const evalJs = e => send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:700,height:700,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:urlBase+'view-guard2.html?v='+Date.now()});
for(let i=0;i<80;i++){const r=await evalJs('!!window.__ready'); if(r.result.value) break; await sleep(250);}
fs.mkdirSync(outDir,{recursive:true});

// 相机拉近：侧面特写肩臂
const shoot = async (name, poses) => {
    await evalJs(`__view('left', ${JSON.stringify(poses||[])})`);
    // 再把相机拉近到肩膀
    await evalJs(`(() => {
        const c = window.__cam, m = window.__model;
        const box = new window.__THREE.Box3().setFromObject(m);
        const center = box.getCenter(new window.__THREE.Vector3());
        c.position.set(center.x + 1.6, center.y + 0.1, center.z + 0.4);
        c.lookAt(center.x, center.y - 0.05, center.z);
        window.__render();
    })()`);
    const shot = await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(shot.data,'base64'));
    console.log('saved', name);
};

// 1) 现状（复现）：肩摆 + 肘屈 90°
await shoot('01_now_elbow90', [['LeftArm',0.66,0,0.15],['LeftForeArm',-1.57,0,0],['RightArm',-0.66,0,-0.15],['RightForeArm',-1.57,0,0]]);
// 2) 肘伸直：肩摆 + 肘 0
await shoot('02_elbow0', [['LeftArm',0.66,0,0.15],['LeftForeArm',0,0,0],['RightArm',-0.66,0,-0.15],['RightForeArm',0,0,0]]);
// 3) 肘微屈 -0.3
await shoot('03_elbow_small', [['LeftArm',0.66,0,0.15],['LeftForeArm',-0.3,0,0],['RightArm',-0.66,0,-0.15],['RightForeArm',-0.3,0,0]]);
// 4) rest（不摆）：看鳍自然下垂样
await shoot('04_rest', []);
ws.close(); process.exit(0);
