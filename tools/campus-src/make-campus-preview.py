# -*- coding: utf-8 -*-
"""给校园底板生成一个「双击就能看」的三维预览页（GLB 内联成 data URI）。

为什么要内联：`file://` 下浏览器不允许 fetch 本地模型，外链 GLB 会直接失败。
内联后整个 html 自包含，双击即可；只有 three.js 还走 CDN（需联网）。

用法：python tools/campus-src/make-campus-preview.py <输出html> [标题]
"""
import base64
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GLB = os.path.join(ROOT, 'assets', 'campus', 'beida-campus.glb')

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'out', 'campus_preview.html')
TITLE = sys.argv[2] if len(sys.argv) > 2 else '北京大学 · 燕园'

b64 = base64.b64encode(open(GLB, 'rb').read()).decode('ascii')

HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ 三维预览</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #9fc3e0; }
  canvas { display: block; }
  #hud { position: fixed; left: 18px; top: 14px; color: #fff; pointer-events: none;
         font: 500 15px/1.7 "Microsoft YaHei", system-ui, sans-serif;
         text-shadow: 0 1px 4px rgba(0,0,0,.55); }
  #hud b { font-size: 20px; letter-spacing: .5px; }
  #hud span { opacity: .82; font-size: 13px; }
  #tip { position: fixed; left: 18px; bottom: 14px; color: #fff; opacity: .72;
         font: 13px/1.6 "Microsoft YaHei", system-ui; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
  #err { position: fixed; inset: 0; display: none; place-items: center; color: #fff;
         background: rgba(20,26,34,.92); font: 15px/1.9 "Microsoft YaHei", system-ui; text-align: center; }
</style>
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
} }
</script>
</head>
<body>
<div id="hud"><b>__TITLE__</b><br><span>未名湖片区 · OSM 实测 1:1 · 3011m 环线</span></div>
<div id="tip">左键拖动旋转 · 右键平移 · 滚轮缩放</div>
<div id="err">three.js 没能从 CDN 加载。<br>这个预览页需要联网（模型本身已内联）。</div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e0);
scene.fog = new THREE.Fog(0xcfe0ee, 900, 2600);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 6000);
camera.position.set(180, 560, 640);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-520, 0, -60);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 40;
controls.maxDistance = 3000;

scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x5d6b52, 1.45));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.35);
sun.position.set(420, 700, 380);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd4e8, 0.35);
fill.position.set(-500, 260, -420);
scene.add(fill);

const DATA = 'data:model/gltf-binary;base64,__B64__';

new GLTFLoader().load(DATA, gltf => {
  const root = gltf.scene;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let tris = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (o.material && o.material.map) {
      o.material.map.wrapS = o.material.map.wrapT = THREE.RepeatWrapping;
      o.material.map.anisotropy = Math.min(8, maxAniso);
      o.material.map.needsUpdate = true;
    }
    if (o.geometry && o.geometry.index) tris += o.geometry.index.count / 3;
  });
  scene.add(root);
  window.__tris = Math.round(tris);
  window.__ready = true;
}, undefined, e => {
  document.getElementById('err').style.display = 'grid';
  console.error(e);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let t0 = performance.now();
function loop() {
  const t = (performance.now() - t0) / 1000;
  // 开局缓慢自转，用户一动就停（不跟 OrbitControls 抢）
  if (window.__autoRotate !== false) {
    const r = 560, a = -0.75 + Math.sin(t * 0.08) * 0.26;
    camera.position.set(-520 + Math.cos(a) * r, 250 + Math.sin(t * 0.05) * 18, -60 + Math.sin(a) * r);
    camera.lookAt(controls.target);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
renderer.domElement.addEventListener('pointerdown', () => { window.__autoRotate = false; }, { once: true });
renderer.domElement.addEventListener('wheel', () => { window.__autoRotate = false; }, { once: true });
</script>
</body>
</html>
"""

html = HTML.replace('__TITLE__', TITLE).replace('__B64__', b64)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
io.open(OUT, 'w', encoding='utf-8').write(html)
print('写出 %s（%.1f MB）' % (OUT, os.path.getsize(OUT) / 1048576))
