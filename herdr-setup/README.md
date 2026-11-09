# Herdr 환경 이전 가이드

이 PC(`DESKTOP-QBA9ENH`)에 설치된 Herdr와 설정을 다른 Windows PC에 똑같이 설치하기 위한 묶음입니다.
설치 기준 버전은 `manifest.json`에 있습니다(현재 **herdr-app 0.1.14**, **herdr-core / hc 0.1.19**).

## 빠른 시작 (새 PC)

1. 이 `herdr-setup` 폴더를 새 PC로 복사합니다. git clone, USB, zip 어느 방법이든 됩니다.
2. Herdr 창이 열려 있으면 닫습니다.
3. `install.cmd`를 더블클릭합니다. 또는 PowerShell에서 아래처럼 실행합니다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
4. 새 터미널을 열고 시작 메뉴의 **Herdr**나 `herdr-app` 명령으로 실행합니다.

관리자 권한은 필요 없습니다. 모든 것이 사용자 폴더에 설치됩니다.

### 설치 옵션

| 명령 | 동작 |
|---|---|
| `install.ps1` | 묶어 둔 프로그램을 그대로 설치합니다(**같은 버전**, 인터넷 불필요). 그다음 설정을 적용합니다. |
| `install.ps1 -Online` | 공식 설치 스크립트로 **최신 버전**을 설치한 뒤 설정을 적용합니다. |
| `install.ps1 -ConfigOnly` | 프로그램은 그대로 두고 설정만 적용합니다(이미 Herdr가 설치된 PC용). |
| `install.ps1 -SkipClaude` | Claude Code의 `CLAUDE.md`는 건드리지 않습니다. |

기존 설정은 덮어쓰기 전에 `*.bak-YYYYMMDD-HHMMSS` 이름으로 백업됩니다.

## 사전 준비물 (새 PC에 먼저 설치)

| 프로그램 | 이 PC 버전 | 필요한 이유 | 설치 |
|---|---|---|---|
| Windows 10 1803+ x64 | Windows 11 Pro | Herdr는 x64만 지원 | — |
| Git for Windows | 2.55.0 | 터미널의 `sh`/`bash`, git-graph·changes·worktree 모드 | `winget install --id Git.Git -e` |
| Claude Code | 2.1.319 | `reviewer` 템플릿, claude-commander 모드 | `irm https://claude.ai/install.ps1 \| iex` |
| (선택) Node.js | v24.18.0 | 프로젝트 작업용 | `winget install OpenJS.NodeJS` |
| (선택) GitHub CLI | 2.96.0 | PR 작업용 | `winget install GitHub.cli` |
| (선택) ripgrep | 15.2.0 | 검색 | `winget install BurntSushi.ripgrep.MSVC` |

`install.ps1`은 Git과 Claude Code가 있는지 확인하고, 없으면 경고만 표시합니다.

## 폴더 구성

```
herdr-setup/
├─ README.md                 이 가이드
├─ install.ps1 / install.cmd 새 PC 설치
├─ export.ps1                원본 PC에서 묶음을 다시 만들기(업데이트용)
├─ manifest.json             버전, 원본 PC, exe SHA-256
├─ programs/
│  ├─ herdr-app/             → %LOCALAPPDATA%\Programs\herdr-app   (데스크톱 앱)
│  └─ herdr-core/            → %LOCALAPPDATA%\Programs\herdr-core  (hc.exe, herdr-core.exe, conpty)
└─ config/
   ├─ herdr-app/             → %USERPROFILE%\.config\herdr-app     (앱 설정·모드·테마·레이아웃·단축키)
   ├─ herdr-core/templates/  → %APPDATA%\herdr-core\templates      (hc 템플릿)
   └─ claude/CLAUDE.herdr.md → %USERPROFILE%\.claude\CLAUDE.md 끝에 추가
```

## 설치되는 항목 상세

