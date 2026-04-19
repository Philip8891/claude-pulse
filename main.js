const { app, BrowserWindow, Tray, nativeImage, screen, Menu, shell, Notification, ipcMain, globalShortcut, session } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

app.disableHardwareAcceleration();
app.setPath("userData", path.join(os.tmpdir(), "claude-pulse-data"));
app.setAppUserModelId("com.claude.pulse");

const SETTINGS_DIR = path.join(os.homedir(), ".claude-pulse");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (e) {}
  return {};
}
function saveSettings(s) {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
  } catch (e) {}
}

let settings = loadSettings();

const INITIAL_SIZE = { width: 290, height: 560 };
const MAX_WIDTH = 320;
const MAX_HEIGHT = 700;

let tray = null;
let popup = null;
let proxy = null;
let loginWin = null;
let pinned = false;
let hideTimer = null;
let alertsTimer = null;
let currentWidth = INITIAL_SIZE.width;
let currentHeight = INITIAL_SIZE.height;

function log(...a) { console.log("[claude-pulse]", ...a); }

// ── PROXY LAUNCHER (dev vs prod) ─────────
function resolveProxyPath() {
  // Packaged (production): proxy.exe shipped as extra resource
  // process.resourcesPath = ".../resources" when packaged
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, "proxy.exe");
    if (fs.existsSync(exePath)) {
      return { cmd: exePath, args: [], cwd: process.resourcesPath };
    }
    log("WARNING: proxy.exe not found in", process.resourcesPath);
  }
  // Dev: run proxy.py with system python
  const pyPath = path.join(__dirname, "proxy.py");
  return { cmd: "python", args: [pyPath], cwd: __dirname };
}

function resolveWidgetDir() {
  // proxy needs to know where widget.html is (reads from same dir as exe/py)
  return app.isPackaged ? process.resourcesPath : __dirname;
}

function startProxy() {
  const { cmd, args, cwd } = resolveProxyPath();
  log("Starting proxy:", cmd, args.join(" "));
  try {
    proxy = spawn(cmd, args, {
      windowsHide: true,
      cwd: cwd,
      env: { ...process.env, CLAUDE_PULSE_WIDGET_DIR: resolveWidgetDir() },
    });
    proxy.stdout.on("data", d => log("[proxy]", d.toString().trim()));
    proxy.stderr.on("data", d => log("[proxy err]", d.toString().trim()));
    proxy.on("error", e => log("[proxy spawn err]", e.message));
    proxy.on("exit", code => log("[proxy exit]", code));
  } catch (e) {
    log("Proxy spawn failed:", e.message);
  }
}

function waitForProxy(callback, tries = 0) {
  const req = http.get("http://localhost:8787/usage", (res) => {
    res.resume(); callback();
  });
  req.on("error", () => {
    if (tries > 40) { log("Proxy never started!"); callback(); return; }
    setTimeout(() => waitForProxy(callback, tries + 1), 500);
  });
  req.setTimeout(1000, () => req.destroy());
}

function createPopup() {
  popup = new BrowserWindow({
    width: INITIAL_SIZE.width, height: INITIAL_SIZE.height,
    frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true,
    show: false, backgroundColor: "#EDD5BF",
    useContentSize: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  popup.loadURL("http://localhost:8787/");
  popup.webContents.on("did-fail-load", () => {
    setTimeout(() => popup.loadURL("http://localhost:8787/"), 2000);
  });

  popup.on("blur", () => { if (!pinned) hidePopup(); });
  popup.on("moved", () => {
    if (!popup || popup.isDestroyed()) return;
    const [x, y] = popup.getPosition();
    settings.windowPos = { x, y };
    saveSettings(settings);
  });
}

function setDynamicSize(w, h) {
  if (!popup || popup.isDestroyed()) return;
  w = Math.max(180, Math.min(MAX_WIDTH, Math.round(w)));
  h = Math.max(100, Math.min(MAX_HEIGHT, Math.round(h)));
  if (w === currentWidth && h === currentHeight) return;
  currentWidth = w;
  currentHeight = h;
  popup.setContentSize(w, h);
  positionPopup();
}

function positionPopup() {
  const w = currentWidth, h = currentHeight;

  if (settings.windowPos) {
    const displays = screen.getAllDisplays();
    const { x, y } = settings.windowPos;
    const valid = displays.some(d => {
      const wa = d.workArea;
      return x >= wa.x - 50 && x < wa.x + wa.width - 50
          && y >= wa.y - 50 && y < wa.y + wa.height - 50;
    });
    if (valid) {
      let fx = x, fy = y;
      const displays2 = screen.getAllDisplays();
      const d = displays2.find(dd =>
        x >= dd.workArea.x - 50 && x < dd.workArea.x + dd.workArea.width - 50
      ) || displays2[0];
      const wa = d.workArea;
      if (fy + h > wa.y + wa.height) fy = wa.y + wa.height - h - 8;
      if (fx + w > wa.x + wa.width) fx = wa.x + wa.width - w - 8;
      popup.setPosition(fx, fy);
      return;
    }
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;
  const x = workArea.x + workArea.width - w - 8;
  const y = workArea.y + workArea.height - h - 150;
  popup.setPosition(x, y);
}

function showPopup() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  positionPopup();
  popup.showInactive();
}
function hidePopup() { pinned = false; popup.hide(); }
function togglePopup() {
  if (!popup || popup.isDestroyed()) return;
  if (popup.isVisible()) hidePopup();
  else { showPopup(); pinned = true; popup.focus(); }
}
function togglePin() { pinned = !pinned; if (pinned) popup.focus(); }

function notify(title, body, urgency = "normal") {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: urgency === "low", urgency });
  n.on("click", () => { showPopup(); pinned = true; });
  n.show();
}

