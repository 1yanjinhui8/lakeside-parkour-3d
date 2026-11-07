// 把游戏打包成单文件 HTML：GLB 模型 base64 内联，Three.js 走 CDN
// 输出 playable.html —— 发给别人双击就能玩
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/Claude/parkour-game';
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 1) 把 GLB 读成 base64 data URI
function glbToDataUri(fp) {
    const buf = fs.readFileSync(fp);
    return 'data:model/gltf-binary;base64,' + buf.toString('base64');
}
console.log('reading GLBs...');
const characterUri = glbToDataUri(path.join(ROOT, 'assets/character.glb'));
const guardUri = glbToDataUri(path.join(ROOT, 'assets/guard2_rigged.glb'));
console.log('character URI length:', characterUri.length, 'guard URI length:', guardUri.length);

// 1.5) 内联外部模块：playable 是单文件，file:// 下相对路径的 ES module 会被 CORS 拦，
//      所以把 js/atmo.js、js/oldtown.js 的源码直接并进主 module script（去掉 export 关键字）
function inlineModule(fp) {
    return fs.readFileSync(path.join(ROOT, fp), 'utf8').replace(/^export\s+/gm, '');
}
const atmoSrc = inlineModule('js/atmo.js');
const oldTownSrc = inlineModule('js/oldtown.js');
{
    const oldImports = `const { createAtmo } = await import('./js/atmo.js?v=6');
const { createOldTown } = await import('./js/oldtown.js?v=6');`;
    if (html.includes(oldImports)) {
        html = html.replace(oldImports, () => '// ---- 内联模块：js/atmo.js（昼夜/天气） ----\n' + atmoSrc +
            '\n// ---- 内联模块：js/oldtown.js（中式旧城 + 赛博街道） ----\n' + oldTownSrc);
    } else {
        console.warn('!! inline module block not matched');
    }
}

// 2) 在 <head> 最前面加 importmap（three + addons）
const importmap = `<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
`;
html = html.replace('<meta name="viewport"', importmap + '<meta name="viewport"');

// 3) 替换 loadThree()：直接从 CDN import
const oldLoad = `async function loadThree() {
    const sources = [
        './lib/three.module.js',
        'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
        'https://registry.npmmirror.com/three/0.160.0/files/build/three.module.js',
        'https://unpkg.com/three@0.160.0/build/three.module.js',
    ];
    for (const src of sources) {
        try { return await import(src); } catch (e) { console.warn('Three.js 加载失败:', src); }
    }
    throw new Error('无法加载 Three.js');
}`;
const newLoad = `async function loadThree() {
    return await import('three');
}`;
if (html.includes(oldLoad)) html = html.replace(oldLoad, newLoad);
else console.warn('!! loadThree block not matched');

// 4) GLTFLoader / BufferGeometryUtils：本地路径改成 addons CDN
//    （playable 的 three 走 CDN，工具库必须用同一实例，否则 mergeGeometries 的
//     类型检查会拿到另一个 THREE 的几何体对象而失败）
html = html.replaceAll("'./lib/GLTFLoader.js'", "'three/addons/loaders/GLTFLoader.js'");
html = html.replaceAll("'./lib/BufferGeometryUtils.js'", "'three/addons/utils/BufferGeometryUtils.js'");

// 5) GLB 路径替换成 data URI
html = html.replace("'assets/character.glb'", JSON.stringify(characterUri));
html = html.replace("'assets/Michelle.glb'", "''");  // 兜底路径清空，加载失败就用代码角色
html = html.replace("'assets/character_new.glb'", JSON.stringify(characterUri));
html = html.replace("'assets/guard2_rigged.glb'", JSON.stringify(guardUri));

// 6) 改 loading 提示
html = html.replace('请联网后刷新，或双击 start-game.bat 用本地服务器打开。', '需联网加载 3D 引擎（CDN）。');

const out = path.join(ROOT, 'playable.html');
fs.writeFileSync(out, html, 'utf8');
const sz = fs.statSync(out).size;
console.log('written', out, (sz/1024/1024).toFixed(1), 'MB');
