// 把 guard_bgm.mp3 内联进 index.html，并接好保安出现触发
import fs from 'node:fs';
const ROOT = 'D:/Claude/parkour-game';
let html = fs.readFileSync(ROOT + '/index.html', 'utf8');

const mp3 = fs.readFileSync(ROOT + '/assets/guard_bgm.mp3');
const b64 = 'data:audio/mpeg;base64,' + mp3.toString('base64');
console.log('mp3 base64 length:', b64.length);

// 1) 在 SFX 对象里加 guard() 播放方法
const oldSfx = `const SFX = {
    coin:    () => tone(1300, 1900, 0.12, 'square', 0.04),`;
const newSfx = `const GUARD_BGM = ${JSON.stringify(b64)};
const SFX = {
    guard:   () => { try { const a = new Audio(GUARD_BGM); a.volume = 0.55; a.play().catch(()=>{}); } catch(e) {} },
    coin:    () => tone(1300, 1900, 0.12, 'square', 0.04),`;
if (html.includes(oldSfx)) html = html.replace(oldSfx, newSfx);
else { console.error('SFX anchor not found'); process.exit(1); }

// 2) stumble() 里保安开始追时
const old1 = `    S.chaserTimer = 5;
    showMsg('小心！' + CONFIG.chaser.name + '追上来了');`;
const new1 = `    S.chaserTimer = 5;
    SFX.guard();
    showMsg('小心！' + CONFIG.chaser.name + '追上来了');`;
if (html.includes(old1)) html = html.replace(old1, new1);
else console.warn('anchor 1 not found');

// 3) 护盾挡伤害时
const old2 = `        S.chaserTimer = Math.max(S.chaserTimer, 5);   // 护盾挡下撞击，保安立刻追上来
        showMsg('护盾抵挡了一次撞击！' + CONFIG.chaser.name + '追上来了');`;
const new2 = `        S.chaserTimer = Math.max(S.chaserTimer, 5);   // 护盾挡下撞击，保安立刻追上来
        SFX.guard();
        showMsg('护盾抵挡了一次撞击！' + CONFIG.chaser.name + '追上来了');`;
if (html.includes(old2)) html = html.replace(old2, new2);
else console.warn('anchor 2 not found');

// 4) 开局 startGame 里保安出现
const old3 = `function startGame() {
    initAudio();
    resetState();`;
const new3 = `function startGame() {
    initAudio();
    resetState();
    SFX.guard();`;
if (html.includes(old3)) html = html.replace(old3, new3);
else console.warn('anchor 3 not found');

fs.writeFileSync(ROOT + '/index.html', html, 'utf8');
console.log('done');
