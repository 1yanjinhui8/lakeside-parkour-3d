// ============================================================================
//  fanfareShots.mjs —— 在 360° 环绕的不同进度点连拍，确认特色建筑入画
//  用法：node tools/fanfareShots.mjs [--file=.perf-real.html] [--tag=f1]
// ============================================================================
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9222, PORT_HTTP = 8766;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const val = (f, d) => { const kv = argv.find(a => a.startsWith(f + '=')); return kv ? kv.slice(f.length + 1) : d; };
const FILE = val('--file', '.perf-real.html');
const TAG = val('--tag', 'f1');
const VIEW = val('--view', '');
const OUT = path.join(ROOT, 'screenshots');

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pend = new Map(); const caught = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const desc = d.exception?.description || d.text || '';
        if (!/chrome-extension:/.test(desc)) caught.push(desc.slice(0, 300));
    }
});
const send = (m, p = {}, tmo = 60000) => {
    const id = ++seq;
    const pr = new Promise((a, b) => pend.set(id, x => (x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result))));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    return Promise.race([pr, sleep(tmo).then(() => { throw new Error('tmo ' + m); })]);
};
const ev = async (e, tmo = 60000) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, tmo)).result?.value;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
const stamp = Math.round(fs.statSync(path.join(ROOT, FILE)).mtimeMs);
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_HTTP}/${FILE}?autostart&q=high&theme=city&t=0.68&wx=clear&v=${stamp}` }, 60000);
for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.__game === "object" && !!window.__game.player').catch(() => false)) break;
    await sleep(500);
}
await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
// 页面自动跑了 40s，可能已进入转场；探针里强制回到 run，否则传送门不会再生成
await ev(`window.__game.Scene.phase = 'run'; window.__game.Scene.fanfareDone = false; true`);
if (VIEW) await ev(`window.__game.FINISH_VIEW.set('${VIEW}'); true`);
await sleep(700);

// 直接触发过场（不用跑 2966m，省时间）：先摆好传送门与新葡京
await ev(`(()=>{const g=window.__game;
  let n=0; while(g.S.D < 2966 && n++ < 400000){ g.S.transGrace=1e9; g.step(1/60); }
  return Math.round(g.S.D); })()`);
await sleep(300);
console.log('步进后状态:', await ev(`JSON.stringify({
  D: Math.round(window.__game.S.D), state: window.__game.S.state,
  segEnd: Math.round(window.__game.Scene.segEnd), id: window.__game.Scene.id,
  portal: !!window.__game.PortalFX.group, lisboa: !!window.__game.LisboaFX.group,
  done: !!window.__game.Scene.fanfareDone,
  ph: window.__game.finishCam.phase, active: window.__game.FINISH.active
})`));

fs.mkdirSync(OUT, { recursive: true });
const marks = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92];
const files = [];
let mi = 0;
const t0 = Date.now();
while (mi < marks.length && Date.now() - t0 < 90000) {
    const st = JSON.parse(await ev(`JSON.stringify({ p: window.__game.finishCam.progress, ph: window.__game.finishCam.phase })`) || '{}');
    if (st.ph === 'orbit' && st.p >= marks[mi]) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const fp = path.join(OUT, `${TAG}-p${String(Math.round(marks[mi] * 100)).padStart(2, '0')}.png`);
        fs.writeFileSync(fp, Buffer.from(shot.data, 'base64'));
        files.push(path.basename(fp));
        mi++;
        continue;
    }
    if (mi === 0 && Date.now() - t0 < 3000) console.log('轮询:', JSON.stringify(st));
    if (st.ph === 'idle' && mi > 0) break;
    await sleep(250);
}
// 收尾：强制跳过，验证交还
await ev('window.__game.finishCam.skip(); true');
for (let i = 0; i < 30; i++) {
    const st = JSON.parse(await ev(`JSON.stringify({ ph: window.__game.finishCam.phase, s: window.__game.S.state, pp: window.__game.Scene.phase, far: window.__game.camera.far })`) || '{}');
    if (st.ph === 'idle' && st.s !== 'fanfare') {
        console.log('交还完成:', JSON.stringify(st));
        break;
    }
    await sleep(500);
}
console.log('截图:', JSON.stringify(files));
console.log('异常:', JSON.stringify(caught.slice(0, 3)));
ws.close();
