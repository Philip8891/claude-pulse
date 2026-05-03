"""Claude Pulse Proxy + Widget - localhost:8787"""
import http.server
import json
import urllib.request
import urllib.error
import time
import os
import threading
from pathlib import Path
from collections import deque

PORT = 8787
REFRESH_INTERVAL = 60
HISTORY_RETENTION_DAYS = 7
HISTORY_SAMPLE_INTERVAL = 300

CONFIG_DIR = Path.home() / ".claude-pulse"
CONFIG_PATH = CONFIG_DIR / "config.json"
HISTORY_PATH = CONFIG_DIR / "history.json"
UI_STATE_PATH = CONFIG_DIR / "ui-state.json"


def load_config():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                c = json.load(f)
            if "profiles" not in c and c.get("sessionCookie"):
                c = {
                    "profiles": [{
                        "id": "default", "name": "Personal",
                        "sessionCookie": c.get("sessionCookie", ""),
                        "orgId": c.get("orgId", ""),
                        "cfClearance": c.get("cfClearance", ""),
                    }],
                    "activeProfile": "default",
                }
                save_config(c)
            return c
        except Exception as e:
            print(f"[proxy] Config load err: {e}")

    env_cookie = os.environ.get("CLAUDE_SESSION_COOKIE", "")
    env_org = os.environ.get("CLAUDE_ORG_ID", "")
    if env_cookie and env_org:
        return {
            "profiles": [{
                "id": "default", "name": "Personal",
                "sessionCookie": env_cookie, "orgId": env_org,
                "cfClearance": os.environ.get("CLAUDE_CF_CLEARANCE", ""),
            }],
            "activeProfile": "default",
        }
    return {"profiles": [], "activeProfile": None}


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)


def load_ui_state():
    if UI_STATE_PATH.exists():
        try:
            with open(UI_STATE_PATH) as f:
                return json.load(f)
        except: pass
    return {"theme": "copper", "dark": False, "compact": False, "showHistory": False}


def save_ui_state(state):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(UI_STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


def get_active_profile():
    if not config.get("profiles"): return None
    active_id = config.get("activeProfile")
    for p in config["profiles"]:
        if p["id"] == active_id: return p
    return config["profiles"][0] if config["profiles"] else None


config = load_config()
ui_state = load_ui_state()

history_data = {}

def load_history():
    global history_data
    if HISTORY_PATH.exists():
        try:
            with open(HISTORY_PATH) as f:
                history_data = json.load(f)
        except Exception as e:
            print(f"[proxy] History load err: {e}")
            history_data = {}

def save_history():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - (HISTORY_RETENTION_DAYS * 86400)
    for pid in history_data:
        history_data[pid] = [h for h in history_data[pid] if h["ts"] > cutoff]
    with open(HISTORY_PATH, "w") as f:
        json.dump(history_data, f)

load_history()

cached_data = None
cache_lock = threading.Lock()
short_history = deque(maxlen=20)
alerts = deque(maxlen=50)
last_session_used = None
last_history_sample = 0
session_expired = False

# Widget HTML: több helyet is megpróbálunk, a legelső létezőt használjuk
import sys

def _find_widget_html():
    candidates = []
    # 1. Explicit env var (Electron packaged eset)
    ev = os.environ.get("CLAUDE_PULSE_WIDGET_DIR")
    if ev:
        candidates.append(Path(ev) / "widget.html")
    # 2. PyInstaller onefile bundle temp dir
    if hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "widget.html")
    # 3. The executable's folder (PyInstaller onefile final location)
    try:
        if getattr(sys, 'frozen', False):
            candidates.append(Path(sys.executable).parent / "widget.html")
    except Exception:
        pass
    # 4. Script's own folder (dev mode)
    try:
        candidates.append(Path(__file__).parent / "widget.html")
    except NameError:
        pass
    # 5. Current working directory
    candidates.append(Path.cwd() / "widget.html")

    for c in candidates:
        try:
            if c.exists():
                print(f"[proxy] widget.html found at: {c}")
                return c
        except Exception:
            continue

    print("[proxy] widget.html NOT FOUND. Searched:")
    for c in candidates:
        print(f"[proxy]   - {c}")
    # Return best-guess even if not found, so error message shows the path
    return candidates[0] if candidates else Path("widget.html")

WIDGET_HTML_PATH = _find_widget_html()


