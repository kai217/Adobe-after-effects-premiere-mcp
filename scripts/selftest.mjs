// Self-test without After Effects: starts the server in mock mode, lists tools, and syntax-checks every tool's ExtendScript.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'server.js')], env: { ...process.env, KAI_AE_MOCK: '1' } });
const c = new Client({ name: 'selftest', version: '1' });
await c.connect(t);
const { tools } = await c.listTools();
console.log('tools:', tools.map(x => x.name).join(', '));
const calls = [
  ['ae_status', {}], ['ae_run_script', { code: 'return app.project.numItems;', undo_name: 'x' }], ['ae_project', { type: 'comp', name: 'Comp' }],
  ['ae_comp', { comp: 'Main', from_time: 0, to_time: 5 }], ['ae_layer_props', { comp: 'Main', layer: 1, filter: 'Position' }],
  ['ae_set', { comp: 'Main', layer: 'A', path: 'ADBE Transform Group/ADBE Scale', keyframes: [[0, [100, 100]], [1, [50, 50]]], ease: true, clear_keys_between: [0, 1] }],
  ['ae_layer', { comp: 'Main', layer: 'A', in_point: 1, track_matte: { layer: 'B', type: 'alpha' } }], ['ae_import', { paths: ['C:/x.mov'], folder: 'R3' }],
  ['ae_replace_footage', { item: 'x', path: 'C:/y.mov' }], ['ae_save', { mode: 'version' }], ['ae_open', { path: 'C:/a.aep' }], ['ae_undo', { steps: 2 }],
  ['ae_render', { comp: 'Main', output: 'C:/out.mp4', format: 'h264', start_frame: 0, end_frame: 10 }],
  ['ae_build_master', { name: 'M', width: 1080, height: 1920, fps: 23.976, duration_frames: 100, entries: [{ source: 'C1', in_frame: 0, out_frame: 49, source_frame: 0, transform_from: 'Old' }, { source: 'C:/s.mov', in_frame: 50, out_frame: 99 }], audio: [{ path: 'C:/a.wav' }], markers: [[10, 'hi']] }],
  ['ae_dump', { comp: 'Main', scope: 'tree' }], ['ae_check', { comp: 'Main' }], ['ae_guide', {}], ['ae_effects', { filter: 'glow' }], ['ae_library', { action: 'list' }],
  ['ae_run_script', { code: 'return 1;', expected_project: 'Client_v001.aep' }],
  ['ae_export_mogrt', { comp: 'HB_Intro', output: '/tmp/kai-selftest/hb.mogrt', template_name: 'HB', properties: [{ layer: 'Title', path: 'ADBE Text Properties/ADBE Text Document', name: 'Title' }] }],
  ['pr_status', {}], ['pr_guide', {}], ['pr_run_script', { code: 'return KAI.seqInfo(KAI.seq());', expected_project: 'Edit.prproj' }],
  ['pr_project', { type: 'ae_comp', name: 'HB' }], ['pr_sequence', { from_time: 0, to_time: 10 }], ['pr_import', { paths: ['C:/a.mov'], bin: 'Footage/A' }],
  ['pr_import_ae_comps', { aep: 'C:/a.aep', comps: ['HB_Intro'], bin: 'AE' }], ['pr_new_sequence', { name: 'Vertical', clone_of: 'Main' }],
  ['pr_place', { item: 'HB_Intro', time: 0, video_track: 2, mode: 'overwrite' }], ['pr_clip', { track: 1, clip: 0, in_point: 1, disabled: false }],
  ['pr_build_cut', { name: 'Selects', segments: [{ item: 'A.mov', in: 1, out: 3 }, { item: 'B.mov', in: 0, out: 2.5, label: 'b' }], replace: true }],
  ['pr_grade', { sequence: 'Selects', lut: 'C:/x.cube', look: { saturation: 120, temperature: 8 } }], ['host_job', {}],
  ['il_status', {}], ['il_guide', {}], ['il_run_script', { code: 'return KAI.docInfo(KAI.doc());', expected_project: 'Logo.ai' }], ['il_document', { items: true, layer: 'Type' }],
  ['il_new_document', { name: 'Card', width: 1920, height: 1080, artboards: 2 }], ['il_open', { path: 'C:/a.ai' }], ['il_save', { mode: 'as', path: 'C:/b.pdf' }],
  ['il_add', { kind: 'rect', x: 10, y: 10, w: 200, h: 80, radius: 8, fill: '#3366cc', stroke: null, name: 'Bar' }], ['il_add', { kind: 'text', text: 'TITLE', font: 'Gotham-Black', size: 120, fill: [240, 235, 220], x: 40, y: 900 }],
  ['il_add', { kind: 'path', points: [[0, 0], [100, 0], [50, 80]], fill: '#ff0000' }], ['il_set', { name: '/Bar.*/', fill: '#000000', x: 5, order: 'front', blend: 'multiply' }],
  ['il_export', { format: 'png', artboards: [0], scale: 200, out_dir: '/tmp/kai-selftest' }], ['il_trace', { file: 'C:/logo.png', preset: 'Black and White Logo' }], ['il_to_ae', { layers: ['Logo'], comp_name: 'Logo' }],
  ['uxp_status', {}], ['pr_uxp_run', { code: 'const s = await KAI.seq(); return s.name;', expected_project: 'Edit.prproj' }], ['pr_effects_remove', { track: 1, match: 'Lumetri' }],
  ['pr_effects_add', { name: 'A007', match_name: 'AE.ADBE Gaussian Blur 2' }], ['pr_effects_list', { filter: 'blur' }], ['pr_clip_params', { track: 0, clips: [0] }],
  ['pr_clip_param_set', { track: 0, clips: [0], component: 'Opacity', param: 'Opacity', value: 50, at: 1 }],
  ['ae_markers', { comp: 'Main', action: 'add', markers: [[1, 'hit', 0.5, 3]] }], ['ae_markers', { comp: 'Main', layer: 1, action: 'clear', from_time: 0 }],
  ['ae_apply_preset', { comp: 'Main', layers: ['/Title.*/', 2], preset: 'C:/p.ffx', time_seconds: 1 }],
  ['pr_markers', { action: 'add', markers: [{ time: 3, name: 'Act 2', color: 1 }] }], ['pr_markers', { action: 'clear', from_time: 0, to_time: 10 }],
  ['pr_captions', { srt: 'C:/a.srt' }],
  ['pr_save', { mode: 'version' }], ['pr_export', { output: '/tmp/kai-selftest/out.mp4', preset: 'C:/p.epr' }], ['kai_doctor', {}]];
let bad = 0;
for (const [n, a] of calls) {
  const r = await c.callTool({ name: n, arguments: a });
  const txt = r.content?.[0]?.text || '';
  const ok = !r.isError && !/ERROR/.test(txt);
  if (!ok && !['ae_status', 'pr_status', 'pr_preview', 'il_status'].includes(n)) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', n, ok ? '' : txt.slice(0, 300));
}
await c.close();
console.log(bad ? `${bad} failures` : 'all ExtendScript bodies parse');
process.exit(bad ? 1 : 0);
