// 语法检查：把 index.html 里的 module 脚本抽出来，用 node --check 校验
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 module 脚本'); process.exit(2); }
const out = path.join(__dirname, '..', '.tmp-check.mjs');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, m[1]);
console.log('extracted', m[1].length, 'chars ->', out);
