# -*- coding: utf-8 -*-
"""
tools/build-pages.py —— 从根目录的单文件成品生成「Pages / 手机版」优化版。

背景：playable.html 把 14 个模型/音频以 base64 内联在主 module 里，
JS 源码高达 36MB。手机 CPU 解析这么大的 module 很慢，而且 34MB 字符串
会常驻 JS 堆。GitHub Pages 走 HTTP，本来就没必要内联。

做法（**游戏逻辑一行都不改**）：
  1. 把主 module 里的 data:/gz: base64 资源解码成独立二进制文件，
     放进 docs/game-assets/。原本 gz: 的资源【保留 gzip 压缩态】存成
     .bin —— 否则解压成裸 GLB 会让总传输从 25MB 涨到 36MB，
     GitHub Pages 对 .glb 不会再压缩，反而更慢。
  2. 代码里对应的字符串换成相对 URL。resolvePlate() 增加一个分支处理
     外部 .bin（fetch + 原生流式解压），其余 URL 原样交给 GLTFLoader。
  3. importmap（three.js 1.9MB）保持内联，避免改动模块解析路径。
  4. 加一个轻量的加载提示层，游戏 loop() 启动后移除。

根目录 playable.html / playable-beta.html 完全不动，仍是「双击即玩」的
单文件成品；只有 docs/playable.html（Pages 在线版）是优化版。

用法：python tools/build-pages.py
仅依赖 Python 3 标准库。
"""
import base64
import gzip
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "playable.html"
DOCS = ROOT / "docs"
OUT = DOCS / "playable.html"
ASSET_DIR = DOCS / "game-assets"

ASSET_RE = re.compile(r"((?:data|gz):[^\"']{0,120}?;base64,)([A-Za-z0-9+/=]+)")
SCRIPT_RE = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.S | re.I)

SPLASH = """
<div id="__boot" style="position:fixed;inset:0;z-index:99999;background:#0b1020;
display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;
color:#e8eefc;font:16px/1.7 'PingFang SC','Microsoft YaHei',system-ui,sans-serif">
  <div style="font-size:26px;font-weight:800;letter-spacing:.04em;
  background:linear-gradient(100deg,#4fe3d0,#5b8cff);-webkit-background-clip:text;
  background-clip:text;color:transparent">湖畔跑酷 3D</div>
  <div style="width:38px;height:38px;border:3px solid rgba(91,140,255,.25);
  border-top-color:#4fe3d0;border-radius:50%;animation:__spin .9s linear infinite"></div>
  <div id="__bootmsg" style="font-size:13px;color:#93a3c4">正在加载模型资源，首次约需 25 MB…</div>
  <style>@keyframes __spin{to{transform:rotate(360deg)}}</style>
</div>
"""

REMOVE_SPLASH = """
// ── Pages 优化版：资源加载完毕、主循环启动后移除加载提示 ──
try { var __bootEl = document.getElementById('__boot'); if (__bootEl) __bootEl.remove(); } catch (e) {}
"""

OLD_PLATE = r"""async function resolvePlate(url) {
    if (!url || url.indexOf('gz:') !== 0) return url;
    const b64 = url.slice(url.indexOf('base64,') + 7);
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const buf = await new Response(
        new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
}"""

NEW_PLATE = r"""async function resolvePlate(url) {
    if (!url) return url;
    // 兼容原始内联 gz: 资源（根目录单文件成品仍在用）
    if (url.indexOf('gz:') === 0) {
        const b64 = url.slice(url.indexOf('base64,') + 7);
        const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
        const buf = await new Response(
            new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer();
        return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    }
    // Pages 优化版：外部 .bin（gzip 压缩的 GLB）走浏览器原生流式解压
    if (/\.bin(\?|$)/.test(url)) {
        const res = await fetch(url);
        if (!res.ok) throw new Error('[资源] 下载失败 ' + url);
        const buf = await new Response(
            res.body.pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer();
        return URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    }
    return url;
}"""


