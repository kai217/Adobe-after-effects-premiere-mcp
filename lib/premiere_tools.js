// Premiere Pro tools (pr_*), plus bridge diagnostics (kai_doctor) and After Effects MOGRT export.
// Premiere scripts run through the KAI MCP Bridge CEP panel (cep/). See docs/PR_GOTCHAS.md.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { thumbJpeg, contactSheet, waitForPngs } from './media.js';
import { readHeartbeat, describeBridge, isAERunning, isPRRunning, isILRunning, findAfterFX, aeProcess, clearStaleJobs, SAFE_MODE_MSG, ROOT } from './ae.js';
import { readUxpHeartbeat, describeUxp } from './uxp.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const q = (s) => JSON.stringify(String(s).replace(/\\/g, '/'));

export function registerPremiere({ tool, text, fail, ae, cfg, z }) {
  const pr = (name, args, code, opts = {}) => ae(name, args, code, { ...opts, host: 'pr' });
  const guard = z.string().optional().describe('Project guard: refuse to run unless the open .prproj path contains this text. Use it for every edit to a client project.');

  tool('pr_status', 'Check that Premiere Pro is reachable through the KAI MCP Bridge panel and report version, open project, sequences and the active sequence. Call first in a Premiere session, then pr_guide once.', {},
    async () => {
      const hb = readHeartbeat(cfg, 'pr');
      if (!hb.connected) return text({ running: await isPRRunning(), bridge: describeBridge(hb, 'Premiere Pro'), hint: 'Open Premiere; the bridge starts by itself (or Window > Extensions (Legacy) > KAI MCP Bridge). Run install.bat once if it is missing.' });
      const r = await pr('pr_status', {}, `
        var p = app.project, s = p.sequences, seqs = [];
        for (var i = 0; i < s.numSequences; i++) seqs.push(s[i].name);
        return { version: app.version, project: p.path, name: p.name, sequences: seqs, active: p.activeSequence ? p.activeSequence.name : null };`, { timeoutSec: 30 });
      return text({ bridge: describeBridge(hb, 'Premiere Pro'), ...r });
    });

  tool('pr_guide', 'Read once per Premiere session: Premiere scripting gotchas (time/ticks, track indexes, Dynamic Link comps, QE DOM, what cannot be scripted) and the KAI.* helpers available in every pr_run_script.', {},
    async () => text(fs.readFileSync(path.join(ROOT, 'docs', 'PR_GOTCHAS.md'), 'utf8') + '\n\n## KAI helpers (pr_run_script)\n' +
      fs.readFileSync(path.join(ROOT, 'jsx', 'pr_prelude.jsx'), 'utf8').split('\n').filter(l => /^\s*K\.[A-Za-z_]+ = |^\s*\/\/ /.test(l)).map(l => l.trim()).join('\n')));

  tool('pr_run_script', 'Run any ExtendScript in the open Premiere Pro project and return its result (body of a function; `return` sends data back). Helpers: KAI.seq(name), KAI.item(nameOrNodeIdOrBinPath), KAI.bin("a/b"), KAI.walk(fn), KAI.seqInfo(seq), KAI.clipInfo(clip), KAI.sec(time), KAI.time(seconds), KAI.tc(seq, seconds). ARGS holds args. Premiere has no scripted undo groups: save a version first (pr_save mode "version") before big edits.',
    { code: z.string(), args: z.record(z.any()).optional(), timeout_sec: z.number().optional(), expected_project: guard },
    async (a) => text(await pr('pr_run_script', a.args || {}, a.code, { timeoutSec: a.timeout_sec, expectedProject: a.expected_project })));

  tool('pr_project', 'List Premiere project items (bins, clips, sequences, After Effects Dynamic Link comps) with nodeId, bin path, media path and offline status. Filter by type and/or a name regex.',
    { type: z.enum(['all', 'sequence', 'clip', 'bin', 'ae_comp', 'offline']).optional(), name: z.string().optional().describe('regex on item name'), limit: z.number().optional() },
    async (a) => text(await pr('pr_project', a, `
      var out = [], re = ARGS.name ? new RegExp(ARGS.name, 'i') : null, lim = ARGS.limit || 1000, t = ARGS.type || 'all';
      KAI.walk(function (c, bp) { var inf = KAI.itemInfo(c, bp);
        if (re && !re.test(c.name)) return false;
        if (t == 'ae_comp' ? !inf.aeComp : t == 'offline' ? !inf.offline : (t != 'all' && inf.type != t)) return false;
        out.push(inf); return out.length >= lim; });
      return { count: out.length, items: out };`)));

  tool('pr_sequence', 'Describe a sequence: size, fps, duration, markers, every video/audio track and every clip (start/end/in/out seconds, source item, media path, Dynamic Link AE comp flag, speed, disabled, effects). Optionally only clips between two times.',
    { sequence: z.string().optional().describe('default: active sequence'), from_time: z.number().optional(), to_time: z.number().optional() },
    async (a) => text(await pr('pr_sequence', a, `return KAI.seqInfo(KAI.seq(ARGS.sequence), ARGS.from_time, ARGS.to_time);`)));

  tool('pr_import', 'Import media files into the Premiere project, optionally into a bin path (created if missing).',
    { paths: z.array(z.string()), bin: z.string().optional(), expected_project: guard },
    async (a) => {
      // A missing or unreadable file makes Premiere show a modal "File Import Failure" dialog that blocks the bridge
      // until someone clicks OK. Check every path first and refuse instead.
      const bad = a.paths.filter(p => { try { const st = fs.statSync(p); if (!st.isFile() || st.size === 0) return true; fs.closeSync(fs.openSync(p, 'r')); return false; } catch { return true; } });
      if (bad.length && !process.env.KAI_AE_MOCK) return fail('not importing (missing, empty or locked): ' + bad.join(', '));
      return text(await pr('pr_import', a, `
      var b = KAI.bin(ARGS.bin), ok = app.project.importFiles(ARGS.paths, true, b, false);
      var names = []; for (var i = 0; i < b.children.numItems; i++) names.push(b.children[i].name);
      return { imported: ok, bin: ARGS.bin || '(root)', binContents: names };`, { expectedProject: a.expected_project }));
    });

  tool('pr_import_ae_comps', 'Import After Effects comps into Premiere as Dynamic Link clips (not renders), so changes in AE update in Premiere. Give the saved .aep path and comp names (omit to import every comp).',
    { aep: z.string(), comps: z.array(z.string()).optional(), bin: z.string().optional(), expected_project: guard },
    async (a) => text(await pr('pr_import_ae_comps', a, `
      var b = KAI.bin(ARGS.bin), ok;
      if (ARGS.comps && ARGS.comps.length) ok = app.project.importAEComps(ARGS.aep, ARGS.comps, b); else ok = app.project.importAllAEComps(ARGS.aep, b);
      var got = []; for (var i = 0; i < b.children.numItems; i++) { var inf = KAI.itemInfo(b.children[i], ARGS.bin); if (inf.aeComp) got.push(inf); }
      return { ok: ok, bin: ARGS.bin || '(root)', aeComps: got };`, { expectedProject: a.expected_project, timeoutSec: 300 })));

  tool('pr_new_sequence', 'Create a sequence. from_items: build it from project items (it takes their size/fps). Or clone an existing sequence with clone_of (safe way to edit a copy).',
    { name: z.string(), from_items: z.array(z.string()).optional(), clone_of: z.string().optional(), bin: z.string().optional(), expected_project: guard },
    async (a) => text(await pr('pr_new_sequence', a, `
      var s;
      if (ARGS.clone_of) { var src = KAI.seq(ARGS.clone_of), before = app.project.sequences.numSequences; src.clone();
        var all = app.project.sequences; s = all[all.numSequences - 1]; if (all.numSequences == before) throw new Error('clone failed'); s.name = ARGS.name; }
      else { var items = []; for (var i = 0; i < (ARGS.from_items || []).length; i++) items.push(KAI.item(ARGS.from_items[i]));
        if (!items.length) throw new Error('give from_items or clone_of'); s = app.project.createNewSequenceFromClips(ARGS.name, items, KAI.bin(ARGS.bin)); }
      return KAI.seqInfo(s);`, { expectedProject: a.expected_project })));

  tool('pr_place', 'Put a project item (clip, sequence, or Dynamic Link AE comp) on a sequence track at a time. mode "overwrite" (default) or "insert" (ripples later clips). Track numbers start at 1.',
    { item: z.string(), sequence: z.string().optional(), video_track: z.number().optional().describe('linked audio goes to the matching audio track'), audio_track: z.number().optional().describe('for audio-only files (wav/mp3...): audio track, default 1'), time: z.number().describe('seconds'), mode: z.enum(['overwrite', 'insert']).optional(), expected_project: guard },
    async (a) => text(await pr('pr_place', a, `
      var s = KAI.seq(ARGS.sequence), it = KAI.item(ARGS.item), vt = ARGS.video_track || 1, path = ''; try { path = it.getMediaPath() || ''; } catch (e) {}
      // audio-only media (music, VO) goes on an audio track; the result reports the track it actually landed on
      var audioOnly = /\.(wav|mp3|aif|aiff|m4a|aac|flac|ogg|wma)$/i.test(path);
      if (audioOnly) { var at = ARGS.audio_track || 1, atr = s.audioTracks[at - 1]; if (!atr) throw new Error('no audio track ' + at);
        if (ARGS.mode == 'insert') atr.insertClip(it, ARGS.time); else atr.overwriteClip(it, ARGS.time);
        return { placed: 'audio', track: KAI.trackInfo(s.audioTracks[at - 1], at - 1, ARGS.time - 0.01, ARGS.time + 0.01) }; }
      var tr = s.videoTracks[vt - 1]; if (!tr) throw new Error('no video track ' + vt);
      if (ARGS.mode == 'insert') tr.insertClip(it, ARGS.time); else tr.overwriteClip(it, ARGS.time);
      return { placed: 'video', track: KAI.trackInfo(s.videoTracks[vt - 1], vt - 1, ARGS.time - 0.01, ARGS.time + 0.01) };`, { expectedProject: a.expected_project })));

  tool('pr_clip', 'Edit one clip on a sequence track: set start/end/in/out (seconds), enable/disable, rename, or remove (ripple optional). Track numbers start at 1; clip index from pr_sequence.',
    { sequence: z.string().optional(), track: z.number(), kind: z.enum(['video', 'audio']).optional(), clip: z.number().describe('clip index on the track'),
      start: z.number().optional(), end: z.number().optional(), in_point: z.number().optional(), out_point: z.number().optional(),
      disabled: z.boolean().optional(), name: z.string().optional(), remove: z.boolean().optional(), ripple: z.boolean().optional(), expected_project: guard },
    async (a) => text(await pr('pr_clip', a, `
      var s = KAI.seq(ARGS.sequence), trs = ARGS.kind == 'audio' ? s.audioTracks : s.videoTracks, tr = trs[ARGS.track - 1];
      if (!tr) throw new Error('no track ' + ARGS.track); var c = tr.clips[ARGS.clip]; if (!c) throw new Error('no clip ' + ARGS.clip + ' on track ' + ARGS.track);
      if (ARGS.remove) { c.remove(!!ARGS.ripple, true); return { removed: true }; }
      if (ARGS.in_point !== undefined) c.inPoint = KAI.time(ARGS.in_point);
      if (ARGS.out_point !== undefined) c.outPoint = KAI.time(ARGS.out_point);
      if (ARGS.start !== undefined) c.start = KAI.time(ARGS.start);
      if (ARGS.end !== undefined) c.end = KAI.time(ARGS.end);
      if (ARGS.disabled !== undefined) c.disabled = ARGS.disabled;
      if (ARGS.name) c.name = ARGS.name;
      var info = KAI.clipInfo(tr.clips[ARGS.clip], ARGS.clip);
      if (ARGS.end !== undefined || ARGS.start !== undefined) info.note = 'Premiere keeps reporting the old in/out after start/end edits; start/end are the real timeline range.';
      return info;`, { expectedProject: a.expected_project })));

  tool('pr_preview', 'Export still frames of a sequence (no playhead move, no render) and show them as a contact sheet or single images. Times in sequence seconds.',
    { sequence: z.string().optional(), times: z.array(z.number()), sheet: z.boolean().optional(), max_width: z.number().optional() },
    async (a) => {
      const dir = path.join(cfg.workDir, 'frames', 'pr_' + Date.now()); fs.mkdirSync(dir, { recursive: true });
      const r = await pr('pr_preview', a, `
        var s = KAI.seq(ARGS.sequence), prev = app.project.activeSequence; app.project.activeSequence = s;
        app.enableQE(); var qs = qe.project.getActiveSequence(); if (!qs) throw new Error('QE: no active sequence');
        var out = [];
        for (var i = 0; i < ARGS.times.length; i++) { var t = KAI.tc(s, ARGS.times[i]), base = ${JSON.stringify(process.platform === 'win32' ? dir.replace(/\//g, '\\') : dir)} + ${JSON.stringify(process.platform === 'win32' ? '\\' : '/')} + 'f_' + ('0000' + i).slice(-4);
          qs.exportFramePNG(t.tc, base); out.push({ time: ARGS.times[i], timecode: t.tc, frame: t.frame, base: base }); }
        try { if (prev && prev.sequenceID != s.sequenceID) app.project.activeSequence = prev; } catch (e) {}
        return { sequence: s.name, frames: out };`, { timeoutSec: 300 });
      // QE appends ".png" itself and writes asynchronously.
      const files = [];
      for (const f of r.frames) {
        let hit = null; const t0 = Date.now();
        while (!hit && Date.now() - t0 < 30000) { for (const c of [f.base + '.png', f.base + '.png.png', f.base]) if (fs.existsSync(c)) { hit = c; break; } if (!hit) await sleep(200); }
        if (!hit) return fail(`Premiere did not write the frame at ${f.timecode}. QE frame export may be unavailable in this version.`);
        files.push(hit);
      }
      await waitForPngs(files);
      const content = [{ type: 'text', text: JSON.stringify({ sequence: r.sequence, frames: r.frames.map((f, i) => ({ time: f.time, timecode: f.timecode, file: files[i] })) }) }];
      if (a.sheet !== false && files.length > 1) {
        const sheet = await contactSheet(files, path.join(dir, 'sheet.png'), { tileW: Math.min(320, Math.floor((a.max_width || 1800) / Math.min(6, files.length))) });
        content.push({ type: 'image', data: (await thumbJpeg(sheet, a.max_width || 1800)).toString('base64'), mimeType: 'image/jpeg' });
      } else for (const f of files) content.push({ type: 'image', data: (await thumbJpeg(f, a.max_width || 540)).toString('base64'), mimeType: 'image/jpeg' });
      return { content };
    });

  tool('pr_open', 'Open a .prproj in Premiere Pro (it becomes the active project; other open projects stay open). Dialogs about conversion, missing media and warnings are suppressed so the bridge never blocks.',
    { path: z.string() },
    async (a) => text(await pr('pr_open', a, `
      var f = new File(ARGS.path); if (!f.exists) throw new Error('file not found: ' + ARGS.path);
      for (var i = 0; i < app.projects.numProjects; i++) { var q = app.projects[i]; if (new File(q.path).fsName.toLowerCase() == f.fsName.toLowerCase()) { app.openDocument(f.fsName, true, true, true, true); return { opened: q.path, already: true }; } }
      var ok = app.openDocument(f.fsName, true, true, true, true); if (!ok) throw new Error('Premiere could not open ' + f.fsName);
      var p = app.project, seqs = []; for (var s = 0; s < p.sequences.numSequences; s++) seqs.push(p.sequences[s].name);
      return { opened: p.path, sequences: seqs };`, { timeoutSec: 300 })));

  tool('pr_save', 'Save the Premiere project. mode "save" overwrites; "version" saves a numbered copy next to it (Name_v001.prproj...) and keeps working in the copy; "as" saves to a path.',
    { mode: z.enum(['save', 'version', 'as']).optional(), path: z.string().optional() },
    async (a) => text(await pr('pr_save', a, `
      var p = app.project, m = ARGS.mode || 'version';
      if (!p || !p.path) throw new Error('No Premiere project is open. Open one with pr_open first.');
      // Plain project.save() pops a modal "Project Modified ... continue?" whenever Premiere thinks the file changed on disk
      // (seen after scripted saveAs, on exFAT drives, and with mixed / and \\ in the path). A modal blocks the bridge until
      // someone clicks OK. saveAs() to the project's own path never shows it, so "save" uses that.
      var here = new File(p.path).fsName;
      if (m == 'save') { p.saveAs(here); return { saved: here }; }
      var target = ARGS.path;
      if (m == 'version') { var f = new File(here), base = f.name.replace(/(_v\\d+)?\\.prproj$/i, ''), n = 1;
        do { target = new File(f.parent.fsName + '/' + base + '_v' + ('00' + n).slice(-3) + '.prproj').fsName; n++; } while (new File(target).exists); }
      if (!target) throw new Error('give path for mode "as"');
      target = new File(target).fsName; // native separators: a mixed-slash path is what Premiere later reports as "modified since last save"
      p.saveAs(target); return { saved: target };`, { timeoutSec: 300 })));

  tool('pr_export', 'Export a sequence to a file with a Media Encoder preset (.epr). Only use when the user explicitly asks for a render/export. Runs inside Premiere (busy until done) unless queue_in_ame is true.',
    { sequence: z.string().optional(), output: z.string(), preset: z.string().describe('path to an .epr preset'), queue_in_ame: z.boolean().optional(), timeout_sec: z.number().optional() },
    async (a) => {
      fs.mkdirSync(path.dirname(a.output), { recursive: true });
      return text(await pr('pr_export', a, `
        var s = KAI.seq(ARGS.sequence);
        if (ARGS.queue_in_ame) { app.encoder.launchEncoder(); var id = app.encoder.encodeSequence(s, ARGS.output, ARGS.preset, app.encoder.ENCODE_ENTIRE, 1); app.encoder.startBatch(); return { queued: id }; }
        var r = s.exportAsMediaDirect(ARGS.output, ARGS.preset, app.encoder.ENCODE_ENTIRE);
        var f = new File(ARGS.output); if (!f.exists) throw new Error('export failed: ' + r);
        return { output: f.fsName, bytes: f.length };`, { timeoutSec: a.timeout_sec || 3600 }));
    });

  // ---------- After Effects: Motion Graphics Template ----------
  tool('ae_export_mogrt', 'Export an After Effects comp as a Motion Graphics Template (.mogrt) for Premiere\'s Essential Graphics panel. properties: [{layer, path, name}] exposes those properties as editable controls (text, colors, sliders). path uses matchNames like ae_set, e.g. "ADBE Text Properties/ADBE Text Document".',
    { comp: z.string(), output: z.string().describe('.mogrt file path'), template_name: z.string().optional(),
      properties: z.array(z.object({ layer: z.union([z.string(), z.number()]), path: z.string(), name: z.string() })).optional() },
    async (a) => {
      fs.mkdirSync(path.dirname(a.output), { recursive: true });
      return text(await ae('ae_export_mogrt', a, `
        var c = KAI.comp(ARGS.comp), added = [];
        if (ARGS.template_name) c.motionGraphicsTemplateName = ARGS.template_name;
        var props = ARGS.properties || [];
        for (var i = 0; i < props.length; i++) { var L = KAI.layer(c, props[i].layer), p = KAI.prop(L, props[i].path);
          if (!p) throw new Error('property not found: ' + props[i].path + ' on ' + L.name);
          if (!p.canAddToMotionGraphicsTemplate(c)) throw new Error(props[i].path + ' on ' + L.name + ' cannot be added to Essential Graphics');
          p.addToMotionGraphicsTemplateAs(c, props[i].name); added.push(props[i].name); }
        // exportAsMotionGraphicsTemplate takes a FOLDER and names the file after the template name. Export into a temp
        // folder next to the target, then move the .mogrt to the exact path asked for.
        var want = new File(ARGS.output); if (!/\.mogrt$/i.test(want.name)) want = new File(want.fsName + '.mogrt');
        var tmp = new Folder(want.parent.fsName + '/_mogrt_' + new Date().getTime()); tmp.create();
        var ok = c.exportAsMotionGraphicsTemplate(true, tmp.fsName), made = tmp.getFiles('*.mogrt');
        if (!ok || !made.length) { try { tmp.remove(); } catch (e) {} throw new Error('export failed (the project must be saved first)'); }
        if (want.exists) want.remove(); made[0].copy(want.fsName); made[0].remove(); tmp.remove();
        return { output: want.fsName, bytes: want.length, controls: added };`, { undo: 'export mogrt ' + a.comp, timeoutSec: 600 }));
    });

  // ---------- diagnostics ----------
  tool('kai_doctor', 'Diagnose the whole setup: Node, config, After Effects / Premiere / Illustrator installed and running, CEP bridge and UXP plugin status, bridge panel installed, unsigned-extension (PlayerDebugMode) keys, and live bridge status for both apps (connected, busy with a job, or not responding). Read-only. Run when anything fails to connect.', {},
    async () => {
      const reg = (k) => new Promise(res => process.platform !== 'win32' ? res(null) :
        execFile('reg', ['query', `HKCU\\Software\\Adobe\\${k}`, '/v', 'PlayerDebugMode'], (e, out) => res(e ? null : (/PlayerDebugMode\s+REG_SZ\s+(\S+)/.exec(out) || [])[1] || null)));
      const csxs = {}; for (const v of [9, 10, 11, 12]) csxs['CSXS.' + v] = await reg('CSXS.' + v);
      const extDir = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions', 'com.kai.mcp.bridge')
        : path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'com.kai.mcp.bridge');
      let ext = null; try { ext = fs.realpathSync(extDir); } catch {}
      const ae = readHeartbeat(cfg, 'ae'), prh = readHeartbeat(cfg, 'pr');
      const problems = [];
      const aeProc = aeProcess();
      if (aeProc && aeProc.safeMode) problems.push(SAFE_MODE_MSG);
      if (aeProc && !aeProc.responding) problems.push('After Effects is not answering Windows right now (a long script, a render, a modal dialog, or a hang).');
      const leftover = (h) => { try { return fs.readdirSync(path.join(cfg.workDir, h === 'ae' ? '' : h, 'queue')).filter(n => /\.running\./.test(n) && !/\.stale$/.test(n)).length; } catch { return 0; } };
      if (ae.inFlight && ae.busyMs > 120000) problems.push('After Effects has been inside one job for ' + Math.round(ae.busyMs / 1000) + 's. If the app looks idle, run kai_reset.');
      if (!ae.connected && leftover('ae')) problems.push('The After Effects queue holds a job left behind by a closed or crashed session: run kai_reset.');
      if (!ext) problems.push('Bridge panel not installed: run install.bat (or node scripts/install.mjs).');
      if (process.platform === 'win32' && !Object.values(csxs).some(v => v === '1')) problems.push('PlayerDebugMode is off, so Adobe apps refuse the unsigned bridge panel: run install.bat.');
      return text({ node: process.version, workDir: cfg.workDir, afterFX: findAfterFX(cfg), aeRunning: await isAERunning(), aeProcess: aeProc, prRunning: await isPRRunning(),
        bridgeInstalled: ext, playerDebugMode: csxs,
        afterEffects: describeBridge(ae, 'After Effects'), premiere: describeBridge(prh, 'Premiere Pro'),
        illustrator: { running: await isILRunning(), bridge: describeBridge(readHeartbeat(cfg, 'il'), 'Illustrator'), note: 'without the panel, il_* tools use the direct COM/AppleScript route' },
        uxp: { premiere: describeUxp(readUxpHeartbeat(cfg, 'pr'), 'pr'), afterEffects: describeUxp(readUxpHeartbeat(cfg, 'ae'), 'ae'), plugin: path.join(ROOT, 'uxp', 'kai-mcp-bridge') },
        problems });
    });

  tool('kai_reset', 'Unstick the bridge after a job that never reported back: a render stopped in the app, a script cut short by a dialog, or an app that was closed or crashed mid-job. Until then every call answers "busy" or "still running an earlier script". Moves the leftover job aside, tells the bridge panel to drop it, and reports whether the app answers again. It does not close or restart anything and does not touch the project. app: "ae" (default), "pr" or "il".',
    { app: z.enum(['ae', 'pr', 'il']).optional() },
    async (a) => {
      const host = a.app || 'ae', name = host === 'pr' ? 'Premiere Pro' : host === 'il' ? 'Illustrator' : 'After Effects';
      const before = readHeartbeat(cfg, host);
      const out = { app: name, before: describeBridge(before, name) };
      if (host === 'ae') { const p = aeProcess(); if (p) { out.process = p; if (p.safeMode) out.safeMode = SAFE_MODE_MSG; } else if (!(await isAERunning())) out.running = false; }
      if (before.connected) {
        fs.writeFileSync(path.join(cfg.workDir, 'bridge', 'reset-' + host + '.flag'), String(Date.now()));
        let hb = before;
        for (let i = 0; i < 40 && !process.env.KAI_AE_MOCK; i++) { await new Promise(r => setTimeout(r, 250)); hb = readHeartbeat(cfg, host); if (hb.connected && !hb.inFlight && hb.replyAgeMs !== null && hb.replyAgeMs < 4000) break; }
        out.after = describeBridge(hb, name);
        out.cleared = !!before.inFlight && !hb.inFlight;
        if (hb.connected && !hb.inFlight && hb.replyAgeMs > 8000) out.note = name + ' still does not answer scripts: it is inside a script, a render or a dialog. Look at the app; if it stays that way, save if you can and close it normally (not a forced quit), then reopen it.';
      } else {
        out.movedAside = clearStaleJobs(cfg, host);
        out.after = describeBridge(readHeartbeat(cfg, host), name);
        out.note = 'The bridge panel is not connected, so only leftover job files were moved aside. Open the app (Window > Extensions (Legacy) > KAI MCP Bridge shows the panel).';
      }
      return text(out);
    });
}
