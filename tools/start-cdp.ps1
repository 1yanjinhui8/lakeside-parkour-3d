# 启动一个带远程调试端口的无头 Edge，供 tools/cdp.mjs 连接
$ErrorActionPreference = 'SilentlyContinue'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$prof = Join-Path $env:TEMP 'edge-cdp-profile'
Get-Process msedge | Stop-Process -Force
Start-Sleep -Milliseconds 800
$args = @(
    '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-crash-reporter', '--no-first-run', "--user-data-dir=$prof",
    '--remote-debugging-port=9222', '--hide-scrollbars',
    '--window-size=1280,800', 'about:blank'
)
Start-Process -FilePath $edge -ArgumentList $args | Out-Null
Start-Sleep -Seconds 3
try { (Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -UseBasicParsing -TimeoutSec 5).StatusCode } catch { 'CDP 未就绪' }
