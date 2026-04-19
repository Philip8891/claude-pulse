# GitHub Publication Guide

Step-by-step instructions to publish Claude Pulse on GitHub.

## Prerequisites

- GitHub account (create at https://github.com/signup if you don't have one)
- [Git for Windows](https://git-scm.com/download/win) installed — check with `git --version` in CMD

---

## Step 1: Replace `YOUR_USER` in README

The README currently has `YOUR_USER` placeholders for your GitHub username. Replace them:

```cmd
cd C:\claude-pulse

:: Replace with your actual GitHub username (example: "laszlofulop")
powershell -Command "(Get-Content README.md) -replace 'YOUR_USER', 'laszlofulop' | Set-Content README.md"
powershell -Command "(Get-Content BUILD.md) -replace 'YOUR_USER', 'laszlofulop' | Set-Content BUILD.md"
powershell -Command "(Get-Content CONTRIBUTING.md) -replace 'YOUR_USER', 'laszlofulop' | Set-Content CONTRIBUTING.md"
```

Verify: open the files in Notepad and grep for "YOUR_USER" — should return nothing.

## Step 2: Create GitHub repository

1. Go to https://github.com/new
2. Repository name: **`claude-pulse`**
3. Description: **`Your Claude usage, at a glance. A beautiful Windows tray widget.`**
4. Public
5. **Don't** check "Add a README file" (we have one)
6. **Don't** check "Add .gitignore" (we have one)
7. License: **None** (we have one)
8. Click **Create repository**

GitHub will show a page with commands. **Don't run them yet** — we'll use modified versions below.

## Step 3: Initialize git locally

```cmd
cd C:\claude-pulse

git init
git add .
git status
```

The `git status` should show all your source files. Verify:
- ✅ `main.js`, `preload.js`, `proxy.py`, `widget.html`, `package.json`, etc.
- ✅ `README.md`, `BUILD.md`, `CONTRIBUTING.md`, `LICENSE`
- ✅ `icon.png`, `icon.ico`
- ❌ **No** `node_modules/`, `dist/`, `dist-proxy/`, `release/`, `build/` (these are in `.gitignore`)

If build folders show up, delete them first:
```cmd
rimraf dist dist-proxy release build
```

## Step 4: First commit

Configure git (first time only):
```cmd
git config --global user.name "László Fülöp"
git config --global user.email "your@email.com"
```

Then:
```cmd
git commit -m "Initial release: Claude Pulse v1.0"
git branch -M main
```

## Step 5: Push to GitHub

Replace `YOUR_USER` with your actual username:
```cmd
git remote add origin https://github.com/YOUR_USER/claude-pulse.git
git push -u origin main
```

GitHub will prompt for credentials. You need a **Personal Access Token** (not your password):

### Creating a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**
3. Note: "Claude Pulse"
4. Expiration: 90 days (or whatever you prefer)
5. Scopes: check **`repo`** (full control of repositories)
6. Click **Generate token**
7. **Copy the token immediately** (you can't view it again)

When git asks for password, paste the token.

## Step 6: Create a release with binaries

1. Go to https://github.com/YOUR_USER/claude-pulse/releases
2. Click **Draft a new release**
3. **Choose a tag**: type `v1.0.0`, click **Create new tag: v1.0.0 on publish**
4. **Release title**: `v1.0.0 — Initial release`
5. **Description** — use this template:

```markdown
## Claude Pulse v1.0.0

First public release of Claude Pulse — a real-time Claude AI usage widget for the Windows system tray.

### Features

- ⚡ Real-time monitoring (session, weekly, monthly)
- 🔐 One-click Claude login (no DevTools copy-paste)
- 👥 Multi-profile support
- 🎨 5 themes × light/dark
- 📊 7-day history graph
- 🔔 Usage alerts at 75%, 90%, 95%
- 💻 Keyboard shortcuts (Ctrl+Shift+C / Ctrl+Shift+R)
- 🚀 Start with Windows option

### Download

- **`Claude-Pulse-Setup-1.0.0.exe`** — NSIS installer (recommended)
- **`Claude-Pulse-Portable-1.0.0.exe`** — portable, no install needed

Both are ~100 MB and require no external dependencies (no Python, no Node.js).

### Install

Run the installer. Tray icon appears. First launch opens a welcome screen with a Log in with Claude button.

### Known issues

See [CONTRIBUTING.md → Bug hunt](CONTRIBUTING.md) for current quirks.

### Note

Unsigned binary — Windows SmartScreen may warn you. Click **More info** → **Run anyway**. Code signing is planned for a future release.
```

6. **Attach binaries**:
   - Click **Attach binaries by dropping them here or selecting them**
   - Upload both files from `C:\claude-pulse\release\`:
     - `Claude Pulse-Setup-1.0.0.exe`
     - `Claude Pulse-Portable-1.0.0.exe`

7. Click **Publish release**

## Step 7: Add screenshots to the repo

Without screenshots, the README looks bare. Take some:

### Screenshots to capture

1. **Main widget** (default copper theme, light) — hover tray, press Print Screen
2. **Dark mode** (same widget but dark)
3. **Compact mode** — minimal donut
4. **Settings modal — About tab** with autostart toggle
5. **Welcome screen** (first-run)
6. **All 5 themes** side by side (optional)

### Tools

- **Win+Shift+S** — Windows Snipping Tool (saves to clipboard, paste into paint)
- **Greenshot** (free) — https://getgreenshot.org/ — easier multi-capture

### Add to repo

```cmd
cd C:\claude-pulse
mkdir assets
:: Copy your screenshots to assets\ with these names:
::   widget-light.png
::   widget-dark.png
::   widget-compact.png
::   settings-about.png
::   welcome.png

git add assets/
git commit -m "docs: add screenshots"
git push
```

## Step 8: Polish

### Repository settings

1. Go to your repo → **Settings** → **General**
2. **Topics** (right side, under About): add tags so people find it:
   - `claude`, `claude-ai`, `anthropic`, `usage-tracker`, `windows`, `electron`, `tray`, `widget`
3. **Website** (under About): leave empty or add a demo link later
4. **Features** → uncheck **Wikis** (you have docs in README)

### Branding in repo

The **social preview card** (what shows when someone shares the link):

1. Settings → **Social preview** → **Edit**
2. Upload a 1280×640 image with the Claude Pulse screenshot + tagline

### Pin the repo to your profile

1. Go to your GitHub profile page
2. Click **Customize your pins**
3. Select `claude-pulse`

---

## Step 9: Tell the world

Share on:

- **Hacker News** (Show HN): title: "Show HN: Claude Pulse – Windows tray widget for Claude usage"
- **r/ClaudeAI** on Reddit
- **Twitter / X** with screenshot
- **Mastodon / BlueSky** if you use them
- **Hungarian Facebook groups** if applicable

Template post:

> I built Claude Pulse — a tiny Windows tray widget that shows your Claude AI usage in real time. No more tab-hopping to claude.ai/settings/usage to check quota.
>
> - One-click login (no DevTools needed)
> - 5 themes × dark mode
> - Trend prediction
> - Multi-profile support
>
> Free & open source. Download: https://github.com/YOUR_USER/claude-pulse

## Troubleshooting

**`git push` fails with "Authentication failed"**
You're using password auth which GitHub removed. Use a Personal Access Token (step 5).

**Binary uploads timeout on GitHub release**
Large files (100 MB+) sometimes fail. Retry, or split into parts.

**Repo URL mismatch after rename**
```cmd
git remote set-url origin https://github.com/NEW_USER/claude-pulse.git
```

**Deleted a file but git still tracks it**
```cmd
git rm path/to/file
git commit -m "remove X"
git push
```
