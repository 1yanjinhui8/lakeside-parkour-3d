# -*- coding: utf-8 -*-
"""
patch12_campus_default.py —— 把「燕园·未名湖」（真实校园底板）变成游戏的开门场景，
                            并在主菜单加一排场景选择器。

这个脚本是幂等的：重复跑不会叠加。它必须在 patch11_real_campus.py 之后执行。

做四件事：
  1. 清掉 patch11 早期版本重复注入的两处代码（loadCampusPlate / campusResetRun 各被写了两遍，
     前者会让 7.9MB 底板被解析两次）
  2. resetScene 的 home 从 lakeside 改成 campus；开场轮换队列相应换成另外三个场景
  3. 主菜单加场景选择器（燕园 / 湖畔轨道 / 城市街区 / 火车隧道 / 随机轮换）
  4. ?theme= 的判断从「不等于 lakeside 才切」改成「不等于当前场景才切」

用法：
    python tools/patch12_campus_default.py
    python tools/make-test-builds.py
    python tools/make-beta.py
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'playable.html')

s = io.open(SRC, encoding='utf-8', newline='').read()
changes = []


def rep(old, new, note):
    """替换一处。

    判重条件必须是「new 已存在」，不能是「old 不存在」——
    本脚本好几个 new 的结尾就是 old 本身（比如 $('startBtn').onclick = startGame;），
    第二次跑时 old 仍然在（在 new 末尾），按 old 判重就会再插一份。
    """
    global s
    if new in s:
        changes.append(note + '（已应用，跳过）')
        return
    n = s.count(old)
    assert n == 1, '锚点异常（出现 %d 次）：%s' % (n, note)
    s = s.replace(old, new, 1)
    changes.append(note)


# ---------------------------------------------------------------- 1. 去重复注入
dup_plate = """// 真实校园底板：必须在第一次 buildWorld('campus') 之前载入
try { await loadCampusPlate(); } catch (e) { console.warn('[campus] 底板载入失败，回退成直道', e); }

// 真实校园底板：必须在第一次 buildWorld('campus') 之前载入
try { await loadCampusPlate(); } catch (e) { console.warn('[campus] 底板载入失败，回退成直道', e); }"""
rep(dup_plate,
    """// 真实校园底板：必须在第一次 buildWorld('campus') 之前载入。
// 注意只能载入一次——7.9MB 的 GLB 解析两遍等于白烧内存和启动时间。
try { await loadCampusPlates(); } catch (e) { console.warn('[campus] 底板载入失败，回退成直道', e); }""",
    '底板只载入一次（原来被注入两遍）')

dup_reset = """    campusResetRun();          // 重开局：路线里程归零（主题没换时也得复位）
    campusResetRun();          // 重开局：路线里程归零（主题没换时也得复位）"""
one_reset = """    campusResetRun();          // 重开局：路线里程归零（主题没换时也得复位）"""
# 这一处不能走 rep()：单行 new 是多行 old 的子串，判重会误判成「已应用」。
# 直接看两行连写的那一段还在不在——它在就削掉一行。
if dup_reset in s:
    s = s.replace(dup_reset, one_reset, 1)
    changes.append('重开局只复位一次（原来被注入两遍）')
else:
    changes.append('重开局只复位一次（已应用，跳过）')

# ---------------------------------------------------------------- 2. 开门场景
rep("""    const home = urlTheme || 'lakeside';
    if (!urlTheme) Scene.queue = ['tunnel', 'city', 'campus'];""",
    """    // 开门就是燕园·未名湖：真实校园底板 3011m 一圈，是这张图最好看的部分
    const home = urlTheme || 'campus';
    if (!urlTheme) Scene.queue = ['lakeside', 'city', 'tunnel'];""",
    '开局场景改为 campus，开场轮换队列换成其余三个')

# ---------------------------------------------------------------- 3. 菜单场景选择器
old_menu = """    <div class="sub" id="menuBank"></div>
    <button class="btn" id="startBtn">开始奔跑</button>"""
new_menu = """    <div class="sub" id="menuBank"></div>
    <div class="scenePick" id="scenePick">
        <button data-theme="campus">燕园 · 未名湖</button>
        <button data-theme="lakeside">湖畔轨道</button>
        <button data-theme="city">城市街区</button>
        <button data-theme="tunnel">火车隧道</button>
        <button data-theme="">随机轮换</button>
    </div>
    <div class="sceneTip" id="sceneTip">从哪张图开始跑</div>
    <button class="btn" id="startBtn">开始奔跑</button>"""
