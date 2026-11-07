// 单文件版「离线」冒烟：把 jsdelivr 上的 three / GLTFLoader / BufferGeometryUtils
// 用 CDP Fetch 拦下来、换成 lib/ 里的本地副本，验证 playable.html 在完全没有外网时
// 也能起来（这个环境经常连不上 jsdelivr，正常测试会一直卡在 import 上）。
//
//   node tools/singlefile-offline.mjs playable.html
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = +(process.env.CDP_PORT || 9222);
const HTTP = 8765;
const FILE = process.argv[2] || 'playable.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// lib/GLTFLoader.js 里写的是相对导入 './three.module.js'、'./BufferGeometryUtils.js'，
// 但它的 URL 在 CDN 的 loaders/ 目录下 —— 这两个相对请求也要一起拦下来，否则
// GLTFLoader 能取到、它的依赖 404，动态 import 整体失败（报错只会指 GLTFLoader）。
const MAP = [
    [/(build|loaders)\/three\.module\.js$/, 'lib/three.module.js'],
    [/loaders\/GLTFLoader\.js$/, 'lib/GLTFLoader.js'],
    [/(utils|loaders)\/BufferGeometryUtils\.js$/, 'lib/BufferGeometryUtils.js'],
];

for (const t of (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(x => x.type === 'page')) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => { });
}
await sleep(300);
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pend = new Map(); const caught = []; let served = 0; const servedUrls = [];

const send = (m, p = {}, tmo = 900000) => new Promise((a, b) => {
    const id = ++seq; pend.set(id, x => x.error ? b(new Error(JSON.stringify(x.error))) : a(x.result));
    ws.send(JSON.stringify({ id, method: m, params: p }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); b(new Error('tmo ' + m)); } }, tmo);
});
const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result?.value;
};

ws.addEventListener('message', async e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') caught.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled') {
        const txt = (m.params.args.map(a => a.value || a.description).join(' ') || '');
        if (m.params.type === 'error') caught.push('ERR ' + txt.slice(0, 200));
        if (/landmark|gate|lisboa/i.test(txt)) caught.push(m.params.type + ': ' + txt.slice(0, 240));
    }
    if (m.method === 'Fetch.requestPaused') {
        const { requestId, request } = m.params;
        const hit = MAP.find(([re]) => re.test(request.url));
        if (!hit) { send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => { }); return; }
        const body = fs.readFileSync(path.join(ROOT, hit[1])).toString('base64');
        served++; servedUrls.push(request.url.split('/').slice(-2).join('/'));
        send('Fetch.fulfillRequest', {
            requestId, responseCode: 200,
            responseHeaders: [
                { name: 'Content-Type', value: 'text/javascript' },
                // 模块脚本走 CORS：不带头会被判成「Failed to fetch dynamically imported module」
                { name: 'Access-Control-Allow-Origin', value: '*' },
            ],
            body,
        }).catch(() => { });
    }
});

await send('Page.enable'); await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*cdn.jsdelivr.net*' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });

const t0 = Date.now();
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/${FILE}?q=low&theme=city` }, 900000);
let ok = false;
for (let i = 0; i < 150; i++) {
    ok = await ev('typeof window.__game==="object" && !!window.__game.player');
    if (ok) break;
    await sleep(2000);
}
// 先量一下 data URI 本身能不能取：单文件版的地标全靠它
let probe = null;
if (ok) {
    probe = await ev(`(async () => {
        const url = window.__game.LANDMARK_MODELS.pearl;
        const t0 = performance.now();
        try {
            const r = await fetch(url);
            const b = await r.arrayBuffer();
            return { bytes: b.byteLength, ms: Math.round(performance.now() - t0), magic: new Uint8Array(b.slice(0, 4)).join(',') };
        } catch (e) { return { err: String(e).slice(0, 160) }; }
    })()`);
}
// 地标是异步加载的：等它注册完（最多 180s），否则会误报「没加载」
let lm = '';
for (let i = 0; i < 180 && ok; i++) {
    lm = await ev('window.__game.LMGLB.list().map(x => x.kind + ":" + x.h).join(",")');
    if (lm) break;
    await sleep(1000);
}
const out = {
    file: FILE, loaded: ok, sec: Math.round((Date.now() - t0) / 1000),
    servedLocal: served,
    dataUri: probe,
    servedUrls,
    landmarks: lm || null,
    caught: caught.slice(0, 4),
};
console.log(JSON.stringify(out, null, 1));
if (ok) {
    await ev('window.__game.startGame(); window.__game.QUALITY.adaptive=false; true');
    await sleep(2500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('screenshots/singlefile-landmarks.png', Buffer.from(s.data, 'base64'));
    console.log('shot ok');
}
process.exit(0);