def main():
    if not SRC.is_file():
        raise SystemExit(f"找不到成品文件：{SRC}")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for old in ASSET_DIR.glob("asset-*"):
        old.unlink()

    html = SRC.read_text(encoding="utf-8", errors="replace")
    scripts = list(SCRIPT_RE.finditer(html))
    if len(scripts) < 7:
        raise SystemExit(f"script 块数量异常（{len(scripts)}），已中止")
    main_block = scripts[6]
    body = main_block.group(2)

    manifest = []
    counter = [0]

    def repl(m):
        counter[0] += 1
        prefix, b64 = m.group(1), m.group(2)
        raw = base64.b64decode(b64)
        was_gz = prefix.startswith("gz:")
        if "audio" in prefix:
            ext = "mp3"
        elif was_gz:
            # 保留 gzip 压缩态，别解压！用 .bin 后缀避免 CDN 看到 .gz
            # 自动加 Content-Encoding: gzip 造成双重解压。
            ext = "bin"
        else:
            ext = "glb"
        name = f"asset-{counter[0]:02d}.{ext}"
        (ASSET_DIR / name).write_bytes(raw)
        uncompressed = len(gzip.decompress(raw)) if was_gz else len(raw)
        manifest.append((counter[0], name, prefix.split(";", 1)[0], was_gz,
                         len(raw), uncompressed))
        return "./game-assets/" + name

    new_body = ASSET_RE.sub(repl, body)
    if counter[0] == 0:
        raise SystemExit("没有匹配到任何内联资源，成品结构可能变了，已中止")

    # 让走 resolvePlate() 的底板/地标继续拿到解压后的 GLB（等价改写，不改玩法）
    if OLD_PLATE not in new_body:
        raise SystemExit("找不到 resolvePlate 原始实现，成品结构可能变了，已中止")
    new_body = new_body.replace(OLD_PLATE, NEW_PLATE, 1)

    # 加载提示 + 主循环启动后移除（唯一新增的两段 DOM 代码，不碰游戏逻辑）
    new_body = new_body.rstrip() + "\n" + REMOVE_SPLASH
    new_html = html[:main_block.start(2)] + new_body + html[main_block.end(2):]

    body_tag = re.search(r"<body[^>]*>", new_html, re.I)
    if not body_tag:
        raise SystemExit("找不到 <body> 标签，已中止")
    new_html = (new_html[:body_tag.end()] + "\n" + SPLASH +
                new_html[body_tag.end():])
    OUT.write_text(new_html, encoding="utf-8")

    lines = [
        "# Pages 在线版的外部资源",
        "",
        "由 `tools/build-pages.py` 从根目录成品自动解码生成，请勿手改。",
        "原先它们是 `playable.html` 主 module 里的 base64 字符串字面量；",
        "外置后 JS 源码大幅缩小，浏览器可并行下载并走 HTTP 缓存。",
        "",
        "| 编号 | 文件 | 原始协议 | gzip | 实际传输 | 解压后 |",
        "|---|---|---|---|---:|---:|",
    ]
    for num, name, kind, was_gz, wire, real in manifest:
        lines.append(f"| {num:02d} | `{name}` | `{kind}` | {'是' if was_gz else '否'} | "
                     f"{wire/1024/1024:.2f} MB | {real/1024/1024:.2f} MB |")
    lines += [
        "",
        f"合计 {len(manifest)} 项，实际传输 {sum(x[4] for x in manifest)/1024/1024:.2f} MB"
        f"（gzip 资源保留压缩态，避免体积回涨）。",
        "",
        "> 根目录 `playable.html` 仍是内联全部资源的单文件成品，供电脑下载双击运行。",
        "> 这里只是 `docs/playable.html`（Pages 在线版）的依赖，玩法与逻辑完全一致。",
        "",
    ]
    (ASSET_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")

    assets_size = sum(f.stat().st_size for f in ASSET_DIR.glob("asset-*"))
    print(f"源成品        : {SRC.stat().st_size/1024/1024:.2f} MB（未改动）")
    print(f"Pages HTML    : {OUT.stat().st_size/1024/1024:.2f} MB")
    print(f"外部资源      : {len(manifest)} 项 / {assets_size/1024/1024:.2f} MB")
    print(f"JS module     : 36.23 MB -> {len(new_body)/1024/1024:.2f} MB")
    print(f"docs/ 总计    : {(sum(f.stat().st_size for f in DOCS.rglob('*') if f.is_file()))/1024/1024:.2f} MB")


if __name__ == "__main__":
    main()
