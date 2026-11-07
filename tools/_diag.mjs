import fs from 'node:fs';
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = tabs.find(t => t.type === 'page');
console.log('tabs:', tabs.map(t => [t.type, t.url]));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    if (m.method === 'Network.loadingFailed') logs.push('NETFAIL: ' + m.params.errorText + ' ' + (m.params.type || ''));
    if (m.method === 'Network.responseReceived') { const r = m.params.response; if (r.status >= 400) logs.push('HTTP' + r.status + ': ' + r.url); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8765/index.html?v=' + Date.now() });
await sleep(8000);
const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
        ready: document.readyState,
        hasGame: typeof window.__game,
        hasTHREE: typeof window.THREE,
        scripts: [...document.scripts].map(s => s.src || s.type),
        loadingShown: !document.getElementById('loading').classList.contains('hidden'),
        loadingText: document.getElementById('loading').innerText.slice(0, 80),
    })`, returnByValue: true });
console.log('state:', r.result.value);
console.log('logs:', logs.slice(0, 20));
ws.close(); process.exit(0);
