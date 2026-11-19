// Live builds: run a list of small steps in After Effects or Illustrator ONE AT A TIME, so every layer (or every piece of
// artwork) shows up before the next one starts. One script that makes 30 layers appears all at once (the apps only repaint
// when a script ends); 30 short jobs with a pause between them is what a person watching can follow.
// After Effects: after each step the comp is opened in the viewer, the layers the step added are selected (so the timeline
// highlights them), their keyframed properties are opened, and the time indicator moves onto them.
// Illustrator: before each step the view is fitted to the artboard the step works on, and the document is redrawn after it.
// Each step is its own Undo group (After Effects) and its own line in the bridge panel's Activity feed.
import { emit } from './activity.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Wraps one After Effects step. `comp` (the target comp, or null until a step creates it) and `S` (an object that survives
// from step to step, for values later steps need) are handed to the step code.
function wrapAE(code) {
  return `
var S = $.global.__kaiLive = $.global.__kaiLive || {};
if (ARGS.first) { S = $.global.__kaiLive = {}; }
function __comp() { try { return ARGS.comp ? KAI.comp(ARGS.comp) : (app.project.activeItem instanceof CompItem ? app.project.activeItem : null); } catch (e) { return null; } }
var __c = __comp(), __ids = {}, __n = __c ? __c.numLayers : 0, __hasId = false;
if (__c) for (var __i = 1; __i <= __c.numLayers; __i++) { var __id = __c.layer(__i).id; if (__id !== undefined) { __hasId = true; __ids[__id] = 1; } }
var __r = (function (comp, S) {
${code}
})(__c, S);
if (!__c) __c = __comp();
var __added = [];
if (__c) {
  var __new = [];
  for (var __j = 1; __j <= __c.numLayers; __j++) { var __L = __c.layer(__j); if (__hasId ? !__ids[__L.id] : __j <= __c.numLayers - __n) __new.push(__L); }
  for (var __q = 0; __q < __new.length; __q++) __added.push(__new[__q].name);
  if (ARGS.reveal !== false) {
    try { __c.openInViewer(); } catch (e) {}
    if (__new.length || ARGS.play) {
      for (var __k = 1; __k <= __c.numLayers; __k++) { try { __c.layer(__k).selected = ARGS.play ? true : false; } catch (e) {} }
      for (var __m = 0; __m < __new.length; __m++) { try { __new[__m].selected = true; } catch (e) {} }
      // Open the keyframed properties of the selected layers (the U key), so the keyframes can be seen in the timeline.
      if (ARGS.keyframes !== false) { try { var __u = app.findMenuCommandId('Reveal Properties with Keyframes'); if (__u) app.executeCommand(__u); } catch (e) {} __c = __comp(); }
    }
    if (__c && __new.length && !ARGS.play && (ARGS.show_at === null || ARGS.show_at === undefined)) { try { var __f = __c.layer(__added[0]); if (__c.time < __f.inPoint || __c.time >= __f.outPoint) __c.time = Math.min(__f.inPoint + Math.min(1, (__f.outPoint - __f.inPoint) / 2), Math.max(0, __c.duration - __c.frameDuration)); } catch (e) {} }
    if (__c && ARGS.show_at !== null && ARGS.show_at !== undefined) { try { __c.time = Math.min(ARGS.show_at, Math.max(0, __c.duration - __c.frameDuration)); } catch (e) {} }
    // play: start the preview from the beginning. The caller pauses (pause_ms) for as long as it should run.
    if (__c && ARGS.play) { try { for (var __p = 1; __p <= __c.numLayers; __p++) __c.layer(__p).selected = false; __c.time = 0; var __pl = app.findMenuCommandId('Play Current Preview'); if (__pl) app.executeCommand(__pl); } catch (e) {} }
  }
}
return { result: __r === undefined ? null : __r, added: __added, layers: __c ? __c.numLayers : null };`;
}

