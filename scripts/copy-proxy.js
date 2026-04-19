// Moves PyInstaller output (dist/proxy.exe) to dist-proxy/proxy.exe
// so electron-builder can find it via extraResources

const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "dist", "proxy.exe");
const destDir = path.join(__dirname, "..", "dist-proxy");
const dest = path.join(destDir, "proxy.exe");

if (!fs.existsSync(src)) {
  console.error("ERROR: PyInstaller output not found at", src);
  console.error("Did 'pyinstaller' run successfully?");
  process.exit(1);
}

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const stat = fs.statSync(dest);
console.log(`[copy-proxy] ${src} -> ${dest} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
