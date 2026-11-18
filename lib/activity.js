// Activity feed: shows what Claude is doing, live, inside the KAI MCP Bridge panel (After Effects, Premiere Pro, Illustrator).
// Like Adobe's in-app AI Assistant: plain-language steps, a plan checklist, and Proceed / Deny buttons before risky changes.
// Everything goes through files in <workDir>/activity so any panel (and any app) can show it:
//   feed.jsonl   one line per event (tool start/done/error, narration)
//   plan.json    the current plan checklist
//   ask.json     a question waiting for an answer; the panel writes answer-<id>.json
import fs from 'node:fs';
import path from 'node:path';

const MAX_FEED_BYTES = 512 * 1024;   // feed.jsonl is trimmed to the newest half once it grows past this
const SESSION = `${process.pid}-${Date.now().toString(36)}`;

export function activityDir(cfg) {
  const d = path.join(cfg.workDir, 'activity');
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function trim(file) {
  try {
    if (fs.statSync(file).size <= MAX_FEED_BYTES) return;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    writeAtomic(file, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
  } catch {}
}

export function emit(cfg, ev) {
  const file = path.join(activityDir(cfg), 'feed.jsonl');
  try {
    fs.appendFileSync(file, JSON.stringify({ t: Date.now(), session: SESSION, ...ev }) + '\n');
    trim(file);
  } catch {}
}

// ---------- plain-language summaries for tool calls ----------
const APP = { ae: 'After Effects', pr: 'Premiere Pro', il: 'Illustrator', uxp: 'Premiere Pro', pr_uxp: 'Premiere Pro' };
function appOf(name) {
  if (name.startsWith('pr_uxp') || name.startsWith('pr_effects') || name.startsWith('pr_clip_param')) return 'pr';
  const p = name.split('_')[0];
  return APP[p] ? p : null;
}
const short = (s, n = 60) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = (p) => (p ? String(p).split(/[\\/]/).pop() : '');
const q = (s) => `"${short(s, 40)}"`;

// Tools that only read or report; everything else counts as an edit (shown with a different marker in the panel).
const READ_ONLY = /(^|_)(status|guide|check|dump|effects|preview|compare|probe|contact_sheet|waveform|transcribe|doctor|document|sequence|project|layer_props|clip_params|effects_list|library|job)$/;

export function describe(name, a = {}) {
  const comp = a.comp || a.sequence || a.name || '';
  const S = {
    ae_run_script: () => a.undo_name ? short(a.undo_name, 70) : 'Reading the After Effects project',
    ae_build_live: () => short(`Building live in After Effects: ${a.title || comp || ''} (${(a.steps || []).length} steps)`, 110),
    pr_run_script: () => a.undo_name ? short(a.undo_name, 70) : 'Running a step in Premiere Pro',
    il_run_script: () => a.undo_name ? short(a.undo_name, 70) : 'Running a step in Illustrator',
    pr_uxp_run: () => a.label ? short(a.label, 70) : 'Running a step in Premiere Pro (UXP)',
    ae_status: () => 'Checking After Effects is connected',
    pr_status: () => 'Checking Premiere Pro is connected',
    il_status: () => 'Checking Illustrator is connected',
    ae_preview: () => `Looking at frames of ${q(comp || 'the active comp')}`,
    pr_preview: () => `Looking at frames of ${q(comp || 'the sequence')}`,
    il_preview: () => 'Looking at the artboard',
    ae_dump: () => `Reading everything in ${q(comp || 'the comp')}`,
    ae_check: () => `Checking ${q(comp || 'the comp')} for problems`,
    ae_compare: () => 'Comparing frames against the reference',
    ae_save: () => a.mode === 'as' ? `Saving as ${base(a.path)}` : a.mode === 'version' ? 'Saving a new version' : 'Saving the project',
    pr_save: () => a.mode === 'as' ? `Saving as ${base(a.path)}` : a.mode === 'version' ? 'Saving a new version' : 'Saving the project',
    il_save: () => a.mode === 'as' ? `Saving as ${base(a.path)}` : 'Saving the document',
    ae_open: () => `Opening ${base(a.path)}`, pr_open: () => `Opening ${base(a.path)}`, il_open: () => `Opening ${base(a.path)}`,
    ae_render: () => `Rendering ${q(comp)} to ${base(a.output)}`,
    pr_export: () => `Exporting to ${base(a.output)}`,
    ae_import: () => `Importing ${(a.paths || []).length} file(s)`,
    pr_import: () => `Importing ${(a.paths || []).length} file(s)`,
    ae_replace_footage: () => `Replacing footage ${q(a.item)}`,
    ae_set: () => `Setting ${short(String(a.path || '').split('/').pop(), 30)} on ${q(a.layer)} in ${q(comp)}`,
    ae_layer: () => `Changing layer ${q(a.layer)} in ${q(comp)}`,
    ae_undo: () => `Undoing ${a.steps || 1} step(s)`,
    ae_build_master: () => `Building master comp ${q(a.name)}`,
    ae_markers: () => `Updating markers in ${q(comp)}`,
    ae_apply_preset: () => `Applying preset ${base(a.preset)}`,
    ae_export_mogrt: () => `Exporting MOGRT from ${q(comp)}`,
    pr_build_cut: () => `Building cut ${q(a.name)}`,
    pr_assemble: () => `Assembling sequence ${q(a.name)}`,
    pr_grade: () => `Grading ${q(a.sequence || 'the sequence')}`,
    pr_captions: () => 'Adding captions',
    pr_place: () => `Placing ${q(a.item)} on the timeline`,
    pr_new_sequence: () => `Making sequence ${q(a.name)}`,
    il_add: () => `Adding a ${a.kind || 'shape'} to the artboard`,
    il_set: () => `Changing ${q(a.name)}`,
    il_export: () => `Exporting ${a.format || 'artwork'}`,
    il_to_ae: () => `Sending Illustrator layers to After Effects`,
    media_transcribe: () => `Transcribing ${base(a.path || a.file)}`,
    host_run: () => a.label ? short(a.label, 70) : 'Running a command on this computer',
  };
  if (S[name]) { try { return S[name](); } catch {} }
  const words = name.replace(/^(ae|pr|il|uxp|media|host|kai)_/, '').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + (comp ? ` (${short(comp, 30)})` : '');
}

export function toolEvent(name, args) {
  return { kind: 'tool', tool: name, app: appOf(name), edit: !READ_ONLY.test(name) && !/^kai_/.test(name), text: describe(name, args) };
}

// ---------- plan checklist ----------
export function setPlan(cfg, plan) {
  writeAtomic(path.join(activityDir(cfg), 'plan.json'), JSON.stringify({ ...plan, session: SESSION, t: Date.now() }));
}
export function readPlan(cfg) {
  try { return JSON.parse(fs.readFileSync(path.join(activityDir(cfg), 'plan.json'), 'utf8')); } catch { return null; }
}

// ---------- questions answered in the panel ----------
export async function ask(cfg, { question, options, timeoutSec = 300 }) {
  const dir = activityDir(cfg);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const askFile = path.join(dir, 'ask.json'), answerFile = path.join(dir, `answer-${id}.json`);
  writeAtomic(askFile, JSON.stringify({ id, question, options, session: SESSION, t: Date.now(), timeoutSec }));
  emit(cfg, { kind: 'ask', text: short(question, 120) });
  const until = Date.now() + timeoutSec * 1000;
  try {
    while (Date.now() < until) {
      if (fs.existsSync(answerFile)) {
        let ans = null; try { ans = JSON.parse(fs.readFileSync(answerFile, 'utf8')); } catch {}
        try { fs.unlinkSync(answerFile); } catch {}
        if (ans && ans.choice) { emit(cfg, { kind: 'answer', text: ans.choice }); return { answered: true, choice: ans.choice }; }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    emit(cfg, { kind: 'answer', text: 'No answer (timed out)' });
    return { answered: false, choice: null };
  } finally {
    // Clear the question only if it is still ours (another session may have asked since).
    try { const cur = JSON.parse(fs.readFileSync(askFile, 'utf8')); if (cur.id === id) fs.unlinkSync(askFile); } catch {}
  }
}

export function registerActivity({ tool, text, cfg, z }) {
  tool('kai_say', 'Show a short plain-language update in the KAI MCP Bridge panel inside the user\'s Adobe apps, the way Adobe\'s AI Assistant narrates its work. Use it between steps of any multi-step job: what you just finished and what you are doing next (e.g. "Hex cluster resized. Next: matching the finale order."). One or two sentences; no code. Every tool call is already listed in the panel automatically, so use this for the why, not for each call.',
    { text: z.string(), level: z.enum(['info', 'done', 'warn']).optional().describe('warn = something the user should look at') },
    async (a) => { emit(cfg, { kind: 'say', text: short(a.text, 400), level: a.level || 'info' }); return text('shown'); });

  tool('kai_plan', 'Show or update a plan checklist in the KAI MCP Bridge panel. Call it at the start of any job with more than two steps (e.g. client revision notes) with every step, then call again with `done` (step indexes, 0-based) and `current` as you work, so the user can follow progress without reading the chat. `clear: true` removes it.',
    { title: z.string().optional(), steps: z.array(z.string()).optional(), done: z.array(z.number()).optional(), current: z.number().optional(), clear: z.boolean().optional() },
    async (a) => {
      if (a.clear) { setPlan(cfg, { title: null, steps: [] }); return text('plan cleared'); }
      const prev = readPlan(cfg) || {};
      const steps = a.steps || prev.steps || [];
      if (!steps.length) return text('ERROR: give steps the first time');
      const plan = { title: a.title ?? prev.title ?? 'Plan', steps, done: a.done ?? (a.steps ? [] : prev.done || []), current: a.current ?? (a.steps ? 0 : prev.current) };
      setPlan(cfg, plan);
      if (a.steps) emit(cfg, { kind: 'plan', text: `Plan: ${plan.title} (${steps.length} steps)` });
      else if (a.current != null && steps[a.current]) emit(cfg, { kind: 'plan', text: `Step ${a.current + 1}: ${short(steps[a.current], 80)}` });
      return text({ shown: true, done: plan.done.length, of: steps.length });
    });

  tool('kai_ask', 'Ask the user a question with buttons in the KAI MCP Bridge panel (inside After Effects / Premiere / Illustrator) and wait for the click. Use it before changes that are hard to undo or that could go either way (overwriting a client file, deleting comps, rendering for a long time), the way Adobe\'s assistant asks "Proceed / Deny". Default buttons: Proceed, Deny. Returns the button text, or answered:false after timeout_sec (default 300) — then ask in chat instead.',
    { question: z.string(), options: z.array(z.string()).min(2).max(4).optional(), timeout_sec: z.number().optional() },
    async (a) => text(await ask(cfg, { question: a.question, options: a.options || ['Proceed', 'Deny'], timeoutSec: a.timeout_sec || 300 })));
}