// Wraps one Illustrator step. `doc` (the active document, or null until a step creates one) and `S` are handed to the step
// code. With `artboard` (index or name) the view is fitted to that artboard first, so the viewer follows the work.
function wrapIL(code) {
  return `
var S = $.global.__kaiLiveIL = $.global.__kaiLiveIL || {};
if (ARGS.first) { S = $.global.__kaiLiveIL = {}; }
function __doc() { try { return app.documents.length ? app.activeDocument : null; } catch (e) { return null; } }
function __fit(d, ab) { try { var i = -1, q; if (typeof ab == 'number') i = ab; else for (q = 0; q < d.artboards.length; q++) if (d.artboards[q].name == ab) i = q;
  if (i < 0 || i >= d.artboards.length) return; d.artboards.setActiveArtboardIndex(i);
  var r = d.artboards[i].artboardRect, v = d.views[0], vb = v.bounds, z = v.zoom, pw = (vb[2] - vb[0]) * z, ph = (vb[1] - vb[3]) * z;
  v.zoom = Math.min(pw / (r[2] - r[0]), ph / (r[1] - r[3])) * 0.9; v.centerPoint = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; } catch (e) {} }
var __d = __doc(), __n = 0;
if (__d) { try { __n = __d.pageItems.length; } catch (e) {} }
if (__d && ARGS.follow !== false && ARGS.artboard !== null && ARGS.artboard !== undefined) __fit(__d, ARGS.artboard);
var __r = (function (doc, S) {
${code}
})(__d, S);
__d = __doc();
var __items = null;
if (__d) { try { __items = __d.pageItems.length; } catch (e) {} if (ARGS.follow !== false && ARGS.artboard !== null && ARGS.artboard !== undefined && !__n) __fit(__d, ARGS.artboard); }
try { app.redraw(); } catch (e) {}
return { result: __r === undefined ? null : __r, added: __items === null ? null : __items - __n, items: __items };`;
}

async function runSteps(cfg, run, a, { app, tool, wrap, argsFor }) {
  const steps = a.steps || [], pace = a.pace_ms == null ? 700 : Math.max(0, a.pace_ms), out = [], t0 = Date.now();
  const stamp = t0.toString(36);
  if (a.title) emit(cfg, { kind: 'say', text: short(`${a.title} (${steps.length} steps)`, 200), app });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], label = short(s.label || `Step ${i + 1}`, 110), id = `live${stamp}_${i}`;
    const ev = { kind: 'tool', tool, app, edit: true, text: `${i + 1}/${steps.length}  ${label}`, id };
    emit(cfg, { ...ev, status: 'running' });
    const ts = Date.now();
    try {
      const r = await run(wrap(s.code), { first: i === 0 && a.fresh !== false, ...argsFor(s) },
        { undo: label, expectedProject: a.expected_project, timeoutSec: s.timeout_sec || a.timeout_sec });
      emit(cfg, { ...ev, status: 'done', ms: Date.now() - ts });
      out.push({ step: i + 1, label, added: r.added, result: r.result === null ? undefined : r.result, ms: Date.now() - ts });
    } catch (e) {
      const msg = String(e.message || e);
      emit(cfg, { ...ev, status: 'error', ms: Date.now() - ts, error: msg.slice(0, 200) });
      return { ok: false, failedStep: i + 1, label, error: msg, done: out, note: 'Steps before this one are already in the file. Fix this step and send the remaining steps with fresh: false.' };
    }
    if (i < steps.length - 1) { const p = s.pause_ms == null ? pace : s.pause_ms; if (p) await sleep(p); }
  }
  return { ok: true, steps: out.length, seconds: Math.round((Date.now() - t0) / 100) / 10, done: out };
}

// run(code, args, { undo, expectedProject, timeoutSec }) -> result of one After Effects job (throws on error).
export function buildLive(cfg, run, a) {
  return runSteps(cfg, run, a, { app: 'ae', tool: 'ae_build_live', wrap: wrapAE,
    argsFor: (s) => ({ comp: s.comp || a.comp || null, reveal: a.reveal !== false, keyframes: a.keyframes !== false, show_at: s.show_at == null ? null : s.show_at, play: !!s.play }) });
}

// Same for Illustrator: run(code, args, opts) runs one Illustrator job.
export function buildLiveIL(cfg, run, a) {
  return runSteps(cfg, run, a, { app: 'il', tool: 'il_build_live', wrap: wrapIL,
    argsFor: (s) => ({ artboard: s.artboard == null ? (a.artboard == null ? null : a.artboard) : s.artboard, follow: a.follow !== false }) });
}
