# -*- coding: utf-8 -*-
"""
tools/extract-src.py —— 从单文件成品 playable.html 导出「可读源码镜像」到 src/

背景：playable.html 约 38MB，其中 37.5MB 是内联的 three.js 与 GLB/音频 base64，
GitHub 网页对超大文件不渲染源码。本脚本把纯逻辑代码原样导出，把内联资源
替换成短占位标记，于是每个源码文件都小到 GitHub 能正常显示。

重要：本脚本【只读】playable.html，不会修改成品文件，玩法完全不受影响。
改完成品后重新运行即可同步：

    python tools/extract-src.py

仅依赖 Python 3 标准库。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src"
HTML_FILE = ROOT / "playable.html"

BLOCKS = [
    (0, "01-boot.js", "老浏览器 / importmap 支持检测与中文提示"),
    (1, "02-importmap.json", "importmap：three.js 与两个扩展以 data: 内联（已省略）"),
    (2, "03-pkvs-core.js", "PKVS 双人对战 · WebRTC 传输层 v1.0.0"),
    (3, "04-pkvs-lobby-ui.js", "PKVS 双人对战 · 对战大厅 UI v2.0.0"),
    (4, "05-pkvs-items.js", "PKVS 双人对战 · 干扰道具（Ink & Friends）"),
    (5, "06-pkvs-integration.js", "PKVS 双人对战 · 游戏接入层"),
    (6, "game.module.js", "游戏主逻辑（配置 / 渲染 / 碰撞 / 道具 / 自检）"),
]

ASSET_RE = re.compile(r"((?:data|gz):[^\"']{0,120}?;base64,)([A-Za-z0-9+/=]+)")
SECTION_RE = re.compile(r"^//\s*([①-⑳])\s*(.+?)\s*$", re.M)
MAX_PART = 110 * 1024


def main():
    if not HTML_FILE.is_file():
        raise SystemExit(f"找不到成品文件：{HTML_FILE}")
    (OUT / "parts").mkdir(parents=True, exist_ok=True)

    html = HTML_FILE.read_text(encoding="utf-8", errors="replace")
    scripts = list(re.finditer(r"<script\b([^>]*)>(.*?)</script\s*>", html, re.S | re.I))
    styles = list(re.finditer(r"<style\b([^>]*)>(.*?)</style\s*>", html, re.S | re.I))
    if len(scripts) < 7:
        raise SystemExit(f"script 块数量异常（{len(scripts)}），成品结构可能变了，已中止")

    manifest = []
    counter = [0]

    def strip_assets(text):
        def repl(m):
            counter[0] += 1
            raw = m.group(2)
            prefix = m.group(1)
            kind = prefix.split(";", 1)[0].replace("data:", "").replace("gz:", "")
            manifest.append((counter[0], kind, len(raw)))
            return prefix + f"OMITTED-{counter[0]:02d}-{len(raw)/1024/1024:.2f}MB-see-INLINE-ASSETS-md"
        return ASSET_RE.sub(repl, text)

    # 1) 各 script 块导出成独立源码文件
    exported = []
    game_code = None
    for idx, name, desc in BLOCKS:
        body = scripts[idx].group(2).strip("\n")
        body = strip_assets(body)
        (OUT / name).write_text(body.rstrip() + "\n", encoding="utf-8")
        size = (OUT / name).stat().st_size
        exported.append((name, desc, size))
        if idx == 6:
            game_code = body

    # 2) CSS
    if styles:
        (OUT / "style.css").write_text(styles[0].group(2).strip() + "\n", encoding="utf-8")
        exported.append(("style.css", "页面样式（HUD / 设置面板 / 结算）",
                         (OUT / "style.css").stat().st_size))

    # 3) HTML 骨架：保留标签结构，内容换成指向源码的注释
    template = html
    # 按位置从后往前替换，避免位置偏移
    targets = []
    for bi, name, _ in BLOCKS:
        targets.append((scripts[bi].start(), scripts[bi].end(), f"/* → src/{name} */", True))
    for m in styles:
        targets.append((m.start(), m.end(), "<style>\n/* → src/style.css */\n</style>", False))
    for start, end, replacement, is_script in sorted(targets, reverse=True):
        if is_script:
            tag = html[start:html.index(">", start) + 1]
            template = template[:start] + tag + "\n" + replacement + "\n</script>" + template[end:]
        else:
            template = template[:start] + replacement + template[end:]
    template = strip_assets(template)
    (OUT / "index.template.html").write_text(template, encoding="utf-8")
    exported.append(("index.template.html", "HTML 骨架（script/style 内容指向上面的源码文件）",
                     (OUT / "index.template.html").stat().st_size))

    # 4) 主逻辑按作者写的 ①②③… 分节再切一遍，保证每段都小到 GitHub 能渲染
    marks = list(SECTION_RE.finditer(game_code))
    sections = []
    if len(marks) >= 3:
        boundaries = [m.start() for m in marks] + [len(game_code)]
        for i in range(len(marks)):
            title = marks[i].group(2).strip()
            sections.append((title, game_code[boundaries[i]:boundaries[i + 1]]))
        if boundaries[0] > 0:
            sections.insert(0, ("文件头", game_code[:boundaries[0]]))
    else:
        sections = [("主逻辑", game_code)]

    # 超长分节先按行边界拆开（尽量不切断语句）
    expanded = []
    for title, chunk in sections:
        if len(chunk) <= MAX_PART:
            expanded.append((title, chunk))
            continue
        acc, part_no = "", 1
        for line in chunk.splitlines(keepends=True):
            if len(acc) + len(line) > MAX_PART and acc.strip():
                expanded.append((f"{title} ({part_no})", acc))
                part_no += 1
                acc = ""
            acc += line
        if acc.strip():
            expanded.append((f"{title} ({part_no})", acc))

    # 相邻小分节合并打包，保证每段都不超过 MAX_PART
    packed, cur, cur_titles, cur_len = [], [], [], 0
    for title, chunk in expanded:
        if cur_len + len(chunk) > MAX_PART and cur:
            packed.append((" + ".join(cur_titles), "".join(cur)))
            cur, cur_titles, cur_len = [], [], 0
        cur.append(chunk)
        cur_titles.append(title)
        cur_len += len(chunk)
    if cur:
        packed.append((" + ".join(cur_titles), "".join(cur)))

    for old in (OUT / "parts").glob("*.js"):
        old.unlink()
    part_rows = []
    for i, (title, chunk) in enumerate(packed, 1):
        fn = f"{i:02d}.js"
        header = (f"// ── 主逻辑片段 {i:02d}/{len(packed):02d} ──────────────────────────────\n"
                  f"// 分节：{title[:90]}\n"
                  f"// 按编号顺序合起来 = src/game.module.js 的全部逻辑（资源已用占位符替代）\n"
                  f"// 生成自 playable.html，勿手改；重跑 tools/extract-src.py 同步\n"
                  f"// ────────────────────────────────────────────────────────────────\n\n")
        (OUT / "parts" / fn).write_text(header + chunk.strip("\n") + "\n", encoding="utf-8")
        part_rows.append((fn, title, (OUT / "parts" / fn).stat().st_size))

    # 5) 内联资源清单
    lines = [
        "# playable.html 里的内联资源（源码占位符对照表）",
        "",
        "成品为了「双击即玩、完全离线」，把以下资源以 base64 直接嵌进了 HTML。",
        "它们不是逻辑代码，所以在 `src/` 的源码镜像里被替换成",
        "`OMITTED-NN-X.XXMB-see-INLINE-ASSETS-md` 这样的短标记。",
        "",
        "| 编号 | 类型 | base64 字符数 | 约合 |",
        "|---|---|---:|---:|",
    ]
    for num, kind, size in manifest:
        lines.append(f"| {num:02d} | `{kind}` | {size:,} | {size*3/4/1024/1024:.2f} MB |")
    lines += [
        "",
        f"合计 {len(manifest)} 项、约 {sum(x[2] for x in manifest)*3/4/1024/1024:.1f} MB。",
        "three.js 本体另见仓库 `lib/three.module.js`，模型源文件见 `assets/`。",
        "完整可运行的资源仍在 `playable.html` 中，本表只是源码阅读时的索引。",
        "",
    ]
    (OUT / "INLINE-ASSETS.md").write_text("\n".join(lines), encoding="utf-8")

    # 6) 源码导航
    nav = [
        "# 源码导览",
        "",
        "> **成品 `playable.html`（38MB）一个字节都没改，玩法完全不变。**",
        "> 这里是从成品里**原样导出**的可读源码镜像，只把内联的 base64 资源换成了短占位符，",
        "> 因此每个文件都小到 GitHub 网页能正常渲染、能高亮、能看 diff。",
        "",
        "## 为什么会有两份",
        "",
        "成品是「单文件离线游戏」：three.js、7 座地标 GLB、角色、音频全部内联，",
        "所以 37.5MB 是数据、真正的逻辑代码只有几百 KB。GitHub 对超大文件不显示源码，",
        "于是把代码单独抽出来放在这里。逻辑部分逐字照搬，只有资源数据换成了占位标记。",
        "",
        "## 文件顺序（也就是 playable.html 里的加载顺序）",
        "",
        "| 文件 | 内容 | 大小 |",
        "|---|---|---:|",
    ]
    for name, desc, size in exported:
        nav.append(f"| [`{name}`]({name}) | {desc} | {size/1024:.0f} KB |")
    nav += [
        "",
        "`game.module.js` 约 700KB，GitHub 仍可能提示文件较大（可点 View raw）；",
        "因此主逻辑另按作者写的 ①②③… 分节拆进了 [`parts/`](parts/)，",
        "每段都在 130KB 以内，逐段读比翻一个大文件舒服得多。",
        "按顺序合起来就是完整主逻辑（每段开头只是几行导航注释）。",
        "",
        "## 片段索引",
        "",
        "| 片段 | 覆盖的分节 | 大小 |",
        "|---|---|---:|",
    ]
    for fn, title, size in part_rows:
        nav.append(f"| [`parts/{fn}`](parts/{fn}) | {title[:70]} | {size/1024:.0f} KB |")
    nav += [
        "",
        "## 改完成品后怎么同步",
        "",
        "```bash",
        "python tools/extract-src.py",
        "```",
        "",
        "脚本只读 `playable.html`，重新生成整个 `src/`。",
        "分工：`tools/` 里其它脚本负责**构建**成品，本脚本负责**展示**源码。",
        "",
        "原始模块化源码（造景、相机、天气等）见仓库根目录 `js/`，",
        "开发过程与体积优化记录见根目录 `README.md`。",
        "",
    ]
    (OUT / "README.md").write_text("\n".join(nav), encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"成品：{HTML_FILE.stat().st_size/1024/1024:.2f} MB（未改动）")
    print(f"内联资源：{len(manifest)} 项，约 {sum(x[2] for x in manifest)*3/4/1024/1024:.1f} MB 已用占位符替代")
    print(f"源码镜像：{total/1024/1024:.2f} MB，共 {len(list(OUT.rglob('*')))} 项")
    print(f"主逻辑分节：{len(sections)} 段 -> parts/ 共 {len(packed)} 个文件")
    print("最大文件：", max(((f.stat().st_size, f.name) for f in OUT.rglob('*') if f.is_file())))


if __name__ == "__main__":
    main()
