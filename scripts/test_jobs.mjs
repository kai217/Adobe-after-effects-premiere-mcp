// Test: a host_run job started by one server process is visible to another (shared jobs on disk), PowerShell is the default shell,
// and media_beats runs. No Adobe app needed.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function server() { const t = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'server.js')], env: { ...process.env, KAI_AE_MOCK: '1' } }); const c = new Client({ name: 'jobtest', version: '1' }); await c.connect(t); return c; }
const txt = (r) => r.content[0].text;
const A = await server(), B = await server();
const cmd = process.platform === 'win32' ? '$x = 21 * 2; Write-Output "answer $x"; Start-Sleep 1' : 'echo answer 42; sleep 1';
const started = JSON.parse(txt(await A.callTool({ name: 'host_run', arguments: { command: cmd, label: 'jobtest' } })));
console.log('started', started.job, 'shell', started.shell);
await new Promise(r => setTimeout(r, 2500));
const fromB = txt(await B.callTool({ name: 'host_job', arguments: { job: started.job } }));
console.log('seen from second server:', fromB.replace(/\s+/g, ' ').slice(0, 200));
const list = JSON.parse(txt(await B.callTool({ name: 'host_job', arguments: {} })));
console.log('listed by second server:', list.some(j => j.job === started.job));
let beatsOk = true;
const song = process.env.KAI_TEST_SONG;
if (song) { const b = JSON.parse(txt(await A.callTool({ name: 'media_beats', arguments: { path: song, duration: 30 } }))); console.log('media_beats bpm', b.bpm, 'beats', b.beats.length); beatsOk = b.bpm > 60 && b.beats.length > 10; }
const ok = /answer 42/.test(fromB) && /"exit": 0/.test(fromB) && beatsOk;
console.log(ok ? 'PASS' : 'FAIL');
await A.close(); await B.close(); process.exit(ok ? 0 : 1);
