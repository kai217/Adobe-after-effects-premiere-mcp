// UXP transport: the KAI MCP Bridge (UXP) plugin runs async JavaScript jobs against the host's modern UXP API.
// Same file-queue design as the CEP bridge (lib/ae.js): <work>/uxp/<host>/queue/<id>.js -> result JSON, heartbeat <work>/bridge/uxp_<host>.json.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const NAMES = { pr: 'Premiere Pro', ae: 'After Effects' };

export function readUxpHeartbeat(cfg, host) {
  try {
    const hb = JSON.parse(fs.readFileSync(path.join(cfg.workDir, 'bridge', `uxp_${host}.json`), 'utf8'));
    hb.ageMs = Date.now() - hb.t; hb.connected = hb.ageMs < 4000; hb.busyMs = hb.inFlight ? Date.now() - hb.inFlight.since : 0;
    return hb;
  } catch { return { connected: false, missing: true }; }
}
export function describeUxp(hb, host) {
  const n = NAMES[host] || host;
  if (!hb || hb.missing) return `${n} UXP plugin has never connected.`;
  if (!hb.connected) return `${n} UXP plugin is not connected (last heartbeat ${Math.round(hb.ageMs / 1000)}s ago).`;
  if (hb.inFlight) return `${n} UXP plugin busy with ${hb.inFlight.job} for ${Math.round(hb.busyMs / 1000)}s.`;
  return `${n} UXP plugin connected (${n} ${hb.version || ''}, UXP ${hb.uxp || '?'}).`;
}

let seq = 0;
export async function runUxpJob(cfg, { host = 'pr', code, args = {}, timeoutSec, expectedProject, label }) {
  const guard = expectedProject ? `const __p = await KAI.project(); const __path = String(__p.path || __p.name || '').replace(/\\\\/g, '/').toLowerCase();
if (__path.indexOf(${JSON.stringify(String(expectedProject).replace(/\\/g, '/').toLowerCase())}) < 0) throw new Error('Project guard: expected a project matching ' + ${JSON.stringify(expectedProject)} + ' but the open project is ' + (__path || 'unsaved') + '. Nothing was changed.');\n` : '';
  const body = guard + code;
  if (process.env.KAI_AE_MOCK) { // self-test: compile the async body the way the plugin will
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; new AsyncFunction('KAI', 'ARGS', 'require', body);
    return { mock: true, label };
  }
  const hb = readUxpHeartbeat(cfg, host);
  if (!hb.connected) throw new Error(describeUxp(hb, host) + ` Load it once: UXP Developer Tool > Add Plugin > ${path.join(cfg.root || '', 'uxp', 'kai-mcp-bridge', 'manifest.json')} > Load (or install the .ccx). Then Window > UXP Plugins > KAI MCP Bridge (UXP).`);
  if (hb.inFlight && hb.busyMs > 3000) throw new Error(describeUxp(hb, host) + ' Wait for it to finish, then retry.');
  const dir = path.join(cfg.workDir, 'uxp', host); fs.mkdirSync(path.join(dir, 'queue'), { recursive: true }); fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  const id = `${Date.now()}_${process.pid}_${++seq}`;
  const resultPath = path.join(dir, 'results', id + '.json').replace(/\\/g, '/');
  const jobPath = path.join(dir, 'queue', id + '.js');
  fs.writeFileSync(jobPath + '.tmp', `// KAI-RESULT: ${resultPath}\n// KAI-ARGS: ${JSON.stringify(args)}\n${body}\n`, 'utf8');
  fs.renameSync(jobPath + '.tmp', jobPath); // atomic: the plugin never sees a half-written job
  const t0 = Date.now(), tmo = (timeoutSec || cfg.timeoutSec || 120) * 1000;
  while (Date.now() - t0 < tmo) {
    if (fs.existsSync(resultPath)) { const r = JSON.parse(fs.readFileSync(resultPath, 'utf8')); try { fs.unlinkSync(resultPath); } catch {}
      if (!r.ok) throw new Error(r.error + (r.stack ? ' [' + r.stack + ']' : '')); return r.result; }
    if (!readUxpHeartbeat(cfg, host).connected && Date.now() - t0 > 5000) { try { fs.unlinkSync(jobPath); } catch {} throw new Error(`${NAMES[host]} UXP plugin stopped responding while running this job.`); }
    await sleep(120);
  }
  try { fs.unlinkSync(jobPath); } catch {}
  throw new Error(`Timed out after ${tmo / 1000}s waiting for the ${NAMES[host]} UXP plugin.`);
}
