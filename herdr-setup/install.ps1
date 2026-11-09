# 새 PC에 Herdr(herdr-app + herdr-core)와 이 폴더에 묶어 둔 설정을 그대로 설치합니다.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1            # 묶어 둔 프로그램으로 설치(오프라인, 같은 버전)
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Online    # 공식 설치 스크립트로 최신 버전 설치 + 설정 적용
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ConfigOnly  # 프로그램은 두고 설정만 적용
#
# 관리자 권한이 필요 없습니다(모두 사용자 폴더에 설치). 기존 설정은 덮어쓰기 전에 *.bak-<시각> 으로 백업합니다.

param(
    [switch]$Online,
    [switch]$ConfigOnly,
    [switch]$SkipClaude
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

$dst = @{
    App      = Join-Path $env:LOCALAPPDATA "Programs\herdr-app"
    Core     = Join-Path $env:LOCALAPPDATA "Programs\herdr-core"
    AppHome  = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE ".config\herdr-app" }
    CoreConf = Join-Path $env:APPDATA "herdr-core"
    ClaudeMd = Join-Path $env:USERPROFILE ".claude\CLAUDE.md"
}

function Step($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

function Copy-Tree($from, $to) {
    New-Item -ItemType Directory -Force $to | Out-Null
    & robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "복사 실패 ($LASTEXITCODE): $from -> $to" }
}

function Add-UserPath($dir) {
    if (-not (Test-Path $dir)) { return }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
    try {
        $raw = [string]$key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $listed = $raw -split ";" | Where-Object { $_.Trim().TrimEnd("\") -ieq $dir.TrimEnd("\") }
        if ($listed) { Ok "PATH에 이미 있음: $dir"; return }
        $kind = if ($key.GetValueNames() -contains "Path") { $key.GetValueKind("Path") } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        $key.SetValue("Path", $(if ($raw) { "$($raw.TrimEnd(';'));$dir" } else { $dir }), $kind)
        Ok "사용자 PATH에 추가: $dir"
    } finally { $key.Close() }
    if (($env:Path -split ";") -notcontains $dir) { $env:Path += ";$dir" }
    $script:pathChanged = $true
}

# ---------------------------------------------------------------- 0. 사전 점검
Step "사전 점검"
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne "AMD64") { throw "Herdr는 Windows x64만 지원합니다 (현재: $arch)" }
Ok "Windows x64"

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Ok "Git: $((& git --version) 2>$null)" }
else { Warn "Git for Windows가 없습니다. 설치 권장: winget install --id Git.Git -e" }

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) { Ok "Claude Code: $((& claude --version) 2>$null)" }
else { Warn "Claude Code가 없습니다. reviewer 템플릿/claude-commander 모드에 필요합니다. 설치: irm https://claude.ai/install.ps1 | iex" }

