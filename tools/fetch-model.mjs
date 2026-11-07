// 下载 + 校验角色模型： node tools/fetch-model.mjs <url> [保存名]
// 说明：把 Tripo/混元/Rodin 的模型链接直接落到 assets/ 并做 glTF 结构校验
import fs from 'node:fs';
import path from 'node:path';

const [, , url, name = 'character.glb'] = process.argv;
if (!url) { console.log('用法: node tools/fetch-model.mjs <模型URL> [character.glb]'); process.exit(1); }

const ROOT = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(ROOT, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });
const ext = (url.match(/\.(glb|gltf|fbx|obj|zip)(\?|$)/i) || [, 'glb'])[1].toLowerCase();
const dest = path.join(assetsDir, name.endsWith('.' + ext) ? name : name.replace(/\.[^.]+$/, '') + '.' + ext);

console.log('[下载]', url);
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) { console.error('[失败] HTTP', res.status); process.exit(2); }
const buf = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(dest, buf);
console.log('[保存]', dest, (buf.length / 1024 / 1024).toFixed(2), 'MB');

// ---- 校验 ----
if (ext === 'glb') {
    if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') {
        console.error('❌ 不是有效的 GLB（文件头不是 glTF）——可能下到的是网页/报错页');
        process.exit(3);
    }
    const version = buf.readUInt32LE(4);
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
    const bones = (json.skins || []).reduce((n, s) => n + (s.joints || []).length, 0);
    const meshes = (json.meshes || []).length;
    const anims = (json.animations || []).length;
    console.log('✅ GLB 校验通过');
    console.log('   glTF 版本:', version, '| 网格:', meshes, '| 骨骼数:', bones, '| 动画:', anims, '| 材质:', (json.materials || []).length);
    if (!bones) console.log('   ⚠️ 没有骨骼——游戏里只能整体动，建议先绑骨（Mixamo/AccuRIG）');
    if (!anims) console.log('   ℹ️ 没有自带动画——会用游戏的程序动画驱动骨骼（需要骨骼）');
} else {
    console.log('ℹ️ 非 GLB 格式（', ext, '），需要先转成 glb 或 fbx 才能接入');
}