### 1. 프로그램
- **herdr-app** (`herdr-app.exe`): 터미널과 에이전트를 space/tab/pane으로 배치하는 데스크톱 창입니다.
- **herdr-core** (`hc.exe` = `herdr-core.exe`, 두 파일은 같은 바이너리): 터미널을 살아 있게 유지하는 서버와 CLI입니다. `conpty\`는 Windows 콘솔 지원 파일입니다.
- 사용자 PATH에 두 폴더가 추가되고, 시작 메뉴에 `Herdr.lnk`가 만들어집니다. 공식 설치 스크립트와 같은 방식입니다.
- `C:\Program Files\Git\bin`이 사용자 PATH에 추가됩니다(원본 PC와 같게 하기 위해서이며, `sh`가 이미 있으면 건너뜁니다).

### 2. herdr-app 설정 (`~/.config/herdr-app`)
| 파일 | 내용 |
|---|---|
| `settings.json` | 줌 0.9, 다크 모드, 소리 켬, 합자 끔 |
| `keys.json` | 단축키 (Alt+1~9 space, Ctrl+1~9 tab, Alt+hjkl pane 이동, Ctrl+Shift+O/E 분할 등) |
| `shared.json` | 현재 레이아웃 `herdr-editor`, 작업 패널 `files`·`changes`, 사이드바 너비 268 |
| `layouts/` | `main`, `terminals`, `win98`, **`herdr-editor`(사용자 레이아웃)** |
| `themes/` | `atom-one-dark`, `win98` |
| `mods/` | 기본 모드와 **사용자가 추가한 모드 4개** (아래 표) |
| `installed.json` | 기본 모드의 해시. 앱이 업데이트할 때 기본 모드를 갱신하는 기준입니다 |

사용자가 추가한 모드:

| 모드 | 설명 |
|---|---|
| `claude-commander` | Claude Code 터미널 아래에 큰 입력창을 붙이는 패널입니다(github.com/anerjin/claude-commander를 이식). Ctrl+Enter로 전송합니다. |
| `explorer` | 오른쪽 파일 탐색기 패널(파일 작업, 메뉴) |
| `git-graph` | git 커밋 그래프 (github.com/rabeeh-ta/herdr-git-graph) |
| `herdr-editor` | 내장 에디터 (Ctrl+S 저장) |

### 3. herdr-core 템플릿 (`%APPDATA%\herdr-core\templates`)
- `reviewer.md`: 읽기 전용 코드 리뷰어입니다(`claude --model claude-opus-5-5 --disallowedTools Edit Write NotebookEdit`). 결과를 한국어로 부모 터미널에 `hc send`로 보고합니다.
  사용 예: `hc run --bg --name review --cwd <repo> reviewer "<범위>"`
- `config.toml`은 현재 없습니다(기본값 사용). 원본 PC에서 만들면 `export.ps1`이 함께 가져옵니다.

### 4. Claude Code 연동
`~/.claude/CLAUDE.md`에 `# herdr (hc)` 섹션을 추가합니다. Claude Code가 hc 터미널로 느린 명령을 실행하는 규칙, 템플릿 위치, 서버 중지 금지 같은 내용입니다. 이미 섹션이 있으면 건너뜁니다.

## 옮기지 않는 것 (PC마다 다른 것)

| 항목 | 이유 |
|---|---|
| `%LOCALAPPDATA%\herdr-core\default\` (core.json, terminals.json, screens, docs.json) | core ID·machine ID, 실행 중인 터미널, 열린 space입니다. 새 PC에서는 새로 생성됩니다. |
| `~/.config/herdr-app`의 `window.json`, `view.json`, `data/`, `telemetry/`, `herdr-app.sock` | 창 위치(모니터별), 열린 탭 상태, 런타임 데이터 |
| space 구성 (예: `vibecode` → `D:/github/private_project_vibecode`) | 폴더 경로가 PC마다 다릅니다. 새 PC에서 Ctrl+Shift+N으로 다시 만드세요. |
| `hc machine` 원격 머신 목록 | 현재 등록된 머신이 없습니다 |

## 원본 PC에서 묶음 갱신하기

Herdr를 업데이트했거나 모드·단축키·테마를 바꿨으면 원본 PC에서 아래 명령을 다시 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\export.ps1
```

이 명령은 읽기만 합니다. 실행 중인 Herdr나 터미널에는 영향이 없습니다. `programs/`, `config/`, `manifest.json`이 최신 상태로 덮어써집니다.

## 설치 후 확인

```powershell
hc --version            # hc 0.1.19
herdr-app --version     # herdr-app 0.1.14 (콘솔에 안 보이면 cmd /c "herdr-app --version")
hc templates            # reviewer
hc server status        # 앱을 한 번 연 뒤 core가 떠 있는지
```

## 문제 해결

- **"Herdr가 실행 중입니다"**: 앱 창을 닫습니다. 살려 둘 터미널이 없으면 `hc server stop`을 실행한 뒤 다시 설치합니다(실행 중인 exe는 덮어쓸 수 없습니다).
- **`hc`를 찾을 수 없음**: PATH 변경은 새로 연 터미널에서만 적용됩니다. 터미널을 다시 여세요.
- **`holder: cannot start "sh"`**: Git for Windows를 설치한 뒤 `install.ps1 -ConfigOnly`를 다시 실행하거나, `C:\Program Files\Git\bin`을 PATH에 추가합니다.
- **최신 버전으로 올리기**: 설치 후 `hc update`를 실행하거나 앱의 업데이트 알림을 따릅니다. 처음부터 최신 버전을 원하면 `install.ps1 -Online`을 씁니다.
- **git에 올릴 때**: `programs/herdr-app/herdr-app.exe`는 약 62MB입니다. GitHub 파일 한도(100MB)보다 작지만 50MB가 넘어서 경고가 표시됩니다. 바이너리를 저장소에 두기 싫으면 `programs/`를 `.gitignore`에 넣고 새 PC에서 `-Online`으로 설치하세요.
