// Gap-fillers that other AE/Premiere MCPs have (markers, presets, audio analysis) plus captions built from our own transcripts.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { thumbJpeg } from './media.js';

const ff = (args) => new Promise((res, rej) => execFile(ffmpegPath, ['-hide_banner', '-nostats', ...args], { maxBuffer: 1 << 28 }, (e, so, se) => e ? rej(new Error(String(se || e))) : res(String(se) + String(so))));
const srtTime = (t) => { const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };

// Words -> caption blocks: max chars per line, max 2 lines, max seconds per block, break on pauses and sentence ends. Fillers dropped.
export function captionBlocks(words, { maxChars = 38, maxLines = 2, maxDur = 5.5, pause = 0.6 } = {}) {
  const layout = (ws) => { const lines = ['']; for (const w of ws) { const L = lines[lines.length - 1]; if (L && (L + ' ' + w.text).length > maxChars) lines.push(w.text); else lines[lines.length - 1] = (L + ' ' + w.text).trim(); } return lines; };
  const blocks = []; let cur = [];
  const flush = () => { if (cur.length) blocks.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: layout(cur).join('\n') }); cur = []; };
  for (const w of words) { const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > pause || w.end - cur[0].start > maxDur || layout([...cur, w]).length > maxLines)) flush();
    cur.push(w); if (/[.?!]$/.test(w.text) && cur.length >= 2) flush(); }
  flush();
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].end = Math.min(blocks[i].end + 0.25, blocks[i + 1].start - 0.04); // small hold, never overlap
  return blocks;
}

