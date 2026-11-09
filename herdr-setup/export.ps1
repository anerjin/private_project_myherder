# 현재 PC의 Herdr 설치본과 설정을 이 폴더(herdr-setup)로 다시 묶습니다.
# Herdr를 업데이트했거나 설정/모드를 바꾼 뒤 다시 실행하면 묶음이 최신으로 갱신됩니다.
#
#   powershell -ExecutionPolicy Bypass -File .\export.ps1
#
# 읽기만 하는 스크립트입니다. 현재 PC의 설치나 실행 중인 터미널은 건드리지 않습니다.

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

$src = @{
    App       = Join-Path $env:LOCALAPPDATA "Programs\herdr-app"
    Core      = Join-Path $env:LOCALAPPDATA "Programs\herdr-core"
    AppHome   = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE ".config\herdr-app" }
    CoreConf  = Join-Path $env:APPDATA "herdr-core"
    ClaudeMd  = Join-Path $env:USERPROFILE ".claude\CLAUDE.md"
}
foreach ($k in 'App', 'Core', 'AppHome') {
    if (-not (Test-Path $src[$k])) { throw "찾을 수 없음: $($src[$k])" }
}

function Mirror($from, $to, [string[]]$xf = @(), [string[]]$xd = @()) {
    New-Item -ItemType Directory -Force $to | Out-Null
    $rc = @($from, $to, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    if ($xf) { $rc += '/XF'; $rc += $xf }
    if ($xd) { $rc += '/XD'; $rc += $xd }
    & robocopy @rc | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy 실패 ($LASTEXITCODE): $from" }
}

Write-Host "1/4 프로그램 복사"
Mirror $src.App  (Join-Path $here "programs\herdr-app")
Mirror $src.Core (Join-Path $here "programs\herdr-core")

Write-Host "2/4 herdr-app 설정/모드 복사 (PC별 상태 파일 제외)"
# 제외: 소켓, 텔레메트리, 창 위치(모니터별), 열린 space/탭 상태(PC별 ID), 런타임 데이터
Mirror $src.AppHome (Join-Path $here "config\herdr-app") `
    -xf @('herdr-app.sock', 'window.json', 'view.json', 'update-notes.json', 'update-notes-cache.md') `
    -xd @('telemetry', 'data', 'update-notes-media')

Write-Host "3/4 herdr-core 설정(템플릿, config.toml) 복사"
$coreOut = Join-Path $here "config\herdr-core"
if (Test-Path $src.CoreConf) { Mirror $src.CoreConf $coreOut } else { New-Item -ItemType Directory -Force $coreOut | Out-Null }

Write-Host "4/4 Claude Code 전역 CLAUDE.md의 herdr 섹션 추출"
$claudeOut = Join-Path $here "config\claude"
New-Item -ItemType Directory -Force $claudeOut | Out-Null
if (Test-Path $src.ClaudeMd) {
    $lines = Get-Content -Encoding UTF8 $src.ClaudeMd
    $start = ($lines | Select-String -Pattern '^# herdr' | Select-Object -First 1).LineNumber
    if ($start) {
        $end = $lines.Count
        for ($i = $start; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^# ') { $end = $i; break } }
        $section = ($lines[($start - 1)..($end - 1)] -join "`r`n").TrimEnd() + "`r`n"
        [IO.File]::WriteAllText((Join-Path $claudeOut "CLAUDE.herdr.md"), $section, (New-Object Text.UTF8Encoding $false))
    } else { Write-Warning "CLAUDE.md에 '# herdr' 섹션이 없습니다." }
}

# 버전/해시 기록
function Ver($exe) { try { ((& $exe --version) 2>$null | Select-Object -First 1).ToString().Trim() } catch { "unknown" } }
function Sha($p) {
    $s = [IO.File]::OpenRead($p)
    try { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($s) | ForEach-Object { $_.ToString("x2") }) } finally { $s.Close() }
}
$manifest = [ordered]@{
    exported_at   = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    exported_from = $env:COMPUTERNAME
    herdr_app     = "herdr-app " + (Get-Item (Join-Path $here "programs\herdr-app\herdr-app.exe")).VersionInfo.ProductVersion
    herdr_core    = Ver (Join-Path $here "programs\herdr-core\hc.exe")
    sha256        = [ordered]@{
        "programs/herdr-app/herdr-app.exe"   = Sha (Join-Path $here "programs\herdr-app\herdr-app.exe")
        "programs/herdr-core/herdr-core.exe" = Sha (Join-Path $here "programs\herdr-core\herdr-core.exe")
        "programs/herdr-core/hc.exe"         = Sha (Join-Path $here "programs\herdr-core\hc.exe")
    }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $here "manifest.json")

Write-Host ""
Write-Host "완료: $here"
Write-Host "  herdr-app  $($manifest.herdr_app)"
Write-Host "  herdr-core $($manifest.herdr_core)"
