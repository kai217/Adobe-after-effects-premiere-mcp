// Registers KAI-AE-MCP with the Claude desktop app and writes config.json. Run by install.bat.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { findAfterFX, loadConfig, saveConfig } = await import('./../lib/ae.js');
const cfg = loadConfig();
cfg.afterFX = findAfterFX(cfg) || cfg.afterFX || null;
const { workDir, mode, timeoutSec, afterFX } = cfg; saveConfig({ workDir, mode, timeoutSec, afterFX });
console.log('After Effects:', afterFX || 'NOT FOUND (edit config.json "afterFX")');
console.log('Work folder  :', workDir);

const entry = { command: process.execPath, args: [path.join(root, 'server.js')] };
const candidates = [];
if (process.platform === 'win32') {
  candidates.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude'));
  const pk = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages');
  try { for (const d of fs.readdirSync(pk)) if (/^Claude/i.test(d)) candidates.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude')); } catch {}
} else if (process.platform === 'darwin') candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude'));
let n = 0;
for (const dir of candidates) {
  if (!fs.existsSync(dir)) continue;
  const f = path.join(dir, 'claude_desktop_config.json');
  let j = {};
  if (fs.existsSync(f)) { const raw = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f + '.backup-' + Date.now(), raw); try { j = JSON.parse(raw); } catch { console.log('! could not parse', f, '- left unchanged'); continue; } }
  j.mcpServers = j.mcpServers || {};
  j.mcpServers['kai-after-effects'] = entry;
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  console.log('Registered in', f); n++;
}
if (!n) { console.log('Claude desktop config folder not found. Add this to claude_desktop_config.json under "mcpServers":'); console.log(JSON.stringify({ 'kai-after-effects': entry }, null, 2)); }

// ---------- ChatGPT desktop app / Codex ----------
// ChatGPT desktop, the Codex CLI and the Codex IDE extension share ~/.codex/config.toml ([mcp_servers.<name>] tables).
// Registered when Codex/ChatGPT is present (or with KAI_FORCE_CHATGPT=1). Long renders need a long tool timeout.
try {
  const codexDir = path.join(os.homedir(), '.codex');
  let chatgpt = fs.existsSync(codexDir) || process.env.KAI_FORCE_CHATGPT === '1';
  if (!chatgpt && process.platform === 'win32') {
    const pk = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages');
    try { chatgpt = fs.readdirSync(pk).some(d => /^OpenAI\.ChatGPT/i.test(d)); } catch {}
    if (!chatgpt) chatgpt = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ChatGPT'));
  } else if (!chatgpt && process.platform === 'darwin') chatgpt = fs.existsSync('/Applications/ChatGPT.app');
  if (chatgpt) {
    fs.mkdirSync(codexDir, { recursive: true });
    const f = path.join(codexDir, 'config.toml');
    let raw = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (raw) fs.writeFileSync(f + '.backup-' + Date.now(), raw);
    // drop an earlier kai-after-effects table (up to the next [table] header), then append a fresh one
    raw = raw.replace(/\n?\[mcp_servers\.kai-after-effects\][\s\S]*?(?=\n\[|$)/, '');
    const lit = (p) => "'" + p + "'"; // TOML literal strings: backslashes in Windows paths stay as they are
    const block = '\n[mcp_servers.kai-after-effects]\ncommand = ' + lit(entry.command) + '\nargs = [' + entry.args.map(lit).join(', ') + ']\nstartup_timeout_sec = 30\ntool_timeout_sec = 900\n';
    fs.writeFileSync(f, raw.replace(/\s*$/, '\n') + block);
    console.log('Registered in', f, '(ChatGPT desktop + Codex)');
  }
} catch (e) { console.log('! could not register with ChatGPT/Codex:', e.message); }

// ---------- KAI MCP Bridge panel (After Effects + Premiere Pro) ----------
// Links <this folder>/cep into Adobe's CEP extensions folder and allows unsigned extensions (PlayerDebugMode).
import { execFileSync } from 'node:child_process';
const cepSrc = path.join(root, 'cep');
const extRoot = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
const link = path.join(extRoot, 'com.kai.mcp.bridge');
try {
  fs.mkdirSync(extRoot, { recursive: true });
  let current = null; try { current = fs.realpathSync(link); } catch {}
  if (current !== fs.realpathSync(cepSrc)) {
    try { fs.rmSync(link, { recursive: false, force: true }); } catch { try { fs.unlinkSync(link); } catch {} }
    fs.symlinkSync(cepSrc, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
  console.log('Bridge panel :', link, '->', cepSrc);
} catch (e) { console.log('! could not install the bridge panel:', e.message); }
for (const v of [9, 10, 11, 12]) {
  try {
    if (process.platform === 'win32') execFileSync('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${v}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], { stdio: 'ignore' });
    else if (process.platform === 'darwin') execFileSync('defaults', ['write', `com.adobe.CSXS.${v}`, 'PlayerDebugMode', '1'], { stdio: 'ignore' });
  } catch {}
}
console.log('Unsigned extensions allowed (PlayerDebugMode=1). Fully restart After Effects and Premiere Pro to load the bridge.');

// ---------- KAI MCP Bridge (UXP) for Premiere Pro 25.6+ (and After Effects once its UXP is out of beta) ----------
// Packs uxp/kai-mcp-bridge into dist/kai-mcp-bridge.ccx and asks Creative Cloud's plugin installer (UPIA) to install it.
// If UPIA is missing, double-click the .ccx, or load uxp/kai-mcp-bridge/manifest.json in the UXP Developer Tool.
try {
  const dist = path.join(root, 'dist'); fs.mkdirSync(dist, { recursive: true });
  const zip = path.join(dist, 'kai-mcp-bridge.zip'), ccx = path.join(dist, 'kai-mcp-bridge.ccx');
  for (const f of [zip, ccx]) { try { fs.unlinkSync(f); } catch {} }
  const src = path.join(root, 'uxp', 'kai-mcp-bridge');
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${src}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'ignore' });
  else execFileSync('/usr/bin/zip', ['-qr', zip, '.'], { cwd: src, stdio: 'ignore' });
  fs.renameSync(zip, ccx);
  console.log('UXP plugin   :', ccx);
  const upia = process.platform === 'win32'
    ? 'C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe'
    : '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent';
  if (fs.existsSync(upia)) {
    try { execFileSync(upia, ['/install', ccx], { stdio: 'ignore', timeout: 120000 }); console.log('UXP plugin installed through Creative Cloud. In Premiere: Window > UXP Plugins > KAI MCP Bridge (UXP).'); }
    catch { console.log('! Creative Cloud did not install the unsigned plugin automatically. Double-click', ccx, 'or load', path.join(src, 'manifest.json'), 'in the UXP Developer Tool.'); }
  } else console.log('Creative Cloud plugin installer not found: double-click', ccx, 'or use the UXP Developer Tool.');
} catch (e) { console.log('! could not package the UXP plugin:', e.message); }
