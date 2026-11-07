# 想看源码？从这里开始

[`playable.html`](playable.html) 是最终成品：38MB 单文件，双击即玩、完全离线。
但其中约 **37.5MB 是内联的 three.js / GLB 模型 / 音频 base64 数据**，
真正的逻辑代码只有几百 KB。GitHub 网页对这种超大文件不渲染源码 ——
这就是点开成品文件看不到代码的原因。

**游戏逻辑源码在这里：** [`src/`](src/) · [源码导览](src/README.md)

| 位置 | 内容 |
|---|---|
| [`src/parts/`](src/parts/) | 主逻辑按作者写的 ①②③… 分节拆成 8 个文件，每个 < 130KB，GitHub 上可直接阅读、高亮、看 diff |
| [`src/game.module.js`](src/game.module.js) | 完整主逻辑（约 700KB，GitHub 可能提示较大，可点 View raw） |
| [`src/01-` ~ `06-`](src/) | 老浏览器检测、importmap、PKVS 双人对战插件四件套 |
| [`src/style.css`](src/style.css) / [`src/index.template.html`](src/index.template.html) | 样式与 HTML 骨架 |
| [`src/INLINE-ASSETS.md`](src/INLINE-ASSETS.md) | 被省略的 17 项内联资源对照表 |
| [`js/`](js/) | 造景 / 相机 / 天气 / 地标的原始模块化源码 |
| [`tools/`](tools/) | 构建、内联打包、自动化测试全套脚本 |
| [`README.md`](README.md) | 118KB 完整开发日志 |

## 玩法有没有变

**没有。`playable.html` 和 `playable-beta.html` 一个字节都没改。**

`src/` 是从成品**只读导出**的镜像：逻辑代码逐字照搬，只把内联的 base64
数据换成了 `OMITTED-NN-X.XXMB-see-INLINE-ASSETS-md` 这样的短标记。
成品仍然是可直接双击运行的完整游戏，源码只是用来读的。

## 改完成品后同步源码

```bash
python tools/extract-src.py
```

脚本只读 `playable.html`，重新生成整个 `src/`，不会影响成品。
分工上，`tools/` 里其它脚本负责**构建**成品，这个脚本负责**展示**源码。

## 在线版为什么和成品不一样

`docs/playable.html` 是给手机 / 在线访问用的**加载优化版**：把内联的 14 个
模型与音频外置成 `docs/game-assets/` 下的独立文件，JS module 从 36MB 降到
0.6MB，资源并行下载并走 HTTP 缓存，加载期间有进度提示。游戏逻辑与成品
逐字一致，只有资源 URL 和 `resolvePlate()` 的解压来源不同。

根目录 `playable.html` 仍是内联全部资源的单文件成品，供电脑下载双击运行。
优化版由 `python tools/build-pages.py` 生成，详见 `docs/game-assets/README.md`。