export function registerExtras({ tool, text, fail, ae, cfg, z }) {
  const pr = (name, args, code, opts = {}) => ae(name, args, code, { ...opts, host: 'pr' });

  tool('ae_markers', 'List, add or remove markers on a comp or a layer in After Effects. Markers: [[time_seconds, comment, duration?, label_color 0-16?], ...].',
    { comp: z.string().optional(), layer: z.union([z.string(), z.number()]).optional(), action: z.enum(['list', 'add', 'clear']), markers: z.array(z.array(z.any())).optional(), from_time: z.number().optional(), to_time: z.number().optional() },
    async (a) => text(await ae('ae_markers', a, `
      var c = KAI.comp(ARGS.comp), mk = ARGS.layer !== undefined ? KAI.layer(c, ARGS.layer).property('ADBE Marker') : c.markerProperty, out = [];
      if (ARGS.action == 'add') for (var i = 0; i < ARGS.markers.length; i++) { var m = ARGS.markers[i], mv = new MarkerValue(m[1] || ''); if (m[2]) mv.duration = m[2]; if (m[3] !== undefined) mv.label = m[3]; mk.setValueAtTime(m[0], mv); }
      if (ARGS.action == 'clear') for (var k = mk.numKeys; k >= 1; k--) { var t = mk.keyTime(k); if ((ARGS.from_time === undefined || t >= ARGS.from_time) && (ARGS.to_time === undefined || t <= ARGS.to_time)) mk.removeKey(k); }
      for (var j = 1; j <= mk.numKeys; j++) { var v = mk.keyValue(j); out.push([mk.keyTime(j), v.comment, v.duration, v.label]); }
      return { count: out.length, markers: out };`, { undo: a.action == 'list' ? undefined : 'Markers' })));

  tool('ae_apply_preset', 'Apply an Animation Preset (.ffx) to layers in a comp (After Effects layer.applyPreset). Layers by name, /regex/ or index; the preset adds its effects/keyframes at the layer time the comp is at (time_seconds).',
    { comp: z.string().optional(), layers: z.array(z.union([z.string(), z.number()])), preset: z.string().describe('path to .ffx'), time_seconds: z.number().optional() },
    async (a) => text(await ae('ae_apply_preset', a, `
      var c = KAI.comp(ARGS.comp), f = new File(ARGS.preset); if (!f.exists) throw new Error('preset not found: ' + ARGS.preset);
      if (ARGS.time_seconds !== undefined) c.time = ARGS.time_seconds;
      var done = [];
      for (var i = 0; i < ARGS.layers.length; i++) { var ref = ARGS.layers[i], targets = [];
        if (typeof ref == 'string' && ref.charAt(0) == '/') { var re = new RegExp(ref.replace(/^\\/|\\/[a-z]*$/g, ''), 'i'); for (var l = 1; l <= c.numLayers; l++) if (re.test(c.layer(l).name)) targets.push(c.layer(l)); }
        else targets.push(KAI.layer(c, ref));
        for (var t = 0; t < targets.length; t++) { for (var s = 1; s <= c.numLayers; s++) c.layer(s).selected = false; targets[t].selected = true; targets[t].applyPreset(f); done.push(targets[t].name); } }
      return { applied: done };`, { undo: 'Apply preset' })));

  tool('pr_markers', 'List, add or clear sequence markers in Premiere. Markers: [{time, name?, comment?, duration?, color 0-7?}].',
    { sequence: z.string().optional(), action: z.enum(['list', 'add', 'clear']), markers: z.array(z.object({ time: z.number(), name: z.string().optional(), comment: z.string().optional(), duration: z.number().optional(), color: z.number().optional() })).optional(),
      from_time: z.number().optional(), to_time: z.number().optional(), expected_project: z.string().optional() },
    async (a) => text(await pr('pr_markers', a, `
      var s = KAI.seq(ARGS.sequence), M = s.markers, out = [];
      if (ARGS.action == 'add') for (var i = 0; i < ARGS.markers.length; i++) { var m = ARGS.markers[i], mk = M.createMarker(m.time); if (m.name) mk.name = m.name; if (m.comment) mk.comments = m.comment; if (m.duration) mk.end = m.time + m.duration; /* marker.end takes seconds; a Time object throws 'Illegal Parameter type' */ if (m.color !== undefined) try { mk.setColorByIndex(m.color); } catch (e) {} }
      if (ARGS.action == 'clear') { var kill = [], x = M.getFirstMarker(); while (x) { var t = x.start.seconds; if ((ARGS.from_time === undefined || t >= ARGS.from_time) && (ARGS.to_time === undefined || t <= ARGS.to_time)) kill.push(x); x = M.getNextMarker(x); } for (var k = 0; k < kill.length; k++) M.deleteMarker(kill[k]); }
      var y = M.getFirstMarker(); while (y) { out.push({ time: y.start.seconds, end: y.end.seconds, name: y.name, comment: y.comments }); y = M.getNextMarker(y); }
      return { count: out.length, markers: out };`, { expectedProject: a.expected_project })));

  tool('pr_captions', 'Make a caption track in Premiere from a transcript JSON (media_transcribe output) or an .srt: builds readable caption blocks (line length, 2 lines max, breaks on pauses and sentence ends, fillers dropped), writes an .srt, imports it and adds it as a caption track to the sequence. offset_seconds shifts the transcript onto the sequence (e.g. when the transcript is of an exported mix that starts at 0).',
    { sequence: z.string().optional(), transcript: z.string().optional(), srt: z.string().optional(), offset_seconds: z.number().optional(), max_chars: z.number().optional(), max_lines: z.number().optional(), drop_fillers: z.boolean().optional(), at_seconds: z.number().optional(), expected_project: z.string().optional() },
    async (a) => {
      let srt = a.srt;
      if (!srt) {
        if (!a.transcript) return fail('give transcript (JSON from media_transcribe) or srt');
        const tj = JSON.parse(fs.readFileSync(a.transcript, 'utf8')), off = a.offset_seconds || 0, words = [];
        for (const sg of tj.segments || []) for (const w of sg.words || []) { const isFill = !!w[4]; if (isFill && a.drop_fillers !== false) continue; const raw = String(w[2]), t = raw.trim(); if (!t) continue;
          // a token without a leading space continues the previous word ("1" + ".28" -> "1.28", "don" + "'t")
          const prev = words[words.length - 1]; if (prev && !/^\s/.test(raw) && w[0] + off - prev.end < 0.3) { prev.text += t; prev.end = w[1] + off; } else words.push({ start: w[0] + off, end: w[1] + off, text: t }); }
        const blocks = captionBlocks(words, { maxChars: a.max_chars || 38, maxLines: a.max_lines || 2 });
        srt = path.join(cfg.workDir, 'pr', 'captions_' + Date.now() + '.srt');
        fs.writeFileSync(srt, blocks.map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.text}\n`).join('\n'), 'utf8');
      }
      return text({ srt, ...(await pr('pr_captions', { srt: srt.replace(/\\/g, '/'), sequence: a.sequence, at: a.at_seconds || 0 }, `
        var s = KAI.seq(ARGS.sequence), b = KAI.bin('Captions'); app.project.importFiles([ARGS.srt], true, b, false);
        var it = null, nm = ARGS.srt.split('/').pop(); for (var i = 0; i < b.children.numItems; i++) if (b.children[i].name == nm) it = b.children[i];
        if (!it) throw new Error('caption import failed');
        var ok = s.createCaptionTrack(it, ARGS.at, Sequence.CAPTION_FORMAT_SUBTITLE);
        return { captionTrackAdded: !!ok, item: it.name };`, { expectedProject: a.expected_project })) });
    });

  tool('media_waveform', 'Audio analysis of a file with the bundled ffmpeg: integrated loudness (LUFS), true peak, loudness range, a per-window level curve (dBFS), silent stretches, and a waveform image. Use it to check dialogue levels, find gaps/dead air, and place cuts and music hits.',
    { path: z.string(), window: z.number().optional().describe('seconds per level sample (default 0.5)'), silence_db: z.number().optional().describe('default -45'), min_silence: z.number().optional().describe('seconds (default 0.6)'), image: z.boolean().optional() },
    async (a) => {
      if (!fs.existsSync(a.path)) return fail('not found: ' + a.path);
      const win = a.window || 0.5, sdb = a.silence_db ?? -45, ms = a.min_silence || 0.6;
      const lo = await ff(['-i', a.path, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
      const pick = (re) => { const m = lo.match(re); return m ? Number(m[1]) : null; };
      const levels = [], st = await ff(['-i', a.path, '-vn', '-af', `aresample=16000,asetnsamples=n=${Math.round(16000 * win)},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`, '-f', 'null', '-']);
      for (const m of st.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)) levels.push(m[1] === '-inf' ? -120 : Math.round(Number(m[1]) * 10) / 10);
      const sil = [], si = await ff(['-i', a.path, '-vn', '-af', `silencedetect=noise=${sdb}dB:d=${ms}`, '-f', 'null', '-']);
      let s0 = null; for (const m of si.matchAll(/silence_(start|end): (-?[\d.]+)/g)) { if (m[1] === 'start') s0 = Number(m[2]); else { sil.push([Math.max(0, s0 ?? 0), Number(m[2])]); s0 = null; } }
      const out = { integratedLUFS: pick(/I:\s+(-?[\d.]+) LUFS/), loudnessRangeLU: pick(/LRA:\s+(-?[\d.]+) LU/), truePeakDBFS: pick(/Peak:\s+(-?[\d.]+) dBFS/), window: win, levels, silences: sil };
      const content = [{ type: 'text', text: JSON.stringify(out) }];
      if (a.image !== false) { const png = path.join(cfg.workDir, 'frames', 'wave_' + Date.now() + '.png');
        await ff(['-y', '-i', a.path, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1800x240:colors=0x5b99d6', '-frames:v', '1', png]);
        content.push({ type: 'image', data: (await thumbJpeg(png, 1800)).toString('base64'), mimeType: 'image/jpeg' }); }
      return { content };
    });
}
