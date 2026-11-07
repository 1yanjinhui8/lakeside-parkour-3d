@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/playable.html"

rem 端口已在监听 → 直接开浏览器，不重复启动
netstat -ano | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>nul
if not errorlevel 1 goto open

echo 正在启动本地服务器（离线也能玩）...

rem 优先用 Node（项目自带 _srv.js，无需联网、无需额外依赖）
where node >nul 2>nul
if not errorlevel 1 (
    start "parkour-server" /min node "%~dp0_srv.js"
    goto wait
)

rem 没有 Node 时退回 Python
where python >nul 2>nul
if not errorlevel 1 (
    start "parkour-server" /min python -m http.server %PORT% --bind 127.0.0.1
    goto wait
)

echo.
echo 未检测到 Node.js 或 Python，无法启动本地服务器。
echo 请安装 Node.js（https://nodejs.org）后重新双击本文件。
echo.
pause
exit /b 1

:wait
rem 最多等 20 秒，直到端口真正可连接，再打开浏览器
for /l %%i in (1,1,20) do (
    netstat -ano | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>nul
    if not errorlevel 1 goto open
    timeout /t 1 /nobreak >nul
)

echo.
echo 服务器启动失败。
echo 请查看名为 parkour-server 的窗口里的报错信息（常见原因：端口被占用）。
echo.
pause
exit /b 1

:open
start "" "%URL%"
echo 游戏已在浏览器中打开：%URL%
echo 玩完后关闭名为 parkour-server 的窗口即可。
timeout /t 3 /nobreak >nul
exit /b 0
