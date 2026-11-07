# 工程变更记录：删除城市段尾声强制谢幕镜头 · v1

- 日期：2026-11-05
- 责任人：主程序（lead-programmer）
- 变更类型：定点删除（单文件正文，不涉及内联源）
- 唯一改动文件：`playable.html`

## 一、实现范围与依赖

城市地图跑到尾声时，`updateScene()` 会在距段尾 34m 处强制接管相机、播放一段 360° 环绕谢幕（`OrbitFanfareCamera`），再进传送门。本次把该**触发**删掉，保留全部相关基础设施。

删除范围仅一行触发语句 + 两行注释，共 4 行。删除后城市段尾声直接走「提前摆传送门预览 → 到段尾 `beginPortal()`」的既有路径。

不动的部分（有意保留，`tools/` 下调试脚本仍在调用）：
- `startFinishFanfare()` 定义、`endFinishFanfare()`、`finishCam` 实例、`OrbitFanfareCamera` 内联模块
- `Scene.fanfareDone` 字段的重置（`doSceneSwap` 内）与置位（`endFinishFanfare` 内）
- `window.__game` 上导出的 `FINISH / finishCam / startFinishFanfare / endFinishFanfare / FINISH_VIEW`

依赖顺序：改 `playable.html` → 重建 `playable-beta.html`（`make-beta.py`）→ 重建 `.perf-real.html / .perf-lite.html / .perf-beta.html`（`make-test-builds.py`）→ 跑测试。

## 二、系统实现方案

### 删除点（责任：去掉触发，不碰设备）

改前 `playable.html:12134~12140`：

```js
function updateScene(dt) {
    if (Scene.phase === 'run') {
        // 城市段尾声：先来一段 360° 环绕谢幕，再进传送门。
        // 提前 34m 触发——再晚相机绕到前方就会穿进传送门里（轨道半径 21m）。
        if (Scene.id === 'city' && !Scene.fanfareDone
            && S.D >= Scene.segEnd - 34 && startFinishFanfare()) return;
        // 下一段是隧道（要进洞），或本段是隧道（要出洞）→ 提前把洞口摆到轨道前方
```

改后 `playable.html:12134~12136`：

```js
function updateScene(dt) {
    if (Scene.phase === 'run') {
        // 下一段是隧道（要进洞），或本段是隧道（要出洞）→ 提前把洞口摆到轨道前方
```

行号自洽性校验：`startFinishFanfare` 由 15737 → 15733、`Scene.fanfareDone = true` 由 15764 → 15760，均前移 4 行，与删除行数一致。

### 删除后的城市段尾声流程

1. `S.D >= segEnd - PORTAL_CFG.previewLead` → `spawnPortalPreview('cyber', 'campus')` 摆出赛博传送门预览；
2. `S.D >= segEnd` → `beginPortal()` 进 `portalIn` 过场；
3. `finishPortal()` → `swapTo('campus')` 换场。

相机始终由常规跟拍（`updateCamera`）驱动，不再有接管。

## 三、工程组织

无新增文件、无目录调整、无工程配置变更。仅在 `tmp/qa-2026-11-04/` 下新增两个一次性探针（`probe-fanfare.js`、`probe-diag.js`），复用既有 `cdp-eval.mjs` 驱动，不属于工程产物。

## 四、资产接入清单

| 资产类型 | 来源角色 | 接入方式 | 验证点 |
|---|---|---|---|
| 无 | — | 本次不涉及美术 / 动画 / 音效 / 特效资产 | 产物体积仅因删行微降（38305642 → 38302765 字节） |

## 五、构建步骤

1. 编辑 `playable.html`（唯一正文改动）
2. `python tools/make-beta.py` → 重建 `playable-beta.html`
3. `python tools/make-test-builds.py` → 重建 `.perf-real.html / .perf-lite.html / .perf-beta.html`
4. `npm test` → 38/38
5. `node tools/selftest.mjs`（需 8765 静态服务 + 9222 CDP）→ 51/51
6. 行为验证：`tmp/qa-2026-11-04/probe-fanfare.js`（`cdp-eval.mjs` 驱动）

## 六、技术债与风险

1. **死代码留存**：`startFinishFanfare` / `finishCam` / `OrbitFanfareCamera` 已无游戏内调用方，仅 `tools/fanfareShots.mjs` 等调试脚本使用。后续若清理，需同步改这 5 个工具，属独立工单。
2. **`Scene.fanfareDone` 成为只写字段**：仍被重置/置位，但不再影响任何分支。保留无害，作为将来恢复谢幕的挂点。
3. **城市段尾声观感变化**：原来有 360° 环绕再看传送门，现在直接进传送门；属产品预期变更，非缺陷。
4. **探针的 yaw 在无头环境不可靠**：swiftshader 下约 2.5 fps，且主循环 dt 有上限钳制，采样窗口只能推进约 0.9s 的游戏时间，到不了环绕段；因此本次以 `S.state` / `FINISH.active` / 相机与玩家距离作为判据（改前 9.14→82.99m 被拉走，改后恒定 9.14~9.40m）。
