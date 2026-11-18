// Live builds: run a list of small steps in After Effects ONE AT A TIME, so every layer shows up in the timeline and the
// viewer before the next one starts. One script that makes 30 layers appears all at once (After Effects only repaints when a
// script ends); 30 short jobs with a pause between them is what a person watching, or a screen recording, can follow.
// After each step the comp is opened in the viewer, the layers the step added are selected (so the timeline highlights them)
// and the time indicator moves onto them. Each step is its own Undo group and its own line in the bridge panel's Activity feed.
import { emit } from './activity.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Wraps one step. `comp` (the target comp, or null until a step creates it) and `S` (an object that survives from step to
// step, for values later steps need) are handed to the step code.
function wrap(code) {
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
  if (ARGS.reveal !== false) {
    try { __c.openInViewer(); } catch (e) {}
    if (__new.length) {
      for (var __k = 1; __k <= __c.numLayers; __k++) { try { __c.layer(__k).selected = false; } catch (e) {} }
      for (var __m = 0; __m < __new.length; __m++) { try { __new[__m].selected = true; } catch (e) {} }
      var __f = __new[0];
      if (ARGS.show_at === null || ARGS.show_at === undefined) { try { if (__c.time < __f.inPoint || __c.time >= __f.outPoint) __c.time = Math.min(__f.inPoint + Math.min(1, (__f.outPoint - __f.inPoint) / 2), Math.max(0, __c.duration - __c.frameDuration)); } catch (e) {} }
    }
    if (ARGS.show_at !== null && ARGS.show_at !== undefined) { try { __c.time = ARGS.show_at; } catch (e) {} }
  }
  for (var __q = 0; __q < __new.length; __q++) __added.push(__new[__q].name);
}
return { result: __r === undefined ? null : __r, added: __added, layers: __c ? __c.numLayers : null };`;
}

// run(code, args, { undo, expectedProject, timeoutSec }) -> result of one After Effects job (throws on error).
export async function buildLive(cfg, run, a) {
  const steps = a.steps || [], pace = a.pace_ms == null ? 700 : Math.max(0, a.pace_ms), out = [], t0 = Date.now();
  const stamp = t0.toString(36);
  if (a.title) emit(cfg, { kind: 'say', text: short(`${a.title} (${steps.length} steps)`, 200), app: 'ae' });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], label = short(s.label || `Step ${i + 1}`, 110), id = `live${stamp}_${i}`;
    const ev = { kind: 'tool', tool: 'ae_build_live', app: 'ae', edit: true, text: `${i + 1}/${steps.length}  ${label}`, id };
    emit(cfg, { ...ev, status: 'running' });
    const ts = Date.now();
    try {
      const r = await run(wrap(s.code), { comp: a.comp || null, first: i === 0 && a.fresh !== false, reveal: a.reveal !== false, show_at: s.show_at == null ? null : s.show_at },
        { undo: label, expectedProject: a.expected_project, timeoutSec: s.timeout_sec || a.timeout_sec });
      emit(cfg, { ...ev, status: 'done', ms: Date.now() - ts });
      out.push({ step: i + 1, label, added: r.added, result: r.result === null ? undefined : r.result, ms: Date.now() - ts });
    } catch (e) {
      const msg = String(e.message || e);
      emit(cfg, { ...ev, status: 'error', ms: Date.now() - ts, error: msg.slice(0, 200) });
      return { ok: false, failedStep: i + 1, label, error: msg, done: out, note: 'Steps before this one are in the project (one Undo group each). Fix this step and send the remaining steps with fresh: false.' };
    }
    if (pace && i < steps.length - 1) await sleep(s.pause_ms == null ? pace : s.pause_ms);
  }
  return { ok: true, steps: out.length, seconds: Math.round((Date.now() - t0) / 100) / 10, done: out };
}
