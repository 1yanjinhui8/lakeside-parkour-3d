# 用无头 Edge 逐个截取游戏画面（每次截图后强制结束浏览器，避免卡住）
param(
  [string[]]$Scenes = @('run', 'jump', 'apex', 'roll', 'fly', 'land', 'menu', 'face'),
  [string]$Root = 'D:\Claude\parkour-game',
  [string]$Server = 'http://127.0.0.1:8765/_shot.html?scene=',
  [int]$TimeoutSec = 80
)
$ErrorActionPreference = 'SilentlyContinue'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$dir = Join-Path $Root 'screenshots'
New-Item -ItemType Directory -Force $dir | Out-Null

foreach ($s in $Scenes) {
    $out = Join-Path $dir "_scene_$s.png"
    Remove-Item $out -Force
    $prof = Join-Path $env:TEMP "edge-shot-$s"
    $args = @(
        '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
        '--disable-crash-reporter', '--no-first-run', "--user-data-dir=$prof",
        '--hide-scrollbars', '--window-size=1280,800', '--virtual-time-budget=20000',
        "--screenshot=$out", ($Server + $s)
    )
    $p = Start-Process -FilePath $edge -ArgumentList $args -PassThru
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $out)) { Start-Sleep -Milliseconds 400 }
    Start-Sleep -Milliseconds 700
    Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
    if (Test-Path $out) { Write-Host "OK   $s  $([math]::Round((Get-Item $out).Length/1KB)) KB" }
    else { Write-Host "FAIL $s" }
    Start-Sleep -Milliseconds 500
}