$running = Get-Process herdr-app, herdr-core, hc -ErrorAction SilentlyContinue
if ($running -and -not $ConfigOnly) {
    $names = ($running | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
    throw "Herdr가 실행 중입니다 ($names). 앱 창을 닫고, 실행 중인 터미널이 없다면 'hc server stop' 후 다시 실행하세요."
}

# ---------------------------------------------------------------- 1. 프로그램
if (-not $ConfigOnly) {
    if ($Online) {
        Step "공식 설치 스크립트로 최신 Herdr 설치"
        Invoke-RestMethod "https://releases.herdr.dev/app/install.ps1" | Invoke-Expression
    } else {
        Step "묶어 둔 프로그램 설치 (오프라인)"
        foreach ($p in 'herdr-app', 'herdr-core') {
            $from = Join-Path $here "programs\$p"
            if (-not (Test-Path $from)) { throw "programs\$p 가 없습니다. 원본 PC에서 export.ps1을 먼저 실행하거나 -Online 을 쓰세요." }
        }
        foreach ($k in 'App', 'Core') {
            $to = $dst[$k]
            if (Test-Path $to) {
                Remove-Item -Recurse -Force "$to.old" -ErrorAction SilentlyContinue
                Rename-Item $to "$to.old"
            }
            Copy-Tree (Join-Path $here ("programs\" + (Split-Path $to -Leaf))) $to
            Remove-Item -Recurse -Force "$to.old" -ErrorAction SilentlyContinue
            # USB/zip/다운로드로 옮긴 파일의 '인터넷에서 받은 파일' 표시 제거
            Get-ChildItem -Recurse -File $to | Unblock-File
            Ok "설치: $to"
        }

        # 해시 확인
        $mf = Join-Path $here "manifest.json"
        if (Test-Path $mf) {
            $m = Get-Content -Raw -Encoding UTF8 $mf | ConvertFrom-Json
            foreach ($prop in $m.sha256.PSObject.Properties) {
                $rel = $prop.Name -replace '^programs/', '' -replace '/', '\'
                $file = Join-Path (Split-Path $dst.App) $rel
                $s = [IO.File]::OpenRead($file)
                try { $got = -join ([Security.Cryptography.SHA256]::Create().ComputeHash($s) | ForEach-Object { $_.ToString("x2") }) } finally { $s.Close() }
                if ($got -ne $prop.Value) { throw "체크섬 불일치: $file (복사 중 손상)" }
            }
            Ok "체크섬 일치 (herdr-app $($m.herdr_app), $($m.herdr_core))"
        }

        Step "PATH / 시작 메뉴"
        Add-UserPath $dst.App
        Add-UserPath $dst.Core

        $menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Herdr.lnk"
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($menu)
        $link.TargetPath = Join-Path $dst.App "herdr-app.exe"
        $link.WorkingDirectory = $env:USERPROFILE
        $link.Description = "Terminals and coding agents that keep running"
        $link.Save()
        Ok "시작 메뉴 바로가기: $menu"
    }

    # 원본 PC처럼 Git의 sh/bash를 PATH에 둡니다 (터미널에서 'sh' 실행용)
    $gitBin = Join-Path $env:ProgramFiles "Git\bin"
    if ((Test-Path "$gitBin\sh.exe") -and -not (Get-Command sh -ErrorAction SilentlyContinue)) { Add-UserPath $gitBin }

    if ($script:pathChanged) {
        # 실행 중인 프로그램에 환경변수 변경을 알림
        [Environment]::SetEnvironmentVariable("HERDR_INSTALLING", "1", "User")
        [Environment]::SetEnvironmentVariable("HERDR_INSTALLING", $null, "User")
    }
}

# ---------------------------------------------------------------- 2. 설정
Step "herdr-app 설정/모드/테마/레이아웃/단축키"
$appCfg = Join-Path $here "config\herdr-app"
if (Test-Path $dst.AppHome) {
    $bak = "$($dst.AppHome).bak-$stamp"
    Copy-Tree $dst.AppHome $bak
    Ok "기존 설정 백업: $bak"
}
Copy-Tree $appCfg $dst.AppHome
Ok "적용: $($dst.AppHome)"

Step "herdr-core 템플릿/설정"
$coreCfg = Join-Path $here "config\herdr-core"
if ((Test-Path $dst.CoreConf) -and (Get-ChildItem -Recurse -File $dst.CoreConf -ErrorAction SilentlyContinue)) {
    $bak = "$($dst.CoreConf).bak-$stamp"
    Copy-Tree $dst.CoreConf $bak
    Ok "기존 설정 백업: $bak"
}
Copy-Tree $coreCfg $dst.CoreConf
Ok "적용: $($dst.CoreConf)"

if (-not $SkipClaude) {
    Step "Claude Code 전역 CLAUDE.md에 herdr 안내 추가"
    $section = Join-Path $here "config\claude\CLAUDE.herdr.md"
    if (Test-Path $section) {
        New-Item -ItemType Directory -Force (Split-Path $dst.ClaudeMd) | Out-Null
        $existing = if (Test-Path $dst.ClaudeMd) { Get-Content -Raw -Encoding UTF8 $dst.ClaudeMd } else { "" }
        if ($existing -match '(?m)^# herdr') {
            Ok "이미 herdr 섹션이 있어 건너뜀: $($dst.ClaudeMd)"
        } else {
            if (Test-Path $dst.ClaudeMd) { Copy-Item $dst.ClaudeMd "$($dst.ClaudeMd).bak-$stamp" }
            $add = Get-Content -Raw -Encoding UTF8 $section
            $text = if ($existing.Trim()) { $existing.TrimEnd() + "`r`n`r`n" + $add } else { $add }
            [IO.File]::WriteAllText($dst.ClaudeMd, $text, (New-Object Text.UTF8Encoding $false))
            Ok "추가: $($dst.ClaudeMd)"
        }
    }
}

# ---------------------------------------------------------------- 3. 확인
Step "설치 확인"
$hc = Join-Path $dst.Core "hc.exe"
$app = Join-Path $dst.App "herdr-app.exe"
if (Test-Path $hc)  { Ok ((& $hc --version) 2>$null) } else { Warn "hc.exe 없음: $hc" }
if (Test-Path $app) { Ok ("herdr-app " + (Get-Item $app).VersionInfo.ProductVersion) } else { Warn "herdr-app.exe 없음: $app" }
if (Test-Path $hc)  { Ok ("templates: " + ((& $hc templates --json | ConvertFrom-Json).templates.name -join ", ")) }

Write-Host ""
Write-Host "완료. 새 터미널을 열어 PATH를 반영한 뒤, 시작 메뉴의 'Herdr' 또는 'herdr-app' 으로 실행하세요." -ForegroundColor Green
