# Building Claude Pulse

This guide shows how to build Claude Pulse from source into a standalone Windows `.exe` that end users can run without Python or Node.js installed.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| [Node.js](https://nodejs.org/) | 18+ (LTS) | Electron build tooling |
| [Python](https://www.python.org/downloads/) | 3.8+ | Proxy source + PyInstaller |
| [PyInstaller](https://pyinstaller.org/) | any | Compiles `proxy.py` into `proxy.exe` |

Install PyInstaller after Python:
```cmd
pip install pyinstaller
```

> **Important:** During Python installation, check **"Add Python to PATH"**. During Node install, accept defaults.

### Windows Developer Mode (required for first build)

`electron-builder` unpacks an archive that contains macOS symlinks. Windows rejects these unless Developer Mode is on:

1. **Settings** → **Privacy & security** → **For developers**
2. Turn on **Developer Mode**
3. Confirm the warning dialog

You only need to do this once, on your build machine. End users don't need it.

## First-time setup

```cmd
git clone https://github.com/Philip8891/claude-pulse.git
cd claude-pulse
npm install
```

## Dev mode (fast iteration)

Use this while working on code changes:

```cmd
npm start
```

This runs Electron directly and spawns `python proxy.py`. Changes in `widget.html` take effect on reload (`Ctrl+Shift+R` while the widget is focused).

## Production build

```cmd
npm run build:installer
```

Takes 2–5 minutes. Output lands in `release/`:

```
release/
├── Claude Pulse-Setup-1.0.0.exe       ~100 MB  NSIS installer
├── Claude Pulse-Portable-1.0.0.exe    ~100 MB  Portable, no install
├── Claude Pulse-Setup-1.0.0.exe.blockmap
└── win-unpacked/                       (development output, not shipped)
```

### What the build does

1. **Clean** — removes `build/`, `dist/`, `proxy.spec`
2. **PyInstaller** — `proxy.py` → `dist/proxy.exe` (~8 MB)
3. **Copy helper** — `dist/proxy.exe` → `dist-proxy/proxy.exe` (so electron-builder can find it)
4. **electron-builder** — bundles Electron runtime + `proxy.exe` + `widget.html` + icons into portable + installer `.exe` files

### What the end user gets

A single `.exe` that:
- Installs to `%LOCALAPPDATA%\Programs\Claude Pulse\` (per-user, no admin needed)
- Creates Start menu + desktop shortcut
- Contains the full Electron runtime + `proxy.exe` + all resources
- **Requires nothing else** on the target machine — no Python, no Node.js

## Troubleshooting

### `pyinstaller is not recognized`

Either install it:
```cmd
pip install pyinstaller
```

Or if already installed but not on PATH, use the module form (already configured in `package.json`):
```cmd
python -m PyInstaller --version
```

### `Cannot create symbolic link` during electron-builder

Windows Developer Mode isn't on. See [prerequisites](#windows-developer-mode-required-for-first-build).

Alternatively, run the build once from an **Administrator** command prompt.

### `cannot resolve github.com ... status code 504`

Transient GitHub error — `electron-builder` is trying to download the Electron runtime. Retry:
```cmd
npx electron-builder --win --x64
```

If it persists, use a mirror:
```cmd
set ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
npx electron-builder --win --x64
```

### Windows Defender flags the output

PyInstaller-built `.exe` files sometimes trigger heuristic detection. Workarounds:

- Add an exclusion for your build folder during development
- For distribution: code-sign the binary (requires a code signing certificate, ~$200–400/year)
- Or submit the build to Microsoft for analysis if you get many reports

### Build runs out of disk space

The build produces ~2 GB of intermediate files (`node_modules` + Electron cache + PyInstaller output). Make sure you have **at least 5 GB** free on your build drive.

## Cleaning up

```cmd
:: Remove all build artifacts
rimraf release dist dist-proxy build proxy.spec

:: Nuclear option: remove node_modules too
rimraf release dist dist-proxy build proxy.spec node_modules
```

## Release checklist

Before cutting a release:

1. Bump version in `package.json` (`"version": "1.0.1"`)
2. Test in dev mode: `npm start`
3. Build: `npm run build:installer`
4. Test the portable `.exe` in a fresh user account (or on a clean VM)
5. Create a GitHub release, attach both `Claude Pulse-Setup-*.exe` and `Claude Pulse-Portable-*.exe`
6. Include release notes (features, fixes, breaking changes)
