# 源码导览

> **成品 `playable.html`（38MB）一个字节都没改，玩法完全不变。**
> 这里是从成品里**原样导出**的可读源码镜像，只把内联的 base64 资源换成了短占位符，
> 因此每个文件都小到 GitHub 网页能正常渲染、能高亮、能看 diff。

## 为什么会有两份

成品是「单文件离线游戏」：three.js、7 座地标 GLB、角色、音频全部内联，
所以 37.5MB 是数据、真正的逻辑代码只有几百 KB。GitHub 对超大文件不显示源码，
于是把代码单独抽出来放在这里。逻辑部分逐字照搬，只有资源数据换成了占位标记。

## 文件顺序（也就是 playable.html 里的加载顺序）

| 文件 | 内容 | 大小 |
|---|---|---:|
| [`01-boot.js`](01-boot.js) | 老浏览器 / importmap 支持检测与中文提示 | 1 KB |
| [`02-importmap.json`](02-importmap.json) | importmap：three.js 与两个扩展以 data: 内联（已省略） | 0 KB |
| [`03-pkvs-core.js`](03-pkvs-core.js) | PKVS 双人对战 · WebRTC 传输层 v1.0.0 | 30 KB |
| [`04-pkvs-lobby-ui.js`](04-pkvs-lobby-ui.js) | PKVS 双人对战 · 对战大厅 UI v2.0.0 | 87 KB |
| [`05-pkvs-items.js`](05-pkvs-items.js) | PKVS 双人对战 · 干扰道具（Ink & Friends） | 27 KB |
| [`06-pkvs-integration.js`](06-pkvs-integration.js) | PKVS 双人对战 · 游戏接入层 | 21 KB |
| [`game.module.js`](game.module.js) | 游戏主逻辑（配置 / 渲染 / 碰撞 / 道具 / 自检） | 718 KB |
| [`style.css`](style.css) | 页面样式（HUD / 设置面板 / 结算） | 14 KB |
| [`index.template.html`](index.template.html) | HTML 骨架（script/style 内容指向上面的源码文件） | 6 KB |

`game.module.js` 约 700KB，GitHub 仍可能提示文件较大（可点 View raw）；
因此主逻辑另按作者写的 ①②③… 分节拆进了 [`parts/`](parts/)，
每段都在 130KB 以内，逐段读比翻一个大文件舒服得多。
按顺序合起来就是完整主逻辑（每段开头只是几行导航注释）。

## 片段索引

| 片段 | 覆盖的分节 | 大小 |
|---|---|---:|
| [`parts/01.js`](parts/01.js) | 文件头 + 游戏配置 —— 角色、追捕者、道具、难度都在这里改 + 加载 Three.js：优先本地文件（需本地服务器），否则走 CDN + | 26 KB |
| [`parts/02.js`](parts/02.js) | 性能档位 —— 手机不是电脑，光影得能「减配」而不是硬开 + 注册时扫一遍顶点，按 2m 一层、24 个方位记下「每层的截面半径」——等于  | 122 KB |
| [`parts/03.js`](parts/03.js) | 全部烘进**一个顶点色 mesh**：加法混合，白天 opacity=0 完全隐形， + 程序生成的贴图 + 静态世界：按主题重建（地面、轨 | 57 KB |
| [`parts/04.js`](parts/04.js) | 循环滚动的装饰：楼房、路灯、湖边岩石、金色相框 (1) | 109 KB |
| [`parts/05.js`](parts/05.js) | 循环滚动的装饰：楼房、路灯、湖边岩石、金色相框 (2) | 120 KB |
| [`parts/06.js`](parts/06.js) | 循环滚动的装饰：楼房、路灯、湖边岩石、金色相框 (3) + ⑦ 主题注册表与世界重建 + ⑧ 场景管理器：段落长度 / 黑场转场 / 下一场 | 107 KB |
| [`parts/07.js`](parts/07.js) | b 动画核心 + 飞行控制器 + 障碍物 / 金币 / 道具 的模型 + 游戏状态 + 关卡生成 + 物理 / 碰撞 | 88 KB |
| [`parts/08.js`](parts/08.js) | 每帧更新 + 操作 + 界面 + 浏览器内自检（?selftest 或控制台 __game.selfTest()） + 主循环 | 94 KB |

## 改完成品后怎么同步

```bash
python tools/extract-src.py
```

脚本只读 `playable.html`，重新生成整个 `src/`。
分工：`tools/` 里其它脚本负责**构建**成品，本脚本负责**展示**源码。

原始模块化源码（造景、相机、天气等）见仓库根目录 `js/`，
开发过程与体积优化记录见根目录 `README.md`。