rep(old_menu, new_menu, '菜单加场景选择器')

old_css = """    .btn:active { transform: translateY(4px); box-shadow: 0 2px 0 #9c0f55; }
    .hidden { display: none !important; }"""
new_css = """    .btn:active { transform: translateY(4px); box-shadow: 0 2px 0 #9c0f55; }
    .hidden { display: none !important; }

    /* 场景选择器：开局从哪张图开始跑 */
    .scenePick {
        display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
        max-width: 580px; margin-bottom: 10px;
    }
    .scenePick button {
        padding: 9px 16px; font-size: 15px; font-weight: bold; color: #fff; cursor: pointer;
        background: rgba(0, 0, 0, .34); border: 2px solid rgba(255, 255, 255, .26);
        border-radius: 22px; font-family: inherit; transition: border-color .15s, background .15s;
    }
    .scenePick button:hover { border-color: rgba(255, 255, 255, .6); }
    .scenePick button.on {
        background: linear-gradient(#ff4fa8, #e0157a);
        border-color: rgba(255, 255, 255, .88);
        box-shadow: 0 0 14px rgba(255, 79, 168, .5);
    }
    .sceneTip {
        font-size: 13px; color: rgba(255, 255, 255, .6);
        margin-bottom: 6px; text-align: center; min-height: 18px;
    }"""
rep(old_css, new_css, '场景选择器样式')

old_bind = """$('startBtn').onclick = startGame;"""
new_bind = """// ---- 场景选择器 ----
// 选具体场景 = 固定开局主题（urlTheme 一并置值，开局就不会再走开场队列）；
// 选「随机轮换」= 清空 urlTheme，恢复四图轮换。
(function bindScenePicker() {
    const box = $('scenePick'), tip = $('sceneTip');
    if (!box) return;
    const labels = {
        campus: '燕园 · 未名湖：北大真实数据，3011m 一圈，有 10 个急弯要打方向',
        lakeside: '湖畔轨道：开局那张铁轨图，靠左躲火车',
        city: '城市街区：霓虹高楼，广告牌与车流',
        tunnel: '火车隧道：全黑+柱阵，间隙是唯一横切通道',
        '': '随机轮换：先在燕园跑一圈，之后按权重换图',
    };
    const sync = () => {
        const cur = urlTheme || '';
        for (const b of box.querySelectorAll('button')) b.classList.toggle('on', b.dataset.theme === cur);
        if (tip) tip.textContent = labels[cur] || '';
    };
    for (const b of box.querySelectorAll('button')) {
        b.onclick = () => {
            const t = b.dataset.theme;
            urlTheme = t || null;
            // 主题换了就立刻把预览世界重建出来（菜单背景是活的）
            if (t && t !== curTheme) { Scene.queue = []; doSceneSwap(t); setFade(0, 0.01); }
            sync();
        };
    }
    sync();
    window.__scenePickerSync = sync;
})();

$('startBtn').onclick = startGame;"""
rep(old_bind, new_bind, '场景选择器事件绑定')

# ---------------------------------------------------------------- 4. ?theme= 判断
rep("""    if (THEMES[t]) { urlTheme = t; if (t !== 'lakeside') doSceneSwap(t); }""",
    """    if (THEMES[t]) {
        urlTheme = t;
        if (t !== curTheme) doSceneSwap(t);
        if (window.__scenePickerSync) window.__scenePickerSync();
    }""",
    '?theme= 改为与当前场景比较')

# ---------------------------------------------------------------- 5. 开局时间与昼夜周期
# 原来 st.t 从 0.02（黎明最暗处）起步，190 秒走完一整天：
# 打开游戏就是一片紫灰，跑两分钟直接天黑，校园立面根本看不出颜色。
rep("        t: 0.02, cycle: 190, indoor: false, id: '', sceneName: '湖畔轨道',",
    "        t: 0.30, cycle: 600, indoor: false, id: '', sceneName: '燕园·未名湖',",
    '开局时间改为午后（0.30），昼夜周期 190s → 600s')

io.open(SRC, 'w', encoding='utf-8', newline='').write(s)
print('patch12 完成（%d 项）：' % len(changes))
for c in changes:
    print('  ·', c)