function pollAlerts() {
  const req = http.get("http://localhost:8787/alerts", (res) => {
    let body = "";
    res.on("data", d => body += d);
    res.on("end", () => {
      try {
        const { alerts } = JSON.parse(body);
        if (alerts && alerts.length) {
          alerts.forEach(a => {
            if (a.type === "reset") notify("Claude session reset", "Session reset – you can use it again!");
            else if (a.type === "threshold") notify(`Claude ${a.level}%+`, "Session limit approaching!", a.level >= 95 ? "critical" : "normal");
            else if (a.type === "session_expired") notify("Claude session expired", "Click widget to update", "critical");
          });
        }
      } catch (e) {}
    });
  });
  req.on("error", () => {});
  req.setTimeout(2000, () => req.destroy());
}

function sendLoginStatus(status) {
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send("login-status", status);
  }
}

function openLoginWindow(profileName = "Personal") {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  const loginSession = session.fromPartition("persist:claude-login");
  loginWin = new BrowserWindow({
    width: 1000, height: 750,
    title: "Claude Login - log in to your account, cookies will be captured automatically",
    backgroundColor: "#1a1310",
    autoHideMenuBar: true,
    webPreferences: {
      session: loginSession,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  loginWin.loadURL("https://claude.ai/login");
  sendLoginStatus({ phase: "waiting", message: "Log in to Claude in the opened window..." });

  let captured = false;
  const checkCookies = async () => {
    if (captured) return true;
    try {
      const cookies = await loginSession.cookies.get({ domain: ".claude.ai" });
      const sk = cookies.find(c => c.name === "sessionKey");
      if (!sk || !sk.value) return false;
      sendLoginStatus({ phase: "verifying", message: "Session cookie found, verifying..." });
      const orgs = await new Promise((resolve) => {
        const req = https.get("https://claude.ai/api/organizations", {
          headers: {
            Cookie: `sessionKey=${sk.value}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
          },
        }, (res) => {
          let data = "";
          res.on("data", d => data += d);
          res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on("error", () => resolve(null));
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
      });
      if (orgs && Array.isArray(orgs) && orgs.length > 0) {
        captured = true;
        const org = orgs[0];
        sendLoginStatus({ phase: "saving", message: `Saving profile for "${org.name || "account"}"...` });
        await saveProfileToProxy({
          name: profileName, sessionCookie: sk.value, orgId: org.uuid, cfClearance: "",
        });
        sendLoginStatus({ phase: "success", message: "Logged in successfully!", orgName: org.name || "Personal" });
        notify("Claude Pulse", `Logged in as ${org.name || "Personal"}`);
        setTimeout(() => {
          if (loginWin && !loginWin.isDestroyed()) loginWin.close();
          loginWin = null;
          if (popup) popup.loadURL("http://localhost:8787/");
        }, 1500);
        return true;
      }
    } catch (e) { log("Cookie check err:", e.message); }
    return false;
  };

  const checkInterval = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) { clearInterval(checkInterval); return; }
    const ok = await checkCookies();
    if (ok) clearInterval(checkInterval);
  }, 1500);
  loginWin.on("closed", () => {
    clearInterval(checkInterval);
    if (!captured) sendLoginStatus({ phase: "cancelled", message: "Login window closed before completion" });
    loginWin = null;
  });
}

function saveProfileToProxy(profile) {
  return new Promise((resolve) => {
    const data = JSON.stringify(profile);
    const req = http.request({
      hostname: "localhost", port: 8787, path: "/config/profile", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => { res.resume(); res.on("end", resolve); });
    req.on("error", resolve); req.write(data); req.end();
  });
}

ipcMain.on("hide-window", () => hidePopup());
ipcMain.on("resize-to", (event, { width, height }) => setDynamicSize(width, height));
ipcMain.on("start-auto-login", (event, { profileName }) => openLoginWindow(profileName || "Personal"));

// ── AUTOSTART ─────────
// We use TWO methods on Windows for maximum reliability:
//   1. Electron's setLoginItemSettings (writes to HKCU\...\Run)
//   2. A .lnk file in the Startup folder (works even when registry is denied)
// Both are toggled together. To detect "enabled", either is enough.

const STARTUP_LNK_NAME = "Claude Pulse.lnk";

function startupLnkPath() {
  return path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_LNK_NAME);
}

function autostartStatus() {
  let registryOn = false;
  try { registryOn = !!app.getLoginItemSettings().openAtLogin; } catch(e) {}
  let shortcutOn = false;
  try { shortcutOn = fs.existsSync(startupLnkPath()); } catch(e) {}
  return { registry: registryOn, shortcut: shortcutOn, enabled: registryOn || shortcutOn };
}

function setAutostart(enabled) {
  const result = { registry: { ok: false }, shortcut: { ok: false } };

  // Method 1: Registry via Electron API
  try {
    if (enabled) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ["--hidden"],
      });
    } else {
      app.setLoginItemSettings({ openAtLogin: false });
    }
    result.registry.ok = true;
  } catch (e) {
    result.registry.error = e.message;
    log("autostart registry err:", e.message);
  }

  // Method 2: Startup folder .lnk
  const lnkPath = startupLnkPath();
  try {
    if (enabled) {
      // Make sure parent dir exists
      const parent = path.dirname(lnkPath);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      const ok = shell.writeShortcutLink(lnkPath, "create", {
        target: process.execPath,
        args: "--hidden",
        appUserModelId: "com.claude.pulse",
        description: "Claude Pulse - Your Claude usage, at a glance",
      });
      result.shortcut.ok = ok;
      if (!ok) result.shortcut.error = "writeShortcutLink returned false";
    } else {
      if (fs.existsSync(lnkPath)) fs.unlinkSync(lnkPath);
      result.shortcut.ok = true;
    }
  } catch (e) {
    result.shortcut.error = e.message;
    log("autostart shortcut err:", e.message);
  }

  const status = autostartStatus();
  result.enabled = status.enabled;
  log("setAutostart result:", JSON.stringify(result));
  return result;
}

ipcMain.handle("get-autostart", () => {
  const s = autostartStatus();
  return {
    enabled: s.enabled,
    registry: s.registry,
    shortcut: s.shortcut,
    portable: !!global.__isPortable,
    execPath: process.execPath,
  };
});

ipcMain.handle("set-autostart", (event, enabled) => {
  if (global.__isPortable) {
    return { ok: false, portable: true, error: "Autostart is unavailable for portable builds. Use the installer." };
  }
  const r = setAutostart(enabled);
  return {
    ok: r.registry.ok || r.shortcut.ok,
    enabled: r.enabled,
    registry: r.registry,
    shortcut: r.shortcut,
    portable: false,
  };
});

app.whenReady().then(() => {
  startProxy();

  // Detect portable mode: portable .exe extracts to %TEMP%\xxx\Claude Pulse.exe
  // Installer puts it under %LOCALAPPDATA%\Programs\Claude Pulse\
  const execLower = (process.execPath || "").toLowerCase();
  const isPortable = execLower.includes("\\temp\\") || execLower.includes("/temp/");
  log("Portable mode:", isPortable, "execPath:", process.execPath);

  // First-run: enable autostart by default — only for installed (non-portable) packaged builds
  // Use the dual-method (registry + shortcut) for maximum reliability
  global.__isPortable = isPortable;
  if (app.isPackaged && !isPortable && !settings.autostartDefaultApplied) {
    try {
      const r = setAutostart(true);
      settings.autostartDefaultApplied = true;
      saveSettings(settings);
      log("First-run autostart applied:", JSON.stringify(r));
    } catch (e) {
      log("autostart init err:", e.message);
    }
  }

  // ── TRAY ICON LOADING ──
  // Windows tray works best with .ico (multi-resolution). Fall back to 32px PNG.
  function loadTrayIcon() {
    const candidates = [];
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, "icon.ico"));
      candidates.push(path.join(process.resourcesPath, "tray-icon-32.png"));
      candidates.push(path.join(process.resourcesPath, "icon.png"));
    } else {
      candidates.push(path.join(__dirname, "icon.ico"));
      candidates.push(path.join(__dirname, "tray-icon-32.png"));
      candidates.push(path.join(__dirname, "icon.png"));
    }
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        log("Tray icon loaded from:", p, "size:", img.getSize());
        return img;
      }
      log("Tray icon empty, trying next:", p);
    }
    log("WARNING: no valid tray icon found, using empty");
    return nativeImage.createEmpty();
  }

  const trayIcon = loadTrayIcon();
  // Stable GUID lets Windows remember our tray icon position/visibility across reinstalls
  // (Windows-only option in Electron; ignored on other platforms)
  try {
    tray = new Tray(trayIcon, "5e2a8bb1-0c71-4f9f-9e7d-1c0e3f7a12bb");
  } catch (e) {
    // GUID variant not supported (older Electron) — fall back to plain constructor
    tray = new Tray(trayIcon);
  }
  tray.setToolTip("Claude Pulse");

  waitForProxy(() => {
    createPopup();
    alertsTimer = setInterval(pollAlerts, 30000);

    // First-run tray tip: tell the user to drag the icon onto the taskbar
    if (app.isPackaged && !settings.trayTipShown) {
      setTimeout(() => {
        try {
          if (Notification.isSupported()) {
            const n = new Notification({
              title: "Claude Pulse is running",
              body: "Tip: To keep the icon always visible, click the ^ arrow on your taskbar and drag the Claude Pulse icon out onto the taskbar.",
              silent: false,
            });
            n.on("click", () => { showPopup(); pinned = true; });
            n.show();
          }
          settings.trayTipShown = true;
          saveSettings(settings);
        } catch (e) { log("tray tip err:", e.message); }
      }, 3000);
    }
  });

  tray.on("mouse-enter", () => { if (popup && !popup.isDestroyed()) showPopup(); });
  tray.on("mouse-leave", () => {
    if (pinned) return;
    hideTimer = setTimeout(() => {
      if (popup && !popup.isDestroyed() && !popup.isFocused()) hidePopup();
    }, 400);
  });
  tray.on("click", () => {
    if (!popup || popup.isDestroyed()) return;
    if (!popup.isVisible()) showPopup();
    togglePin();
  });

  tray.on("right-click", () => {
    const aStat = autostartStatus();
    const portableLabel = global.__isPortable ? "Start with Windows (install required)" : "Start with Windows";
    const menu = Menu.buildFromTemplate([
      { label: pinned ? "Unpin" : "Pin", click: togglePin },
      { label: "Login to Claude...", click: () => openLoginWindow("Personal") },
      { type: "separator" },
      {
        label: portableLabel,
        type: "checkbox",
        checked: aStat.enabled && !global.__isPortable,
        enabled: !global.__isPortable,
        click: (mi) => {
          if (global.__isPortable) return;
          setAutostart(mi.checked);
        },
      },
      { label: "Reset window position", click: () => {
          delete settings.windowPos;
          saveSettings(settings);
          if (popup && popup.isVisible()) positionPopup();
        }
      },
      { label: "Open in browser", click: () => shell.openExternal("http://localhost:8787/") },
      { label: "Reload", click: () => popup && popup.loadURL("http://localhost:8787/") },
      { type: "separator" },
      { label: "Quit", click: () => {
          if (alertsTimer) clearInterval(alertsTimer);
          if (proxy) { try { proxy.kill(); } catch(e){} }
          app.quit();
        }
      },
    ]);
    tray.popUpContextMenu(menu);
  });

  globalShortcut.register("CommandOrControl+Shift+C", togglePopup);
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    if (popup) popup.loadURL("http://localhost:8787/");
  });

  log("Ready - packaged:", app.isPackaged);
});

app.on("window-all-closed", (e) => e.preventDefault());
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("before-quit", () => {
  if (alertsTimer) clearInterval(alertsTimer);
  if (proxy) { try { proxy.kill(); } catch(e){} }
});