def fetch_claude_usage(profile=None):
    global session_expired
    if profile is None:
        profile = get_active_profile()
    if not profile or not profile.get("sessionCookie") or not profile.get("orgId"):
        raise Exception("No active profile configured")

    cookie_str = f"sessionKey={profile['sessionCookie']}"
    if profile.get("cfClearance"):
        cookie_str += f"; cf_clearance={profile['cfClearance']}"
    url = f"https://claude.ai/api/organizations/{profile['orgId']}/usage"
    req = urllib.request.Request(url, headers={
        "Cookie": cookie_str,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://claude.ai/settings/usage",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = json.loads(resp.read())
            if profile is get_active_profile():
                session_expired = False
    except urllib.error.HTTPError as e:
        if e.code in (401, 403) and profile is get_active_profile():
            session_expired = True
            alerts.append({"type": "session_expired"})
        raise

    def _num(d, key, default=0):
        v = d.get(key, default)
        return v if v is not None else default

    fh = raw.get("five_hour") or {}
    sd = raw.get("seven_day") or {}
    sonnet = raw.get("seven_day_sonnet") or {}
    design = raw.get("seven_day_omelette") or {}
    ex = raw.get("extra_usage") or {}
    spent_eur = _num(ex, "used_credits", 0) / 100
    limit_eur = _num(ex, "monthly_limit", 4000) / 100
    session_used = _num(fh, "utilization", 0) / 100

    if profile is get_active_profile():
        short_history.append((time.time(), session_used))

    return {
        "profile": {"id": profile["id"], "name": profile["name"]},
        "session": {"used": session_used, "resetsAt": fh.get("resets_at", "")},
        "allModels": {"used": _num(sd, "utilization", 0) / 100, "resetsAt": sd.get("resets_at", "")},
        "sonnetOnly": {"used": _num(sonnet, "utilization", 0) / 100, "resetsAt": sonnet.get("resets_at", "")},
        "claudeDesign": {"used": _num(design, "utilization", 0) / 100, "resetsAt": design.get("resets_at", "")},
        "monthly": {"used": _num(ex, "utilization", 0) / 100, "spent": round(spent_eur, 2), "limit": round(limit_eur, 2)},
        "plan": "Max (5x)",
        "lastSync": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "prediction": calculate_prediction(session_used),
        "sessionExpired": session_expired,
    }


def calculate_prediction(current_used):
    if len(short_history) < 3: return {"text": ""}
    if current_used >= 1.0: return {"text": "session exhausted"}
    if current_used < 0.05: return {"text": ""}
    now = time.time()
    recent = [(t, v) for (t, v) in short_history if now - t < 600]
    if len(recent) < 2: return {"text": ""}
    dt = recent[-1][0] - recent[0][0]
    dv = recent[-1][1] - recent[0][1]
    if dt < 30 or dv <= 0: return {"text": ""}
    rate = dv / dt
    sec_to_full = (1.0 - current_used) / rate
    if sec_to_full > 18000: return {"text": ""}
    if sec_to_full < 60: return {"text": "< 1 min to 100%"}
    m = int(sec_to_full / 60)
    if m < 60: return {"text": f"~{m} min to 100%"}
    h = int(m / 60)
    return {"text": f"~{h}h {m % 60}m to 100%"}


def refresh_cache():
    global cached_data, last_session_used, last_history_sample
    active = get_active_profile()
    if not active: return
    try:
        data = fetch_claude_usage(active)
        with cache_lock:
            if last_session_used is not None:
                if last_session_used > 0.5 and data["session"]["used"] < 0.1:
                    alerts.append({"type": "reset", "ts": time.time()})
                for threshold in [0.75, 0.9, 0.95]:
                    if last_session_used < threshold <= data["session"]["used"]:
                        alerts.append({"type": "threshold", "ts": time.time(), "level": int(threshold*100)})
            last_session_used = data["session"]["used"]
            cached_data = data

            now = time.time()
            if now - last_history_sample >= HISTORY_SAMPLE_INTERVAL:
                pid = active["id"]
                if pid not in history_data:
                    history_data[pid] = []
                history_data[pid].append({
                    "ts": now,
                    "session": data["session"]["used"],
                    "weekly": data["allModels"]["used"],
                    "sonnet": data["sonnetOnly"]["used"],
                    "design": data["claudeDesign"]["used"],
                })
                save_history()
                last_history_sample = now

        print(f"[proxy] [{active['name']}] session={data['session']['used']*100:.0f}% weekly={data['allModels']['used']*100:.0f}%")
    except Exception as e:
        print(f"[proxy] Error: {e}")


def background_refresh():
    while True:
        refresh_cache()
        time.sleep(REFRESH_INTERVAL)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        ln = int(self.headers.get("Content-Length", 0))
        if ln == 0: return {}
        try: return json.loads(self.rfile.read(ln))
        except: return {}

    def do_GET(self):
        global config, ui_state
        if self.path in ("/", "/widget"):
            try:
                with open(WIDGET_HTML_PATH, "rb") as f:
                    body = f.read()
            except FileNotFoundError:
                body = (f"<html><body style='font-family:monospace;padding:20px'>"
                        f"<h3>widget.html not found</h3>"
                        f"<p>Searched: <code>{WIDGET_HTML_PATH}</code></p>"
                        f"<p>CLAUDE_PULSE_WIDGET_DIR env: <code>{os.environ.get('CLAUDE_PULSE_WIDGET_DIR','(not set)')}</code></p>"
                        f"<p>sys.executable: <code>{sys.executable}</code></p>"
                        f"</body></html>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/usage":
            with cache_lock: d = cached_data
            if d is None:
                self._send_json({"error": "Cache not ready"}, 503); return
            self._send_json(d)
        elif self.path == "/alerts":
            with cache_lock:
                a = list(alerts); alerts.clear()
            self._send_json({"alerts": a})
        elif self.path == "/config":
            self._send_json(config)
        elif self.path == "/ui-state":
            self._send_json(ui_state)
        elif self.path == "/history":
            active = get_active_profile()
            if not active:
                self._send_json({"points": []}); return
            self._send_json({"points": history_data.get(active["id"], [])})
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        global config, ui_state
        if self.path == "/config/profile":
            body = self._read_body()
            if not body.get("sessionCookie") or not body.get("orgId"):
                self._send_json({"ok": False, "error": "sessionCookie and orgId required"}, 400); return
            profile_id = body.get("id") or f"profile_{int(time.time())}"
            profile = {
                "id": profile_id, "name": body.get("name", "Profile"),
                "sessionCookie": body["sessionCookie"], "orgId": body["orgId"],
                "cfClearance": body.get("cfClearance", ""),
            }
            found = False
            for i, p in enumerate(config.get("profiles", [])):
                if p["id"] == profile_id:
                    config["profiles"][i] = profile; found = True; break
            if not found:
                config.setdefault("profiles", []).append(profile)
            if not config.get("activeProfile"):
                config["activeProfile"] = profile_id
            save_config(config)
            threading.Thread(target=refresh_cache, daemon=True).start()
            self._send_json({"ok": True, "profile": profile})

        elif self.path == "/config/active":
            body = self._read_body()
            pid = body.get("id")
            if not any(p["id"] == pid for p in config.get("profiles", [])):
                self._send_json({"ok": False, "error": "Profile not found"}, 404); return
            config["activeProfile"] = pid
            save_config(config)
            threading.Thread(target=refresh_cache, daemon=True).start()
            self._send_json({"ok": True})

        elif self.path == "/config/delete":
            body = self._read_body()
            pid = body.get("id")
            config["profiles"] = [p for p in config.get("profiles", []) if p["id"] != pid]
            if config.get("activeProfile") == pid:
                config["activeProfile"] = config["profiles"][0]["id"] if config["profiles"] else None
            save_config(config)
            threading.Thread(target=refresh_cache, daemon=True).start()
            self._send_json({"ok": True})

        elif self.path == "/config/test":
            body = self._read_body()
            if not body.get("sessionCookie") or not body.get("orgId"):
                self._send_json({"ok": False, "error": "sessionCookie and orgId required"}, 400); return
            try:
                result = fetch_claude_usage({
                    "id": "__test__", "name": "test",
                    "sessionCookie": body["sessionCookie"], "orgId": body["orgId"],
                    "cfClearance": body.get("cfClearance", ""),
                })
                self._send_json({"ok": True, "plan": result.get("plan", "")})
            except urllib.error.HTTPError as e:
                msg = f"HTTP {e.code}"
                if e.code == 401: msg = "Invalid session cookie (401)"
                elif e.code == 403: msg = "Forbidden (403) – try adding CF Clearance"
                elif e.code == 404: msg = "Organization not found (404)"
                self._send_json({"ok": False, "error": msg})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)})

        elif self.path == "/ui-state":
            body = self._read_body()
            ui_state.update(body)
            save_ui_state(ui_state)
            self._send_json({"ok": True, "state": ui_state})
        else:
            self.send_response(404); self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    print(f"[proxy] Starting - http://localhost:{PORT}/")
    print(f"[proxy] Config: {CONFIG_PATH}")
    active = get_active_profile()
    if active:
        print(f"[proxy] Active: {active['name']}")
        refresh_cache()
    else:
        print("[proxy] No profile - setup via UI")
    threading.Thread(target=background_refresh, daemon=True).start()
    http.server.HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
