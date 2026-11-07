# -*- coding: utf-8 -*-
"""补丁 6：换场里程 3500→3000；天气节拍改为按里程（除薄雾外每 2000 米一次）"""
import io, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'playable.html')
src = io.open(P, encoding='utf-8').read()


def rep(old, new, tag):
    global src
    n = src.count(old)
    assert n == 1, '[%s] 期望 1 次匹配，实际 %d 次' % (tag, n)
    src = src.replace(old, new)
    print('OK   ' + tag)


# ---------------------------------------------------------------- ① 换场里程 3000
rep("const SCENE_SEG_LEN = { lakeside: [3500, 3500], tunnel: [3500, 3500], city: [3500, 3500], campus: [3500, 3500] };",
    "const SCENE_SEG_LEN = { lakeside: [3000, 3000], tunnel: [3000, 3000], city: [3000, 3000], campus: [3000, 3000] };",
    '换场里程 3000')

rep("    segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 3500 米）",
    "    segEnd: SCENE_SEG_LEN.lakeside[0],   // 本段结束里程（首段同样是整段 3000 米）",
    '首段注释')

# ---------------------------------------------------------------- ② 天气状态：里程节拍
rep("""    const st = {
        t: 0.02, cycle: 190, indoor: false, id: '', sceneName: '湖畔轨道',
        weather: 'clear', manual: false, autoTimer: 26, seqIdx: 0,
        rain: 0, mist: 0, paused: false, label: '',
    };""",
    """    // 天气节拍：除薄雾外，其余天气一律按里程走，每 2000 米切一次
    const WX_DIST = 2000;
    const st = {
        t: 0.02, cycle: 190, indoor: false, id: '', sceneName: '湖畔轨道',
        weather: 'clear', manual: false, seqIdx: 0,
        seg: 0, lastDist: 0,                              // 里程节拍：第几段 / 上一帧里程
        mistTimer: 55 + Math.random() * 45, mistLeft: 0,  // 薄雾自己的进出计时（不吃里程节拍）
        rain: 0, mist: 0, paused: false, label: '',
    };""",
    '天气状态加里程节拍')

# ---------------------------------------------------------------- ③ 自动排程改写
rep("""    // 自动排程：保证一局里能看到 晴 → 雨 → 晴 → 雾 的轮换
    const SEQ = ['rain', 'clear', 'mist', 'clear', 'rain', 'mist', 'clear'];
    function advanceWeather(dt) {
        if (st.manual) return;
        st.autoTimer -= dt;
        if (st.autoTimer <= 0) {
            st.autoTimer = 34 + Math.random() * 30;
            setWeather(SEQ[st.seqIdx % SEQ.length], false);
            st.seqIdx++;
        }
    }""",
    """    // 里程节拍用的天气序列：只有晴 / 雨，薄雾不在里面
    const WX_SEQ = ['clear', 'rain', 'clear', 'rain', 'clear'];
    const MIST_LIFE = [10, 18];          // 薄雾一次持续多久（秒）

    function advanceWeather(dt, dist) {
        if (st.manual) return;

        // ① 薄雾：自己计时进出，不吃里程节拍，也不会被 2000 米那一刀砍断
        if (st.weather === 'mist') {
            st.mistLeft -= dt;
            if (st.mistLeft <= 0) setWeather(WX_SEQ[st.seqIdx % WX_SEQ.length], false);   // 雾散，回到里程节的天气
        } else {
            st.mistTimer -= dt;
            if (st.mistTimer <= 0) {
                st.mistTimer = 55 + Math.random() * 45;
                st.mistLeft = MIST_LIFE[0] + Math.random() * (MIST_LIFE[1] - MIST_LIFE[0]);
                setWeather('mist', false);
            }
        }

        // ② 其余天气：每 2000 米切一次
        if (typeof dist === 'number' && isFinite(dist)) {
            if (dist + 1 < st.lastDist) { st.seg = 0; st.lastDist = 0; }   // 里程归零 = 新的一局
            st.lastDist = dist;
            const seg = Math.floor(dist / WX_DIST);
            if (seg > st.seg) {
                st.seg = seg;
                st.seqIdx++;                                              // 先占位，雾散了立刻生效
                if (st.weather !== 'mist') setWeather(WX_SEQ[st.seqIdx % WX_SEQ.length], false);
            }
        }
    }""",
    '天气改里程节拍')

# ---------------------------------------------------------------- ④ update 接收里程
rep("""    function update(dt) {
        if (!st.paused) st.t = (st.t + dt / st.cycle) % 1;
        advanceWeather(dt);""",
    """    function update(dt, dist) {
        if (!st.paused) st.t = (st.t + dt / st.cycle) % 1;
        advanceWeather(dt, dist);""",
    'update 接收里程')

# ---------------------------------------------------------------- ⑤ 主循环传 S.D
rep("    ATMO.update(dt);",
    "    ATMO.update(dt, S.D);        // 天气按里程切，得把里程喂进去",
    '主循环传里程')

# ---------------------------------------------------------------- ⑥ 换场时别提前催雾
rep("            if (!st.manual) st.autoTimer = Math.min(st.autoTimer, 24);",
    "            if (!st.manual) st.mistTimer = Math.min(st.mistTimer, 30);   // 换场后别憋太久才起雾",
    'onScene 改指 mistTimer')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('done')
