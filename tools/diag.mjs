// 诊断：注入早期 error 钩子 → 导航 → 读 window.__errs / 渲染帧数
import fs from 'node:fs';
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(page) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        let seq = 0; const pending = new Map();
        const st = { ws };
        ws.addEventListener('open', () => {
            st.raw = (method, params = {}) => new Promise((res, rej) => {
                const id = ++seq;
                pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
                ws.send(JSON.stringify({ id, method, params }));
            });
            resolve(st);
        });
        ws.addEventListener('error', reject);
        ws.addEventListener('message', ev => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        });
    });
}
const pages = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t => t.type === 'page');
const first = (await pages())[0];
let c = await connect(first);
await c.raw('Page.enable');
await c.raw('Runtime.enable');
await c.raw('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @'+(e.filename||'?')+':'+e.lineno+':'+e.colno)});var _ce=console.error;console.error=function(){window.__errs.push('console.error: '+[].slice.call(arguments).join(' '));_ce.apply(console,arguments)};1`,
});
await c.raw('Page.navigate', { url: 'http://127.0.0.1:8765/playable.html?autostart&v=' + Date.now() });
await sleep(12000);
c.ws.close();

let c2 = null;
for (let i = 0; i < 10; i++) {
    const p = (await pages()).find(p => p.url.includes('8765'));
    if (p) { try { c2 = await connect(p); break; } catch (e) { await sleep(1000); } }
}
if (!c2) { console.log('连不上新页面'); process.exit(2); }
const r = await c2.raw('Runtime.evaluate', {
    expression: `JSON.stringify({
        errs: (window.__errs||[]).slice(0,8),
        frame: window.__game ? window.__game.renderer.info.render.frame : null,
        merge: window.__game ? window.__game.mergeState : null,
        state: window.__game ? window.__game.S.state : null,
    })`, returnByValue: true,
});
console.log(r.result.value);
// 再等 2 秒看帧数是否推进（判断主循环是否活着）
await sleep(2000);
const r2 = await c2.raw('Runtime.evaluate', { expression: 'window.__game ? window.__game.renderer.info.render.frame : -1', returnByValue: true });
console.log('frame after 2s:', r2.result.value);
process.exit(0);
