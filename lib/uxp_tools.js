// UXP-only Premiere tools: things ExtendScript cannot do (remove effects, add effects by matchName, MOGRT text, one-step undo),
// plus a general runner for modern async Premiere UXP JavaScript. The ExtendScript pr_* tools keep working side by side.
import { runUxpJob, readUxpHeartbeat, describeUxp } from './uxp.js';
import { ROOT } from './ae.js';

export function registerUxp({ tool, text, cfg, z }) {
  cfg.root = ROOT;
  const ux = (code, args, opts = {}) => runUxpJob(cfg, { host: 'pr', code, args, ...opts });
  const guard = z.string().optional().describe('Project guard: refuse to run unless the open .prproj path contains this text.');
  const pick = { sequence: z.string().optional(), kind: z.enum(['video', 'audio']).optional(), track: z.number().optional().describe('0-based track index (default all)'),
    clips: z.array(z.number()).optional().describe('clip indexes on that track'), name: z.string().optional().describe('regex on clip name') };
  const PICK = `
    const seq = await KAI.seq(ARGS.sequence), re = ARGS.name ? new RegExp(ARGS.name, 'i') : null;
    let list = await KAI.clips(seq, ARGS.kind || 'video', ARGS.track);
    if (ARGS.clips) list = list.filter(c => ARGS.clips.includes(c.index));
    if (re) { const keep = []; for (const c of list) { if (re.test(await c.item.getName())) keep.push(c); } list = keep; }
    if (!list.length) throw new Error('no clips matched');`;

  tool('uxp_status', 'Status of the modern UXP side of the bridge (Premiere Pro now; After Effects once its UXP leaves beta): connected, versions, open project and active sequence.', {},
    async () => {
      const out = { premiere: describeUxp(readUxpHeartbeat(cfg, 'pr'), 'pr'), afterEffects: describeUxp(readUxpHeartbeat(cfg, 'ae'), 'ae') };
      if (readUxpHeartbeat(cfg, 'pr').connected || process.env.KAI_AE_MOCK) {
        try { out.project = await ux(`const p = await KAI.project(), s = await p.getActiveSequence(); return { project: p.name, path: p.path, activeSequence: s ? s.name : null, sequences: (await p.getSequences()).map(x => x.name) };`, {}, { timeoutSec: 30 }); } catch (e) { out.error = String(e.message || e); }
      }
      return text(out);
    });

  tool('pr_uxp_run', 'Run modern async JavaScript in Premiere through its UXP API (require("premierepro") is KAI.ppro). Use `await` and `return`. Helpers: KAI.project(), KAI.seq(name), KAI.t(seconds)->TickTime, KAI.sec(tickTime), KAI.tracks(seq, "video"|"audio"), KAI.clips(seq, kind, trackIndex) -> [{track,index,item}], KAI.clipInfo(c), KAI.items(), KAI.effectNames(), KAI.transact(label, (compound) => { compound.addAction(...) }) for ONE undoable step. ARGS holds args. Use this for what ExtendScript cannot do; use pr_run_script for everything else.',
    { code: z.string(), args: z.record(z.any()).optional(), timeout_sec: z.number().optional(), expected_project: guard },
    async (a) => text(await ux(a.code, a.args || {}, { timeoutSec: a.timeout_sec, expectedProject: a.expected_project, label: 'pr_uxp_run' })));

  tool('pr_effects_remove', 'Remove effects from clips (UXP; ExtendScript cannot). Pick clips by sequence/track/indexes/name regex; remove effects whose matchName or display name matches `match` (regex), or every non-intrinsic effect with match ".*". Motion, Opacity, Volume and other intrinsic components are never removed. One undo step.',
    { ...pick, match: z.string().describe('regex on effect matchName or display name, e.g. "Lumetri" or ".*"'), expected_project: guard },
    async (a) => text(await ux(PICK + `
      const mre = new RegExp(ARGS.match, 'i'), plan = [];
      for (const c of list) { const ch = await c.item.getComponentChain(), n = ch.getComponentCount();
        for (let k = n - 1; k >= 0; k--) { const comp = ch.getComponentAtIndex(k), mn = await comp.getMatchName(), dn = await comp.getDisplayName();
          // intrinsic components (Motion, Opacity, Time Remapping, Volume, Channel Volume, Panner) cannot be removed
          if (/^(Motion|Opacity|Time Remapping|Volume|Channel Volume|Panner)$/i.test(dn) || /ADBE (Motion|Opacity)$|Time ?Remap|Audio ?Volume|Audio ?Panner/i.test(mn)) continue;
          if (mre.test(mn) || mre.test(dn)) plan.push({ ch, comp, clip: c.index, track: c.track, mn, dn }); } }
      const ok = await KAI.transact('Remove effects (' + ARGS.match + ')', (ca) => { for (const p of plan) ca.addAction(p.ch.createRemoveComponentAction(p.comp)); });
      return { ok, removed: plan.map(p => ({ track: p.track, clip: p.clip, effect: p.dn, matchName: p.mn })) };`, a, { expectedProject: a.expected_project })));

  tool('pr_effects_add', 'Add a video effect by matchName to clips (UXP), e.g. "PR.ADBE Gamma Correction", "AE.ADBE Gaussian Blur 2", "AE.ADBE Lumetri". List names with pr_effects_list. A new effect can start with the values last used for that effect in Premiere, so set the parameters you need with pr_clip_param_set. One undo step.',
    { ...pick, match_name: z.string(), position: z.number().optional().describe('component index to insert at (default end)'), expected_project: guard },
    async (a) => text(await ux(PICK + `
      const plan = [];
      for (const c of list) { const ch = await c.item.getComponentChain(); const comp = await KAI.ppro.VideoFilterFactory.createComponent(ARGS.match_name); plan.push({ ch, comp, at: ARGS.position !== undefined ? ARGS.position : ch.getComponentCount(), clip: c.index, track: c.track }); }
      const ok = await KAI.transact('Add ' + ARGS.match_name, (ca) => { for (const p of plan) ca.addAction(p.ch.createInsertComponentAction(p.comp, p.at)); });
      return { ok, added: plan.map(p => ({ track: p.track, clip: p.clip })) };`, a, { expectedProject: a.expected_project })));

  tool('pr_effects_list', 'List the video effect matchNames Premiere can add through UXP (optionally filtered by regex).',
    { filter: z.string().optional() },
    async (a) => text(await ux(`const all = await KAI.effectNames(), re = ARGS.filter ? new RegExp(ARGS.filter, 'i') : null; const l = re ? all.filter(n => re.test(n)) : all; return { count: l.length, names: l };`, a)));

  tool('pr_clip_params', 'Read every component and parameter (name, value, keyframed) of chosen clips through UXP, including MOGRT text and Essential Graphics parameters ExtendScript cannot see.',
    { ...pick },
    async (a) => text(await ux(PICK + `
      const out = [];
      for (const c of list.slice(0, 20)) { const ch = await c.item.getComponentChain(), n = ch.getComponentCount(), comps = [];
        for (let k = 0; k < n; k++) { const comp = ch.getComponentAtIndex(k), pc = comp.getParamCount(), params = [];
          for (let q = 0; q < pc; q++) { const p = comp.getParam(q); let v = null; try { const sv = await p.getStartValue(); v = sv && sv.value !== undefined ? sv.value : String(sv); if (v && typeof v === 'object' && v.value !== undefined) v = v.value;
              if (v && typeof v === 'object' && v.red !== undefined) v = [v.red, v.green, v.blue, v.alpha]; } catch (e) {}
            let tv = null; try { tv = p.isTimeVarying(); } catch (e) {} params.push({ i: q, name: p.displayName, value: v, keyframed: tv }); }
          comps.push({ index: k, name: await comp.getDisplayName(), matchName: await comp.getMatchName(), params }); }
        out.push({ track: c.track, clip: c.index, name: await c.item.getName(), components: comps }); }
      return out;`, a, { timeoutSec: 120 })));

  tool('pr_clip_param_set', 'Set one parameter value on chosen clips through UXP (one undo step): component by display name or matchName regex, parameter by display name or index, plain value (number, boolean, string for MOGRT text). Optionally at a time to add a keyframe.',
    { ...pick, component: z.string(), param: z.union([z.string(), z.number()]), value: z.any(), at: z.number().optional().describe('seconds into the clip: add/replace a keyframe there'), expected_project: guard },
    async (a) => text(await ux(PICK + `
      const cre = new RegExp(ARGS.component, 'i'), plan = [];
      for (const c of list) { const ch = await c.item.getComponentChain(), n = ch.getComponentCount();
        for (let k = 0; k < n; k++) { const comp = ch.getComponentAtIndex(k); if (!(cre.test(await comp.getDisplayName()) || cre.test(await comp.getMatchName()))) continue;
          let p = null; if (typeof ARGS.param === 'number') p = comp.getParam(ARGS.param); else for (let q = 0; q < comp.getParamCount(); q++) { const x = comp.getParam(q); if (x.displayName === ARGS.param) p = x; }
          if (!p) continue; const kf = p.createKeyframe(ARGS.value); if (ARGS.at !== undefined) kf.position = KAI.t(ARGS.at); plan.push({ p, kf, clip: c.index }); break; } }
      if (!plan.length) throw new Error('no matching component/parameter on the chosen clips');
      const ok = await KAI.transact('Set ' + ARGS.component + ' ' + ARGS.param, (ca) => { for (const x of plan) if (ARGS.at !== undefined) { ca.addAction(x.p.createSetTimeVaryingAction(true)); ca.addAction(x.p.createAddKeyframeAction(x.kf)); } else ca.addAction(x.p.createSetValueAction(x.kf, true)); });
      return { ok, clips: plan.map(x => x.clip) };`, a, { expectedProject: a.expected_project })));
}
