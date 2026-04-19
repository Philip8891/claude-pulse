# Contributing to Claude Pulse

Thanks for considering contributing! This is a small, focused project. Anyone is welcome to report issues, suggest features, or submit pull requests.

## Bug hunt 🐛

Claude Pulse ships with **known quirks** that haven't been tracked down yet. Finding a repro and/or submitting a fix is a great first contribution.

**Known issues** (help wanted):

- **Tray icon rendering glitch** — on some Windows 11 systems the tray icon renders at a slight offset / partially transparent. Reproducible with transparent PNG icons in `nativeImage`. Might be an Electron + Windows DPI scaling issue.
- **Widget flicker on fast hover-leave** — when cursor crosses the tray area quickly, the widget can briefly show and hide in a stutter.
- **Port 8787 conflict** — if another app is using port 8787 there's no user-facing error, widget just stays on "offline".
- **History graph rendering with only 1 data point** — first 5 minutes after fresh install the graph shows empty state correctly, but transition to 2+ points could be smoother.

Found a new one? **Open an issue** with:
- Windows version (`winver`)
- Claude Pulse version
- Steps to reproduce
- Expected vs actual behavior
- Screenshot/GIF if visual

## Development setup

```cmd
git clone https://github.com/Philip8891/claude-pulse.git
cd claude-pulse
npm install
npm start
```

Requires Node.js 18+ and Python 3.8+. See [BUILD.md](BUILD.md) for full build.

## Code style

- No build step for `widget.html` — keep it vanilla HTML/CSS/JS
- Electron main: ES2020 style (no TypeScript)
- Python proxy: stdlib only, no pip dependencies beyond PyInstaller
- Indent: 2 spaces for JS/HTML/CSS, 4 spaces for Python

## What we probably won't merge

- Dependencies that increase bundle size meaningfully (say 5 MB+)
- Telemetry, analytics, remote logging — privacy-first is the whole point
- Features that require changing the proxy/widget protocol incompatibly
- Obvious scope creep (e.g. chat with Claude from the widget)

## Anything not covered here

Open an issue, ask. No dumb questions.
