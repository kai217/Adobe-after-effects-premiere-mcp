#!/usr/bin/env node
// KAI-AE-MCP — Kai's After Effects MCP server.
// Inspired by (MIT): Dakkshin/after-effects-mcp, TheLlamainator/after-effects-mcp, JUNKDOGE-JOE/after-effects-mcp. See THIRD_PARTY_NOTICES.md
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, runJob, findAfterFX, isAERunning, isPRRunning, readHeartbeat, describeBridge, ROOT } from './lib/ae.js';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { thumbJpeg, contactSheet, extractFrame, imageDiff, sideBySide, waitForPngs } from './lib/media.js';

const cfg = loadConfig();
const server = new McpServer({ name: 'kai-ae-mcp', version: '1.0.0' });
const LIB = path.join(ROOT, 'library');
fs.mkdirSync(LIB, { recursive: true });

// ---------- logging (training data) ----------
function log(entry) {
  const day = new Date().toISOString().slice(0, 10);
  try { fs.appendFileSync(path.join(cfg.workDir, 'logs', `ae-mcp-${day}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch {}
}
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: 'ERROR: ' + msg }], isError: true });

async function ae(tool, args, code, { undo, timeoutSec, expectedProject, host = 'ae' } = {}) {
  const t0 = Date.now();
  try {
    const r = await runJob(cfg, { code, args, undoName: undo, timeoutSec, label: tool, expectedProject, host });
    log({ tool, args, ok: r.ok, ms: Date.now() - t0, error: r.error, project: r.project, mode: r.mode, undo: undo || null,
      code: (/_run_script$/.test(tool) || tool.startsWith('ae_library')) ? code.slice(0, 8000) : undefined,
      result: JSON.stringify(r.result ?? null).slice(0, 4000) });
    if (!r.ok) throw new Error(`${r.error}${r.line ? ' (line ' + r.line + ')' : ''}`);
    return r.result;
  } catch (e) {
    log({ tool, args, ok: false, ms: Date.now() - t0, error: String(e.message || e) });
    throw e;
  }
}
function tool(name, description, shape, handler) {
  server.tool(name, description, shape, async (args) => {
    try { return await handler(args || {}); } catch (e) { return fail(String(e.message || e)); }
  });
}

// =====================================================================
tool('ae_status', 'Check that After Effects is reachable and report the open project, active comp, dirty state, version, and anything missing (footage, fonts, effects). Call this first in a session, then call ae_guide once to read the known gotchas before building.', {},
  async () => {
    const running = await isAERunning();
    if (!running) return text({ running: false, afterFX: findAfterFX(cfg), hint: 'Open After Effects and your project.' });
    const r = await ae('ae_status', {}, `
      var p = app.project, o = { version: app.version, project: p.file ? p.file.fsName : null, dirty: p.dirty, items: p.numItems,
        active: (p.activeItem && p.activeItem instanceof CompItem) ? KAI.itemInfo(p.activeItem) : null, missingFootage: [], missingFonts: [], missingEffects: [] };
      for (var i = 1; i <= p.numItems; i++) { var it = p.item(i); try { if (it instanceof FootageItem && it.footageMissing) o.missingFootage.push(it.name); } catch (e) {} }
      try { var m = app.fonts.missingOrSubstitutedFonts; for (var j = 0; j < m.length; j++) o.missingFonts.push(m[j].postScriptName || m[j].familyName); } catch (e) { o.missingFonts = 'unavailable'; }
      var inst = {}; try { for (var k = 0; k < app.effects.length; k++) inst[app.effects[k].matchName] = 1; } catch (e) {}
      var seen = {};
      for (var i2 = 1; i2 <= p.numItems; i2++) { var c = p.item(i2); if (!(c instanceof CompItem)) continue;
        for (var l = 1; l <= c.numLayers; l++) { var fx; try { fx = c.layer(l).property('ADBE Effect Parade'); } catch (e) { continue; } if (!fx) continue;
          for (var f = 1; f <= fx.numProperties; f++) { var mn = fx.property(f).matchName; if (!inst[mn] && !seen[mn]) { seen[mn] = 1; o.missingEffects.push(mn + ' (' + c.name + ' / ' + c.layer(l).name + ')'); } } } }
      o.scriptingWriteAllowed = true;
      return o;`, { timeoutSec: 60 });
    const hb = readHeartbeat(cfg, 'ae');
    return text({ running: true, mode: hb.connected ? 'panel' : (cfg.lastWorkingMode || cfg.mode), bridge: describeBridge(hb, 'After Effects'), ...r });
  });

tool('ae_guide', 'Read this once per session before building or editing: the known After Effects scripting gotchas (ES3 limits, invalidated shape references, clipped blurs, Glow color shift, copyToComp limits, project-editing rules) and the MK.* motion-kit helpers available in every script.',
  {}, async () => {
    const g = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs', 'AE_GOTCHAS.md'), 'utf8');
    const kit = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'jsx', 'motionkit.jsx'), 'utf8').split('\n').filter(l => /^MK\.[A-Za-z_]+ = function|^\/\//.test(l)).join('\n');
    return text(g + '\n\n## MK helpers (available in every ae_run_script)\n' + kit);
  });

tool('ae_check', 'Check a comp (and every comp nested in it) for problems: expression errors, disabled expressions, missing footage and fonts, blurs on shape layers that get clipped into a square, Glow effects that shift color, and track mattes pointing at missing layers. Read-only. Run after every build or edit step.',
  { comp: z.string().optional().describe('default: active comp'), nested: z.boolean().optional().describe('also check nested comps (default true)') },
  async (a) => text(await ae('ae_check', a, `
    var root = KAI.comp(ARGS.comp), seen = {}, issues = [], counts = { comps: 0, layers: 0, expressions: 0 };
    function add(sev, c, L, msg) { issues.push({ severity: sev, comp: c.name, layer: L ? (L.index + ' ' + L.name) : null, issue: msg }); }
    function visitProps(g, c, L) { for (var k = 1; k <= g.numProperties; k++) { var p = g.property(k); if (!p) continue;
      if (p.propertyType == PropertyType.PROPERTY) { var ex = ''; try { ex = p.canSetExpression ? p.expression : ''; } catch (e) {}
        if (ex) { counts.expressions++; if (p.expressionError) add('error', c, L, 'expression error on ' + p.name + ': ' + String(p.expressionError).substr(0, 160)); else if (!p.expressionEnabled) add('warn', c, L, 'expression disabled on ' + p.name); } }
      else visitProps(p, c, L); } }
    function checkComp(c) { if (seen[c.id]) return; seen[c.id] = 1; counts.comps++;
      for (var l = 1; l <= c.numLayers; l++) { var L = c.layer(l); counts.layers++;
        try { if (L.source && L.source.footageMissing) add('error', c, L, 'missing footage: ' + L.source.name); } catch (e) {}
        try { if (L.hasTrackMatte && !L.trackMatteLayer) add('error', c, L, 'track matte set but matte layer is missing'); } catch (e) {}
        if (L.matchName == 'ADBE Text Layer') { try { var td = L.property('ADBE Text Properties').property('ADBE Text Document').value; if (td.fontLocation === '' || td.fontLocation === undefined) {} } catch (e) {} }
        var fx = L.property('ADBE Effect Parade');
        if (fx) for (var f = 1; f <= fx.numProperties; f++) { var mn = fx.property(f).matchName; if (!fx.property(f).enabled) continue;
          if (mn == 'ADBE Glo2') add('warn', c, L, 'Glow effect: shifts saturated colors toward white/cyan; consider MK.halo');
          if (L.matchName == 'ADBE Vector Layer' && /Gaussian Blur|Box Blur|Fast Blur|Glo2|Camera Lens Blur/.test(mn + ' ' + fx.property(f).name)) {
            var r = null; try { r = L.sourceRectAtTime(L.inPoint, false); } catch (e) {}
            var pad = false; try { var rv = L.property('ADBE Root Vectors Group'); for (var g = 1; g <= rv.numProperties && !pad; g++) { var G = rv.property(g); if (G.matchName != 'ADBE Vector Group') continue; var cv = G.property('ADBE Vectors Group'); var shp = false, vis = false; for (var q = 1; q <= cv.numProperties; q++) { var Q = cv.property(q); if (/Shape - (Rect|Ellipse|Group)/.test(Q.matchName)) shp = true; if (Q.matchName == 'ADBE Vector Graphic - Fill' && Q.enabled && Q.property('ADBE Vector Fill Opacity').value > 0) vis = true; if (Q.matchName == 'ADBE Vector Graphic - Stroke' && Q.enabled && Q.property('ADBE Vector Stroke Opacity').value > 0) vis = true; } if (shp && !vis) pad = true; } } catch (e) {}
            if (!pad && r && (r.width < c.width * 1.2 || r.height < c.height * 1.2)) add('warn', c, L, 'blur on a shape layer is clipped to its content bounds (' + Math.round(r.width) + 'x' + Math.round(r.height) + '), which shows as a hard square edge; add a large transparent rect (MK.halo does this)'); } }
        visitProps(L, c, L);
        if (ARGS.nested !== false && L.source && L.source instanceof CompItem) checkComp(L.source); } }
    checkComp(root);
    try { var mf = app.fonts.missingOrSubstitutedFonts; for (var i = 0; i < mf.length; i++) issues.push({ severity: 'warn', comp: null, layer: null, issue: 'missing/substituted font: ' + (mf[i].postScriptName || mf[i].familyName) }); } catch (e) {}
    return { root: root.name, counts: counts, ok: issues.length == 0, issues: issues.slice(0, 200) };`)));

tool('ae_run_script', 'Run any ExtendScript in the open After Effects project and return its result. Write the body of a function: use `return` to send data back (objects/arrays are JSON-serialized). Helpers: KAI.comp(nameOrId), KAI.layer(comp, nameOrIndex), KAI.prop(layerOrGroup, "ADBE Transform Group/ADBE Position"), KAI.find(name, kind), KAI.walk(group, {onlyChanged, filter}), KAI.layerInfo(layer), KAI.itemInfo(item). ARGS holds the args object. Edits are wrapped in one Undo group named by undo_name (pass it whenever the script changes the project).',
  { code: z.string().describe('ExtendScript function body'), args: z.record(z.any()).optional(), undo_name: z.string().optional().describe('Undo group name; required for scripts that modify the project'), timeout_sec: z.number().optional(),
    expected_project: z.string().optional().describe('Project guard: refuse to run unless the open project path contains this text (e.g. the .aep file name). Use it for every edit to a client project.') },
  async ({ code, args, undo_name, timeout_sec, expected_project }) => text(await ae('ae_run_script', args || {}, code, { undo: undo_name, timeoutSec: timeout_sec, expectedProject: expected_project })));

tool('ae_project', 'List project items (comps, footage, folders, solids) with ids, sizes, durations, file paths and missing status. Filter by type and/or a name regex.',
  { type: z.enum(['all', 'comp', 'footage', 'file', 'folder', 'solid']).optional(), name: z.string().optional().describe('regex on item name'), limit: z.number().optional() },
  async (a) => text(await ae('ae_project', a, `
    var out = [], re = ARGS.name ? new RegExp(ARGS.name, 'i') : null, lim = ARGS.limit || 500;
    for (var i = 1; i <= app.project.numItems && out.length < lim; i++) { var it = app.project.item(i), inf = KAI.itemInfo(it);
      var t = ARGS.type || 'all'; if (t != 'all' && !(t == inf.type || (t == 'footage' && (inf.type == 'file' || inf.type == 'solid' || inf.type == 'footage')))) continue;
      if (re && !re.test(it.name)) continue; out.push(inf); }
    return { count: out.length, items: out };`)));

tool('ae_comp', 'Describe a comp: size, fps, duration, display start time, markers, and every layer (index, name, source, in/out/start, parent, matte, effects, masks, 3D, audio, time remap). Optionally restrict to layers active between two times.',
  { comp: z.string().optional().describe('comp name or id:NN (default: active comp)'), from_time: z.number().optional(), to_time: z.number().optional() },
  async (a) => text(await ae('ae_comp', a, `
    var c = KAI.comp(ARGS.comp), info = KAI.itemInfo(c); info.layersInfo = []; info.markers = [];
    try { var mk = c.markerProperty; for (var m = 1; m <= mk.numKeys; m++) info.markers.push([mk.keyTime(m), mk.keyValue(m).comment]); } catch (e) {}
    for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i);
      if (ARGS.from_time !== undefined && l.outPoint < ARGS.from_time) continue; if (ARGS.to_time !== undefined && l.inPoint > ARGS.to_time) continue;
      info.layersInfo.push(KAI.layerInfo(l)); }
    return info;`)));

tool('ae_layer_props', 'Read a layer\'s full property tree (transform, effects, masks, shape contents, text, time remap) with values, keyframes and expressions. Use only_changed to skip defaults, filter to narrow (regex on matchName/name).',
  { comp: z.string().optional(), layer: z.union([z.string(), z.number()]), only_changed: z.boolean().optional(), filter: z.string().optional(), keys: z.boolean().optional(), max_keys: z.number().optional() },
  async (a) => text(await ae('ae_layer_props', a, `
    var c = KAI.comp(ARGS.comp), l = KAI.layer(c, ARGS.layer);
    return { layer: KAI.layerInfo(l), props: KAI.walk(l, { onlyChanged: ARGS.only_changed !== false, filter: ARGS.filter, keys: ARGS.keys !== false, maxKeys: ARGS.max_keys || 300 }) };`)));

tool('ae_dump', 'Read EVERYTHING in a comp tree (or the whole project) and write it to a JSON file: every comp (size, fps, duration, markers, settings), every layer (type, switches, timing, parent, track matte, masks with modes, effects, text document) and every changed or animated property with full keyframe values, mask/shape path vertices and expressions. Read-only. Returns a summary and the file path; read the file for details.',
  { comp: z.string().optional().describe('root comp (default: active comp)'), scope: z.enum(['comp', 'tree', 'project']).optional().describe('comp = just this comp, tree = this comp and every comp nested inside (default), project = every comp in the project'),
    full_shapes: z.boolean().optional().describe('include mask/shape vertices (default true)'), max_keys: z.number().optional(), timeout_sec: z.number().optional() },
  async (a) => {
    const dir = path.join(cfg.workDir, 'dumps'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `dump_${Date.now()}.json`).replace(/\\/g, '/');
    const r = await ae('ae_dump', { ...a, file }, `
      var P = app.project, scope = ARGS.scope || 'tree', seen = {}, comps = [], stats = { comps: 0, layers: 0, animatedProps: 0, keys: 0, expressions: 0, masks: 0, effects: 0, types: {} };
      function rr(x) { return Math.round(x * 100000) / 100000; }
      function compInfo(c, parent) {
        if (seen[c.id]) { if (parent) seen[c.id].usedBy.push(parent); return; }
        var o = { id: c.id, name: c.name, folder: c.parentFolder ? c.parentFolder.name : null, width: c.width, height: c.height, pixelAspect: c.pixelAspect, fps: c.frameRate, duration: rr(c.duration), displayStart: c.displayStartTime, workArea: [rr(c.workAreaStart), rr(c.workAreaDuration)], bgColor: c.bgColor, motionBlur: c.motionBlur, shutterAngle: c.shutterAngle, renderer: c.renderer, usedBy: parent ? [parent] : [], markers: [], layers: [] };
        seen[c.id] = o; comps.push(o); stats.comps++;
        try { var mk = c.markerProperty; for (var m = 1; m <= mk.numKeys; m++) o.markers.push([rr(mk.keyTime(m)), mk.keyValue(m).comment]); } catch (e) {}
        for (var l = 1; l <= c.numLayers; l++) {
          var L = c.layer(l), li = KAI.layerFull(L, { fullShapes: ARGS.full_shapes !== false, maxKeys: ARGS.max_keys });
          o.layers.push(li); stats.layers++; stats.types[li.type] = (stats.types[li.type] || 0) + 1;
          if (li.maskInfo) stats.masks += li.maskInfo.length; if (li.effectInfo) stats.effects += li.effectInfo.length;
          for (var q = 0; li.props && q < li.props.length; q++) { if (li.props[q].numKeys) { stats.animatedProps++; stats.keys += li.props[q].numKeys; } if (li.props[q].expression) stats.expressions++; }
          if (scope != 'comp' && L.source && L.source instanceof CompItem) compInfo(L.source, c.name);
        }
      }
      if (scope == 'project') { for (var i = 1; i <= P.numItems; i++) if (P.item(i) instanceof CompItem) compInfo(P.item(i), null); }
      else compInfo(KAI.comp(ARGS.comp), null);
      var items = []; for (var j = 1; j <= P.numItems; j++) { try { items.push(KAI.itemInfo(P.item(j))); } catch (e) {} }
      KAI.writeText(ARGS.file, KAI.stringify({ project: P.file ? P.file.fsName : null, aeVersion: app.version, scope: scope, root: scope == 'project' ? null : comps[0].name, stats: stats, comps: comps, items: items }));
      return { file: ARGS.file, stats: stats };`, { timeoutSec: a.timeout_sec || 600 });
    return text(r);
  });

tool('ae_set', 'Set a layer property (value, keyframes, or expression). Path uses matchNames or display names separated by "/", e.g. "ADBE Transform Group/ADBE Scale" or "ADBE Root Vectors Group/ADBE Vector Group/ADBE Vectors Group/ADBE Vector Shape - Rect/ADBE Vector Rect Size". keyframes = [[timeSec, value], ...]. Times are comp seconds (0 = comp start). One Undo group.',
  { comp: z.string().optional(), layer: z.union([z.string(), z.number()]), path: z.string(), value: z.any().optional(), keyframes: z.array(z.array(z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]))).optional().describe('[[timeSec, value], ...]'),
    clear_keys_between: z.array(z.number()).length(2).optional().describe('remove existing keys in [t0,t1] first'), ease: z.boolean().optional().describe('easy-ease the new keys'),
    expression: z.string().optional().describe('set expression ("" to remove)') },
  async (a) => text(await ae('ae_set', a, `
    var c = KAI.comp(ARGS.comp), l = KAI.layer(c, ARGS.layer), p = KAI.prop(l, ARGS.path), done = [];
    if (ARGS.clear_keys_between) { for (var i = p.numKeys; i >= 1; i--) { var t = p.keyTime(i); if (t >= ARGS.clear_keys_between[0] - 1e-4 && t <= ARGS.clear_keys_between[1] + 1e-4) p.removeKey(i); } done.push('cleared'); }
    if (ARGS.value !== undefined && ARGS.value !== null) { if (p.numKeys > 0) { p.setValueAtTime(c.time, ARGS.value); done.push('property is animated: set a keyframe at the comp time ' + Math.round(c.time * 1000) / 1000 + 's (use keyframes, or clear_keys_between to remove the animation)'); } else { p.setValue(ARGS.value); done.push('value'); } }
    if (ARGS.keyframes) { for (var k = 0; k < ARGS.keyframes.length; k++) { p.setValueAtTime(ARGS.keyframes[k][0], ARGS.keyframes[k][1]); }
      if (ARGS.ease) { for (var k2 = 0; k2 < ARGS.keyframes.length; k2++) { var idx = p.nearestKeyIndex(ARGS.keyframes[k2][0]); var dims = (p.value instanceof Array && p.propertyValueType != PropertyValueType.TwoD_SPATIAL && p.propertyValueType != PropertyValueType.ThreeD_SPATIAL) ? p.value.length : 1; var e = []; for (var d = 0; d < dims; d++) e.push(new KeyframeEase(0, 50)); try { p.setTemporalEaseAtKey(idx, e, e); } catch (x) {} } }
      done.push(ARGS.keyframes.length + ' keys'); }
    if (ARGS.expression !== undefined) { p.expression = ARGS.expression; done.push('expression'); }
    return { done: done, numKeys: p.numKeys, value: KAI.val(p.valueAtTime(c.time, false)) };`, { undo: `set ${a.path}` })));

tool('ae_layer', 'Edit a layer\'s timing and basics: rename, in/out/start (seconds, comp time), enable/disable, parent (layer name/index or null), move to index, duplicate, delete, set track matte (by layer name, type alpha/alpha_inverted/luma/luma_inverted/none).',
  { comp: z.string().optional(), layer: z.union([z.string(), z.number()]), name: z.string().optional(), in_point: z.number().optional(), out_point: z.number().optional(), start_time: z.number().optional(),
    enabled: z.boolean().optional(), parent: z.union([z.string(), z.number(), z.null()]).optional(), move_to: z.number().optional(), duplicate: z.boolean().optional(), delete: z.boolean().optional(),
    track_matte: z.object({ layer: z.union([z.string(), z.number()]).nullable(), type: z.enum(['alpha', 'alpha_inverted', 'luma', 'luma_inverted', 'none']) }).optional() },
  async (a) => text(await ae('ae_layer', a, `
    var c = KAI.comp(ARGS.comp), l = KAI.layer(c, ARGS.layer);
    if (ARGS.duplicate) l = l.duplicate();
    if (ARGS['delete']) { var nm = l.name; l.remove(); return { deleted: nm }; }
    if (ARGS.start_time !== undefined) l.startTime = ARGS.start_time;
    if (ARGS.in_point !== undefined) l.inPoint = ARGS.in_point;
    if (ARGS.out_point !== undefined) l.outPoint = ARGS.out_point;
    if (ARGS.name) l.name = ARGS.name;
    if (ARGS.enabled !== undefined) l.enabled = ARGS.enabled;
    if (ARGS.parent !== undefined) l.parent = ARGS.parent === null ? null : KAI.layer(c, ARGS.parent);
    // AVLayer has no moveTo(): use moveToBeginning / moveToEnd / moveBefore / moveAfter
    if (ARGS.move_to) { var to = Math.max(1, Math.min(c.numLayers, ARGS.move_to));
      if (to == 1) l.moveToBeginning(); else if (to == c.numLayers) l.moveToEnd(); else if (to < l.index) l.moveBefore(c.layer(to)); else if (to > l.index) l.moveAfter(c.layer(to)); }
    if (ARGS.track_matte) { var T = { alpha: TrackMatteType.ALPHA, alpha_inverted: TrackMatteType.ALPHA_INVERTED, luma: TrackMatteType.LUMA, luma_inverted: TrackMatteType.LUMA_INVERTED, none: TrackMatteType.NO_TRACK_MATTE }[ARGS.track_matte.type];
      if (ARGS.track_matte.layer === null || ARGS.track_matte.type == 'none') { try { l.removeTrackMatte(); } catch (e) { l.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } }
      else { var m = KAI.layer(c, ARGS.track_matte.layer); try { l.setTrackMatte(m, T); } catch (e) { l.moveAfter(m); l.trackMatteType = T; } } }
    return KAI.layerInfo(l);`, { undo: `edit layer ${a.layer}` })));

// ---------- frames / visual checks ----------
async function renderFrames(compRef, times, frames, resolution) {
  const dir = path.join(cfg.workDir, 'frames', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const r = await ae('ae_frames', { compRef, times, frames, resolution }, `
    var c = KAI.comp(ARGS.compRef), old = c.resolutionFactor, out = [];
    c.resolutionFactor = [ARGS.resolution, ARGS.resolution];
    try {
      var list = ARGS.frames ? ARGS.frames : ARGS.times;
      for (var i = 0; i < list.length; i++) {
        var t = ARGS.frames ? list[i] / c.frameRate : list[i];
        var f = new File(${JSON.stringify(dir.replace(/\\/g, '/'))} + '/f_' + ('00000' + i).slice(-5) + '.png');
        c.saveFrameToPng(t + 0.0001, f); out.push({ time: Math.round(t * 1000) / 1000, frame: Math.round(t * c.frameRate), file: f.fsName });
      }
    } finally { c.resolutionFactor = old; }
    return { comp: c.name, fps: c.frameRate, frames: out };`, { timeoutSec: 600 });
  await waitForPngs(r.frames.map(f => f.file));
  return r;
}

tool('ae_preview', 'Render frames of a comp (inside AE, no screen takeover) and show them. Give times (comp seconds) or frames. Returns one contact sheet (default) or individual images. resolution: 1 full, 2 half, 4 quarter (default 4, fastest).',
  { comp: z.string().optional(), times: z.array(z.number()).optional(), frames: z.array(z.number()).optional(), resolution: z.number().optional(), sheet: z.boolean().optional(), max_width: z.number().optional() },
  async (a) => {
    if (!a.times && !a.frames) return fail('give times or frames');
    const r = await renderFrames(a.comp, a.times, a.frames, a.resolution || 4);
    const files = r.frames.map(f => f.file);
    const content = [{ type: 'text', text: JSON.stringify({ comp: r.comp, fps: r.fps, frames: r.frames.map(f => ({ time: f.time, frame: f.frame })), folder: path.dirname(files[0]) }) }];
    if (a.sheet !== false && files.length > 1) {
      const sheet = await contactSheet(files, path.join(path.dirname(files[0]), 'sheet.png'), { tileW: Math.min(320, Math.floor((a.max_width || 1800) / Math.min(6, files.length))) });
      content.push({ type: 'image', data: (await thumbJpeg(sheet, a.max_width || 1800)).toString('base64'), mimeType: 'image/jpeg' });
    } else for (const f of files) content.push({ type: 'image', data: (await thumbJpeg(f, a.max_width || 540)).toString('base64'), mimeType: 'image/jpeg' });
    return { content };
  });

tool('ae_compare', 'Compare comp frames against a reference video (e.g. the approved cut or a client proof). Pairs comp frames with reference frames, returns side-by-side images and a difference score per pair (0 = identical; under ~6 usually the same picture).',
  { comp: z.string().optional(), comp_frames: z.array(z.number()), reference_video: z.string(), reference_frames: z.array(z.number()).optional().describe('defaults to comp_frames + reference_offset'),
    reference_offset: z.number().optional(), fps: z.number().optional().describe('reference fps, default comp fps'), resolution: z.number().optional() },
  async (a) => {
    if (!fs.existsSync(a.reference_video)) return fail('reference not found: ' + a.reference_video);
    const r = await renderFrames(a.comp, undefined, a.comp_frames, a.resolution || 4);
    const dir = path.dirname(r.frames[0].file); const out = []; const content = [];
    for (let i = 0; i < r.frames.length; i++) {
      const rf = a.reference_frames ? a.reference_frames[i] : a.comp_frames[i] + (a.reference_offset || 0);
      const ref = path.join(dir, `ref_${i}.png`);
      await extractFrame(a.reference_video, { frame: rf, fps: a.fps || r.fps }, ref);
      const d = await imageDiff(ref, r.frames[i].file);
      const sbs = await sideBySide(ref, r.frames[i].file, path.join(dir, `pair_${i}.png`), 360);
      out.push({ comp_frame: a.comp_frames[i], ref_frame: rf, diff: d });
      content.push({ type: 'image', data: (await thumbJpeg(sbs, 420)).toString('base64'), mimeType: 'image/jpeg' });
    }
    log({ tool: 'ae_compare_summary', args: a, result: out });
    return { content: [{ type: 'text', text: JSON.stringify({ note: 'left = reference, right = After Effects', pairs: out }) }, ...content] };
  });

// ---------- footage ----------
tool('ae_import', 'Import files (footage, audio, images, .aep) into the project, optionally into a folder (created if missing). Re-uses items already imported from the same file.',
  { paths: z.array(z.string()), folder: z.string().optional(), fps: z.number().optional().describe('conform frame rate for video') },
  async (a) => text(await ae('ae_import', a, `
    var fold = null; if (ARGS.folder) { fold = KAI.find(ARGS.folder, 'folder') || app.project.items.addFolder(ARGS.folder); }
    var out = [];
    for (var i = 0; i < ARGS.paths.length; i++) { var f = new File(ARGS.paths[i]); if (!f.exists) { out.push({ path: ARGS.paths[i], error: 'missing file' }); continue; }
      var it = null; for (var j = 1; j <= app.project.numItems; j++) { var x = app.project.item(j); try { if (x instanceof FootageItem && x.file && x.file.fsName.toLowerCase() == f.fsName.toLowerCase()) { it = x; break; } } catch (e) {} }
      if (!it) { it = app.project.importFile(new ImportOptions(f)); }
      if (fold) it.parentFolder = fold; if (ARGS.fps && it.mainSource && it.hasVideo) try { it.mainSource.conformFrameRate = ARGS.fps; } catch (e) {}
      out.push(KAI.itemInfo(it)); }
    return out;`, { undo: 'import files' })));

tool('ae_replace_footage', 'Swap the file behind a footage item (every layer using it updates).', { item: z.string(), path: z.string(), fps: z.number().optional() },
  async (a) => text(await ae('ae_replace_footage', a, `
    var it = KAI.find(ARGS.item, 'footage'); if (!it) throw new Error('footage not found: ' + ARGS.item);
    var f = new File(ARGS.path); if (!f.exists) throw new Error('file not found: ' + ARGS.path);
    it.replace(f); if (ARGS.fps) try { it.mainSource.conformFrameRate = ARGS.fps; } catch (e) {}
    return KAI.itemInfo(it);`, { undo: 'replace footage' })));

// ---------- project files ----------
tool('ae_save', 'Save the project. mode "save" overwrites the current file; "version" saves a new numbered copy next to it (Name_v001.aep...) and keeps working in the copy (original untouched); "as" saves to a given path.',
  { mode: z.enum(['save', 'version', 'as']).default('version'), path: z.string().optional() },
  async (a) => text(await ae('ae_save', a, `
    var p = app.project;
    if (ARGS.mode == 'save') { if (!p.file) throw new Error('project never saved; use mode as'); p.save(); return { saved: p.file.fsName }; }
    if (ARGS.mode == 'as') { p.save(new File(ARGS.path)); return { saved: p.file.fsName }; }
    if (!p.file) throw new Error('project never saved; use mode as');
    var base = p.file.name.replace(/\\.aep$/i, '').replace(/_v\\d{3}$/, ''), dir = p.file.parent.fsName, n = 1, f;
    do { f = new File(dir + '/' + base + '_v' + ('00' + n).slice(-3) + '.aep'); n++; } while (f.exists);
    p.save(f); return { saved: f.fsName };`, { timeoutSec: 300 })));

tool('ae_open', 'Open a project file in After Effects (closes the current one; refuses if the current one has unsaved changes unless discard_changes is true).',
  { path: z.string(), discard_changes: z.boolean().optional() },
  async (a) => text(await ae('ae_open', a, `
    if (app.project && app.project.dirty && !ARGS.discard_changes) throw new Error('current project has unsaved changes: save first (ae_save) or pass discard_changes');
    var f = new File(ARGS.path); if (!f.exists) throw new Error('not found ' + ARGS.path);
    if (app.project) app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.open(f); return { opened: app.project.file.fsName, items: app.project.numItems };`, { timeoutSec: 600 })));

tool('ae_undo', 'Undo the last N actions in After Effects (each AI edit is one named Undo step).', { steps: z.number().optional() },
  async (a) => text(await ae('ae_undo', a, `
    // Edit > Undo is command 16. findMenuCommandId('Undo') returns an unrelated id (2371 in AE 2026), so never look it up.
    var id = 16, n = ARGS.steps || 1;
    for (var i = 0; i < n; i++) app.executeCommand(id); return { undone: n };`)));

// ---------- rendering ----------
tool('ae_render', 'Render a comp (or a frame range of it) to a file through the Render Queue. format: "h264" (MP4), "prores", "png" (sequence). Frame numbers are comp frames from 0. Handles comps with a display start time. AE is busy until it finishes.',
  { comp: z.string().optional(), output: z.string().describe('output file path (for png use a folder path)'), format: z.enum(['h264', 'prores', 'prores_alpha', 'png']).default('h264').describe('prores_alpha = .mov with transparency (turn off background layers first)'),
    start_frame: z.number().optional(), end_frame: z.number().optional().describe('inclusive'), half_res: z.boolean().optional(), timeout_sec: z.number().optional() },
  async (a) => text(await ae('ae_render', a, `
    var c = KAI.comp(ARGS.comp), RQ = app.project.renderQueue;
    for (var i = RQ.numItems; i >= 1; i--) { try { if (RQ.item(i).status == RQItemStatus.QUEUED) RQ.item(i).render = false; } catch (e) {} }
    var it = RQ.items.add(c);
    var s = ARGS.start_frame || 0, e = (ARGS.end_frame !== undefined ? ARGS.end_frame + 1 : Math.round(c.duration * c.frameRate));
    it.timeSpanStart = c.displayStartTime + s / c.frameRate; it.timeSpanDuration = (e - s) / c.frameRate;
    try { it.applyTemplate('Best Settings'); } catch (x) {}
    if (ARGS.half_res) try { it.setSetting('Resolution', 'Half'); } catch (x) {}
    var om = it.outputModule(1), tl = om.templates, want = { h264: /H\\.264/i, prores: /ProRes|High Quality/i, png: /PNG/i, prores_alpha: /alpha/i }[ARGS.format], pick = null;
    for (var t = 0; t < tl.length; t++) if (want.test(tl[t]) && (ARGS.format == 'prores_alpha' || !/alpha/i.test(tl[t]))) { pick = tl[t]; break; }
    if (!pick) { it.remove(); throw new Error('no output template for ' + ARGS.format + '. Available: ' + tl.join(' | ')); }
    om.applyTemplate(pick);
    var outPath = ARGS.output; if (ARGS.format == 'png') { var fd = new Folder(outPath); if (!fd.exists) fd.create(); outPath = fd.fsName + '/' + c.name.replace(/[^A-Za-z0-9_-]+/g, '_') + '_[#####].png'; }
    var outFile = new File(outPath); if (!outFile.parent.exists) outFile.parent.create();
    om.file = outFile;
    var t0 = new Date().getTime(); RQ.render();
    var st = it.status, secs = Math.round((new Date().getTime() - t0) / 1000), outName = om.file.fsName;
    if (st != RQItemStatus.DONE) { var why = { 3017: 'stopped by user', 3018: 'render error (see the AE Render Queue / log)' }[st] || ('status ' + st); try { it.remove(); } catch (x) {} throw new Error('render failed: ' + why + ' after ' + secs + 's; item removed from the Render Queue'); }
    if (ARGS.format != 'png' && !new File(outName).exists) throw new Error('render reported DONE but no file at ' + outName);
    return { template: pick, output: outName, frames: e - s, seconds: secs, status: 'done' };`,
    { timeoutSec: a.timeout_sec || 7200 })));

// ---------- building ----------
tool('ae_build_master', 'Build (or rebuild) a master comp from an edit list (where entries overlap, later entries are layered above earlier ones): each entry places a source comp/footage on the timeline (timeline frames in/out, source frame at the in-point), copying the transform the source had in a template comp, or fitting it to the frame. Adds audio files underneath and markers. Every source keeps its own comp (fully editable).',
  { name: z.string(), width: z.number(), height: z.number(), fps: z.number(), duration_frames: z.number(),
    entries: z.array(z.object({ source: z.string().describe('comp/footage name or file path'), in_frame: z.number(), out_frame: z.number().describe('inclusive'), source_frame: z.number().default(0),
      transform_from: z.string().optional().describe('comp whose layer of this source supplies anchor/position/scale'), fit: z.enum(['fill', 'fit', 'none']).optional(), label: z.string().optional(),
      own_comp: z.boolean().optional().describe('wrap footage in its own comp (default true for files)') })),
    audio: z.array(z.object({ path: z.string(), start_frame: z.number().default(0), name: z.string().optional() })).optional(),
    markers: z.array(z.array(z.union([z.number(), z.string()]))).optional().describe('[[timelineFrame, comment], ...]'), folder: z.string().optional(), replace_existing: z.boolean().optional() },
  async (a) => text(await ae('ae_build_master', a, `
    var A = ARGS, fps = A.fps, log = [];
    var ex = KAI.find(A.name, 'comp'); if (ex) { if (!A.replace_existing) throw new Error('comp exists: ' + A.name + ' (pass replace_existing)'); ex.remove(); }
    var fold = KAI.find(A.folder || (A.name + ' parts'), 'folder') || app.project.items.addFolder(A.folder || (A.name + ' parts'));
    var M = app.project.items.addComp(A.name, A.width, A.height, 1, A.duration_frames / fps, fps); M.parentFolder = fold;
    function src(e) {
      var it = KAI.find(e.source); if (it) return it;
      var f = new File(e.source); if (!f.exists) throw new Error('source not found: ' + e.source);
      for (var j = 1; j <= app.project.numItems; j++) { var x = app.project.item(j); try { if (x instanceof FootageItem && x.file && x.file.fsName.toLowerCase() == f.fsName.toLowerCase()) { it = x; break; } } catch (err) {} }
      if (!it) { it = app.project.importFile(new ImportOptions(f)); it.parentFolder = fold; if (it.hasVideo) try { it.mainSource.conformFrameRate = fps; } catch (err) {} }
      if (e.own_comp !== false) { var sc = app.project.items.addComp('SHOT ' + (e.label || it.name.replace(/\\.[^.]+$/, '')), A.width, A.height, 1, it.duration || 10, fps); sc.parentFolder = fold;
        var fl = sc.layers.add(it), s = Math.max(A.width / it.width, A.height / it.height) * 100; fl.property('ADBE Transform Group').property('ADBE Scale').setValue([s, s]); it = sc; }
      return it; }
    function xf(tc, source) { var T = KAI.find(tc, 'comp'); if (!T) return null; for (var j = 1; j <= T.numLayers; j++) { var l = T.layer(j); if (l.source == source) { var t = l.property('ADBE Transform Group'); return [t.property('ADBE Anchor Point').value, t.property('ADBE Position').value, t.property('ADBE Scale').value]; } } return null; }
    var placed = [];
    for (var i = 0; i < A.entries.length; i++) { var e = A.entries[i], s = src(e), L = M.layers.add(s), tg = L.property('ADBE Transform Group');
      var X = e.transform_from ? xf(e.transform_from, s) : null;
      if (X) { var nm = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale']; for (var q = 0; q < 3; q++) { try { tg.property(nm[q]).setValue(X[q]); } catch (er) { tg.property(nm[q]).setValue([X[q][0], X[q][1]]); } } }
      else if (e.fit && e.fit != 'none' && s.width) { var sc2 = (e.fit == 'fill' ? Math.max : Math.min)(A.width / s.width, A.height / s.height) * 100; tg.property('ADBE Scale').setValue([sc2, sc2]); }
      L.startTime = (e.in_frame - (e.source_frame || 0)) / fps; L.inPoint = e.in_frame / fps; L.outPoint = (e.out_frame + 1) / fps; if (e.label) L.name = e.label;
      try { if (s instanceof CompItem) L.audioEnabled = false; } catch (er) {}
      placed.push(L); log.push((e.label || s.name) + ' ' + e.in_frame + '-' + e.out_frame + (X ? ' (xf from ' + e.transform_from + ')' : '')); }
    // later entries sit ABOVE earlier ones where they overlap (a title listed after its background stays visible)
    for (var k = placed.length - 1; k >= 0; k--) placed[k].moveToEnd();
    if (A.audio) for (var au = 0; au < A.audio.length; au++) { var f2 = new File(A.audio[au].path); if (!f2.exists) throw new Error('audio not found ' + A.audio[au].path);
      var ai = app.project.importFile(new ImportOptions(f2)); ai.parentFolder = fold; var AL = M.layers.add(ai); AL.startTime = (A.audio[au].start_frame || 0) / fps; if (A.audio[au].name) AL.name = A.audio[au].name; AL.moveToEnd(); }
    if (A.markers) for (var m = 0; m < A.markers.length; m++) M.markerProperty.setValueAtTime(A.markers[m][0] / fps, new MarkerValue(A.markers[m][1]));
    try { M.openInViewer(); } catch (er) {}
    return { comp: M.name, id: M.id, layers: M.numLayers, placed: log };`, { undo: `build ${a.name}`, timeoutSec: 600 })));

// ---------- reusable script library ----------
tool('ae_library', 'Reusable script library. action "list" shows saved scripts; "save" stores a working ExtendScript (name, description, code); "run" executes a saved script with args; "show" returns its code.',
  { action: z.enum(['list', 'save', 'run', 'show']), name: z.string().optional(), description: z.string().optional(), code: z.string().optional(), args: z.record(z.any()).optional(), undo_name: z.string().optional() },
  async (a) => {
    const file = (n) => path.join(LIB, n.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json');
    if (a.action === 'list') return text(fs.readdirSync(LIB).filter(f => f.endsWith('.json')).map(f => { const j = JSON.parse(fs.readFileSync(path.join(LIB, f), 'utf8')); return { name: j.name, description: j.description, uses: j.uses || 0 }; }));
    if (!a.name) return fail('name required');
    if (a.action === 'save') { if (!a.code) return fail('code required'); fs.writeFileSync(file(a.name), JSON.stringify({ name: a.name, description: a.description || '', code: a.code, saved: new Date().toISOString(), uses: 0 }, null, 1)); return text({ saved: a.name }); }
    if (!fs.existsSync(file(a.name))) return fail('no such script: ' + a.name);
    const j = JSON.parse(fs.readFileSync(file(a.name), 'utf8'));
    if (a.action === 'show') return text(j);
    const r = await ae('ae_library:' + a.name, a.args || {}, j.code, { undo: a.undo_name || a.name });
    j.uses = (j.uses || 0) + 1; j.lastUsed = new Date().toISOString(); fs.writeFileSync(file(a.name), JSON.stringify(j, null, 1));
    return text(r);
  });

tool('ae_effects', 'List effects installed in this After Effects (display name, matchName, category), optionally filtered by a regex. Use the matchName with layer.property("ADBE Effect Parade").addProperty(matchName).',
  { filter: z.string().optional() },
  async (a) => text(await ae('ae_effects', a, `
    var re = ARGS.filter ? new RegExp(ARGS.filter, 'i') : null, out = [];
    for (var i = 0; i < app.effects.length; i++) { var e = app.effects[i]; if (re && !re.test(e.displayName + ' ' + e.matchName + ' ' + e.category)) continue; out.push([e.displayName, e.matchName, e.category]); }
    return { count: out.length, effects: out };`)));

const { registerPremiere } = await import('./lib/premiere_tools.js');
registerPremiere({ tool, text, fail, ae, cfg, z });
const { registerExtras } = await import('./lib/extra_tools.js');
registerExtras({ tool, text, fail, ae, cfg, z });
const { registerUxp } = await import('./lib/uxp_tools.js');
registerUxp({ tool, text, cfg, z });
const { registerIllustrator } = await import('./lib/illustrator_tools.js');
registerIllustrator({ tool, text, fail, ae, cfg, z });
const { registerEditTools } = await import('./lib/edit_tools.js');
registerEditTools({ tool, text, fail, ae, cfg, z });

// Startup marker in the server folder: shows which code version is actually running (helps when an app restart is missed).
try { fs.writeFileSync(path.join(ROOT, '.last_start.json'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, premiere: true }, null, 1)); } catch {}

const transport = new StdioServerTransport();
await server.connect(transport);
log({ tool: 'server_start', args: { workDir: cfg.workDir, mode: cfg.mode, afterFX: findAfterFX(cfg) } });
