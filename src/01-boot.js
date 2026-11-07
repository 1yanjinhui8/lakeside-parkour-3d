/* 老浏览器（iOS Safari < 16.4 / Chrome < 89）不支持 importmap，模块加载会直接失败，
   页面就是一片白 —— 对方拿到文件只会以为「打不开」，不知道是浏览器的问题。
   这里提前挡一下，给一句能照着做的话。 */
if (!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'))) {
    document.write('<div style="position:fixed;inset:0;z-index:99999;background:#12101c;color:#fff;' +
      'font:16px/1.75 \'Microsoft YaHei\',\'PingFang SC\',sans-serif;display:flex;align-items:center;' +
      'justify-content:center;text-align:center;padding:32px"><div>' +
      '<div style="font-size:46px;margin-bottom:14px">🌐</div>' +
      '<div style="font-size:20px;font-weight:800;margin-bottom:10px">浏览器版本太旧，跑不起来</div>' +
      '<div style="color:#9aa4c0">这个游戏需要支持 importmap 的浏览器<br>' +
      '请用 <b style="color:#ffd257">Chrome 89+</b> / <b style="color:#ffd257">Edge 89+</b> / ' +
      '<b style="color:#ffd257">Safari 16.4+</b> 打开</div>' +
      '<div style="color:#6b7390;font-size:13px;margin-top:16px">在微信 / QQ 里点开的，' +
      '请点右上角「⋯」→「在浏览器打开」</div></div></div>');
}
