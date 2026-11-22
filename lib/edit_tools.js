// Editing helpers added during a real interview edit (Nov 2026):
//   host_run / host_job      run a command on this machine in the background (ffmpeg, python, whisper) and poll it
//   media_probe              ffprobe-style facts for many files at once
//   media_contact_sheet      timestamped contact sheet straight from a video file (no Premiere/AE needed)
//   media_beats              BPM + beat grid + drops of a song (numpy), cut-to-beat check
//   media_transcribe         word-level transcript that KEEPS filler words (faster-whisper), as a background job
//   pr_build_cut             build a whole sequence from a list of source in/out ranges in one call
//   pr_grade                 Lumetri on every clip: load a .cube as Input LUT + set Basic/Creative sliders
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from './ae.js';
import { thumbJpeg } from './media.js';

const jobs = new Map();
const readJsx = (n) => fs.readFileSync(path.join(ROOT, 'jsx', 'pr', n), 'utf8');

export function registerEditTools({ tool, text, fail, ae, cfg, z }) {
  const pr = (name, args, code, opts = {}) => ae(name, args, code, { ...opts, host: 'pr' });
  const guard = z.string().optional().describe('Project guard: refuse to run unless the open .prproj path contains this text.');
  const jobDir = path.join(cfg.workDir, 'jobs'); fs.mkdirSync(jobDir, { recursive: true });

  // Commands given as one string run through PowerShell on Windows (scripts allowed for this call), not cmd.exe:
  // most generated commands use PowerShell syntax ($vars, Get-ChildItem, & 'x.ps1') and cmd.exe failed on them.
  // shell: 'cmd' keeps the old behaviour.
  function shellCommand(command, shell) {
    if (process.platform !== 'win32' || shell === 'cmd') return [command, null];
    let c = command.trim();
    if (/\.ps1$/i.test(c) && !/\s/.test(c.replace(/^"|"$/g, '').replace(/^'|'$/g, ''))) c = '& ' + c; // bare script path
    else if (/^"[^"]+\.ps1"(\s|$)/i.test(c)) c = '& ' + c;
    return ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', c]];
  }
  // Jobs are also written to <workDir>/jobs/<id>.json, so host_job finds them from another chat (another server process)
  // and after the MCP restarts. Before this they lived only in memory and came back as "unknown job".
  const metaFile = (id) => path.join(jobDir, id + '.json');
  const saveMeta = (j) => { try { fs.writeFileSync(metaFile(j.id), JSON.stringify({ ...j, serverPid: process.pid })); } catch {} };
  function startJob(label, cmd, args, cwd) {
    const id = label.replace(/[^a-z0-9_-]/gi, '_') + '_' + Date.now().toString(36);
    const logFile = path.join(jobDir, id + '.log');
    const out = fs.openSync(logFile, 'a');
    const child = spawn(cmd, args, { cwd: cwd || cfg.workDir, stdio: ['ignore', out, out], windowsHide: true, shell: !args });
    const j = { id, label, cmd, args, pid: child.pid, logFile, started: new Date().toISOString(), exit: null };
    child.on('exit', (code) => { j.exit = code; j.ended = new Date().toISOString(); saveMeta(j); });
    child.on('error', (e) => { j.exit = -1; fs.appendFileSync(logFile, '\nspawn error: ' + e.message); saveMeta(j); });
    jobs.set(id, j); saveMeta(j); return j;
  }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  // A job from another server process or an earlier run: read its saved record. If its process is gone and no exit was
  // recorded (the server that started it was closed), report it as ended with the exit code unknown.
  function loadJob(id) {
    try {
      const j = JSON.parse(fs.readFileSync(metaFile(id), 'utf8'));
      if (j.exit === null && !alive(j.pid)) { j.exit = 'unknown'; j.note = 'finished or stopped while no MCP server was watching it; check the log'; }
      return j;
    } catch {}
    const logFile = path.join(jobDir, id + '.log');
    if (fs.existsSync(logFile)) return { id, logFile, exit: 'unknown', note: 'only the log was found (job from an older MCP version)' };
    return null;
  }
  function recentDiskJobs(hours = 24) {
    let names = []; try { names = fs.readdirSync(jobDir).filter(n => n.endsWith('.json')); } catch {}
    const cut = Date.now() - hours * 3600e3;
    return names.map(n => loadJob(n.slice(0, -5))).filter(j => j && Date.parse(j.started || 0) > cut);
  }
  const tail = (f, n = 40) => { try { const t = fs.readFileSync(f, 'utf8').split(/\r?\n/); return t.slice(-n).join('\n'); } catch { return ''; } };

  if (cfg.allowHostExec !== false) {
    tool('host_run', 'Run a shell command on this computer in the background (ffmpeg, python, a render script...). Returns a job id at once; poll with host_job. Use for long media work instead of hacking .bat files through Premiere. Set "allowHostExec": false in config.json to disable.',
      { command: z.string(), cwd: z.string().optional(), label: z.string().optional(), shell: z.enum(['powershell', 'cmd']).optional().describe('Windows only. Default powershell (with -ExecutionPolicy Bypass, so .ps1 files run); cmd for old cmd.exe syntax.') },
      async (a) => { const [cmd, args] = shellCommand(a.command, a.shell); const j = startJob(a.label || 'job', cmd, args, a.cwd); return text({ job: j.id, pid: j.pid, log: j.logFile, shell: args ? 'powershell' : (process.platform === 'win32' ? 'cmd' : 'sh') }); });
  }
  tool('host_job', 'Status of a background job started by host_run or media_transcribe: running/finished, exit code, last log lines. Works for jobs started from any chat and before an MCP restart (jobs are saved to disk). Omit job to list the last 24 hours of jobs. kill: true stops it.',
    { job: z.string().optional(), lines: z.number().optional(), kill: z.boolean().optional() },
    async (a) => {
      if (!a.job) {
        const all = new Map(recentDiskJobs().map(j => [j.id, j])); for (const j of jobs.values()) all.set(j.id, j);
        return text([...all.values()].sort((x, y) => String(y.started).localeCompare(String(x.started))).map(j => ({ job: j.id, label: j.label, running: j.exit === null, exit: j.exit, started: j.started })));
      }
      const j = jobs.get(a.job) || loadJob(a.job); if (!j) return fail('unknown job ' + a.job + ' (no record in ' + jobDir + ')');
      if (a.kill && j.exit === null && j.pid) { try { process.kill(j.pid); } catch (e) { return fail(String(e)); } }
      return text({ job: j.id, running: j.exit === null, exit: j.exit, started: j.started, ended: j.ended, output: j.output, note: j.note, log: tail(j.logFile, a.lines || 40) });
    });

  tool('media_probe', 'Duration, codec, size, fps, audio channels and timecode for many media files at once (ffprobe via the bundled ffmpeg).',
    { paths: z.array(z.string()) },
    async (a) => {
      const res = [];
      for (const p of a.paths) {
        if (!fs.existsSync(p)) { res.push({ path: p, error: 'file not found' }); continue; }
        const err = await new Promise(r => execFile(ffmpegPath, ['-hide_banner', '-i', p], { maxBuffer: 1 << 24 }, (e, so, se) => r(String(se))));
        const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(err), v = /Video: ([^,\s]+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*?([\d.]+) fps/.exec(err), au = /Audio: ([^,\s]+), (\d+) Hz, ([^,]+)/.exec(err), tc = /timecode\s*: (\S+)/.exec(err);
        res.push({ path: p, duration: dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : null, video: v ? { codec: v[1], width: +v[2], height: +v[3], fps: +v[4] } : null, audio: au ? { codec: au[1], rate: +au[2], layout: au[3] } : null, timecode: tc ? tc[1] : null });
      }
      return text(res);
    });

  tool('media_contact_sheet', 'Contact sheet straight from a video file with the source time burned into every tile, so you can pick in/out points without opening Premiere. every: seconds between tiles (default: fits ~36 tiles). Returns the image.',
    { path: z.string(), every: z.number().optional(), from: z.number().optional(), to: z.number().optional(), cols: z.number().optional(), tile_width: z.number().optional() },
    async (a) => {
      const cols = a.cols || 6, tw = a.tile_width || 320, out = path.join(cfg.workDir, 'frames', 'sheet_' + Date.now() + '.jpg');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const from = a.from || 0;
      // Always probe so the sheet is sized to the real tile count (no empty black rows).
      const d = await new Promise(r => execFile(ffmpegPath, ['-hide_banner', '-i', a.path], (e, so, se) => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(se)); r(m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 60); }));
      const span = Math.max(0.1, Math.min(a.to || d, d) - from);
      const every = a.every || Math.max(0.25, span / 36);
      const n = Math.max(1, Math.min(36, Math.ceil(span / every)));
      const rows = Math.ceil(n / cols);
      const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';
      const fs_ = Math.round(tw / 14);
      let args;
      if (every >= 4) {
        // Sparse sheet (long interview takes, 70 GB ProRes): decoding the whole file through fps= takes minutes.
        // Seek each tile instead: one fast input-side -ss per tile, take its first frame, concat, tile.
        const ins = [], parts = [];
        for (let k = 0; k < n; k++) {
          const t = from + k * every; ins.push('-ss', t.toFixed(3), '-i', a.path);
          parts.push(`[${k}:v:0]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${tw}:-2,setsar=1,drawtext=${font}text='${t.toFixed(1)}s':x=6:y=6:fontsize=${fs_}:fontcolor=white:box=1:boxcolor=black@0.6[t${k}]`);
        }
        const fc = parts.join(';') + ';' + Array.from({ length: n }, (_, k) => `[t${k}]`).join('') + `concat=n=${n}:v=1:a=0,tile=${cols}x${rows}[out]`;
        args = ['-v', 'error', '-y', ...ins, '-filter_complex', fc, '-map', '[out]', '-frames:v', '1', '-q:v', '4', out];
      } else {
        // After fps=1/every the frame time t is already in source seconds (relative to -ss), so the label is t+from.
        // (v1 multiplied t by every, so labels were off by a factor of every.)
        const vf = `fps=1/${every},scale=${tw}:-2,drawtext=${font}text='%{eif\\:t+${from}\\:d}.%{eif\\:mod((t+${from})*10\\,10)\\:d}s':x=6:y=6:fontsize=${fs_}:fontcolor=white:box=1:boxcolor=black@0.6,tile=${cols}x${rows}`;
        args = ['-v', 'error', '-y', ...(from ? ['-ss', String(from)] : []), ...(a.to ? ['-to', String(a.to - from)] : []), '-i', a.path, '-map', '0:v:0', '-vf', vf, '-frames:v', '1', '-q:v', '4', out];
      }
      await new Promise((r, j) => execFile(ffmpegPath, args, { maxBuffer: 1 << 26 }, (e, so, se) => e ? j(new Error(String(se || e))) : r()));
      return { content: [{ type: 'text', text: JSON.stringify({ file: out, every, from, tiles: n, truncated: Math.ceil(span / every) > 36, note: 'tile n (row-major, from 0) = from + n*every seconds; max 36 tiles per sheet, use from/to for more' }) },
        { type: 'image', data: (await thumbJpeg(out, 1800)).toString('base64'), mimeType: 'image/jpeg' }] };
    });

  tool('media_transcribe', 'Word-level transcript of a media file that keeps filler words (um/uh), for interview cleanup. Runs faster-whisper as a background job (picks the GPU with the most free memory, falls back to CPU). Poll host_job; the JSON lands at the returned path. Format: {segments:[{s,e,text,words:[[start,end,word,prob,isFiller],...]}],fillers:[...]}: word timings are arrays, not objects (use w[0]/w[1] for start/end).',
    { path: z.string(), out: z.string().optional(), model: z.string().optional(), language: z.string().optional(), python: z.string().optional() },
    async (a) => {
      const out = a.out || path.join(cfg.workDir, 'transcripts', path.basename(a.path).replace(/\.[^.]+$/, '') + '.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const py = a.python || cfg.python || (process.platform === 'win32' ? 'python' : 'python3');
      const j = startJob('transcribe', py, ['-u', path.join(ROOT, 'scripts', 'transcribe.py'), a.path, out, '--model', a.model || 'large-v3', '--language', a.language || 'en']);
      j.output = out;
      return text({ job: j.id, out, hint: 'poll host_job; needs faster-whisper. For GPU on Windows also: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*' });
    });

  tool('media_beats', 'Beat grid of a music file (numpy only, no librosa needed): BPM, every beat time, the strongest hits (drops), loudness per second. offset: seconds into the song that play at video time 0, so beats come back in VIDEO time. cuts: your cut times, each reported with how many frames it is off the nearest beat. Use to snap montage cuts to the music and to line a drop up with a hero shot.',
    { path: z.string(), offset: z.number().optional(), duration: z.number().optional(), cuts: z.array(z.number()).optional(), python: z.string().optional() },
    async (a) => {
      const py = a.python || cfg.python || (process.platform === 'win32' ? 'python' : 'python3');
      const args = ['-u', path.join(ROOT, 'scripts', 'beats.py'), ffmpegPath, a.path, '--offset', String(a.offset || 0), '--duration', String(a.duration || 0)];
      if (a.cuts && a.cuts.length) args.push('--cuts', a.cuts.join(','));
      const out = await new Promise((ok, bad) => execFile(py, args, { maxBuffer: 1 << 24, timeout: 180000, windowsHide: true }, (e, so, se) => e ? bad(new Error(String(se || e) + ' (needs python with numpy)')) : ok(String(so))));
      return text(JSON.parse(out));
    });

  tool('pr_build_cut', 'Build a new sequence from source ranges in one call: segments [{item, in, out, label?}] are laid end to end on V1/A1 in order (source seconds, snapped to frames). Sequence settings come from the first item. Use for selects reels, interview cleanups (keep-ranges from media_transcribe), assemblies. replace: true deletes an existing sequence with the same name first.',
    { name: z.string(), segments: z.array(z.object({ item: z.string(), in: z.number(), out: z.number(), label: z.string().optional() }).passthrough()).optional(),
      segments_file: z.string().optional().describe('Path to a JSON file holding the segments array (or {segments:[...]}) on this computer. Use for long interview cuts instead of pasting 100+ segments.'),
      bin: z.string().optional(), gap: z.number().optional(), audio: z.boolean().optional(), replace: z.boolean().optional(), expected_project: guard },
    async (a) => {
      if (a.segments_file) { const j = JSON.parse(fs.readFileSync(a.segments_file, 'utf8')); a = { ...a, segments: Array.isArray(j) ? j : j.segments }; delete a.segments_file; }
      if (!a.segments || !a.segments.length) return fail('give segments or segments_file');
      a.segments = a.segments.map(s => ({ item: s.item, in: Math.max(0, s.in), out: s.out, label: s.label }));
      return text(await pr('pr_build_cut', a, readJsx('build_cut.jsx'), { expectedProject: a.expected_project, timeoutSec: 600 }));
    });

  tool('pr_grade', 'Color every clip on a video track (V1 unless track is given) of a sequence (or the given clip indexes): gives each clip two Lumetri Colors: the first holds only the .cube conversion LUT (e.g. camera log to Rec.709), the second holds the look sliders, so the correction happens after the conversion. look keys: temperature, tint, exposure, contrast, highlights, shadows, whites, blacks, saturation (Basic, 100 = none), vibrance, creative_saturation, sharpen, faded_film. Re-run with new look values to adjust; existing Lumetri is reused.',
    { sequence: z.string(), track: z.number().optional().describe('1-based video track, default 1 (use 2 for B-roll laid over interviews)'), lut: z.string().optional(), look: z.record(z.number()).optional(), clips: z.array(z.number()).optional(), expected_project: guard },
    async (a) => text(await pr('pr_grade', a, readJsx('grade.jsx'), { expectedProject: a.expected_project, timeoutSec: 600 })));
  tool('pr_assemble', 'Build a multi-track sequence from a timed edit list in one call: each clip {item, in, out, at, v, a, scale?, pos?, gain_db?, label?} lands at its own timeline time on video track v and audio track a (1-based; v 0 = audio only, a 0 = no audio). Use for documentaries: interviews on V1/A1, B-roll on V2 with nat sound on A3 at -18 dB, music on A4. xfade {frames, tracks} adds Constant Power crossfades on butt edits. clips_file: JSON on this computer instead of pasting.',
    { name: z.string(), like: z.string().optional(), bin: z.string().optional(), replace: z.boolean().optional(),
      clips: z.array(z.object({ item: z.string(), in: z.number(), out: z.number(), at: z.number() }).passthrough()).optional(), clips_file: z.string().optional(),
      xfade: z.object({ frames: z.number().optional(), tracks: z.array(z.number()).optional() }).optional(), expected_project: guard },
    async (a) => {
      if (a.clips_file) { const j = JSON.parse(fs.readFileSync(a.clips_file, 'utf8')); a = { ...a, clips: Array.isArray(j) ? j : j.clips, xfade: a.xfade || j.xfade }; delete a.clips_file; }
      if (!a.clips || !a.clips.length) return fail('give clips or clips_file');
      return text(await pr('pr_assemble', a, readJsx('assemble.jsx'), { expectedProject: a.expected_project, timeoutSec: 900 }));
    });

}
