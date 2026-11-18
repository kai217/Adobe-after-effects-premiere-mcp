// Example live build: a made-up race anniversary title card ("Harbor City 10K, 25 years"), built in After Effects one
// layer at a time so you can watch (or record) every layer land in the timeline. Nothing here is a real event or brand.
//   node scripts/live_demo.mjs            (After Effects open; 700 ms between steps)
//   node scripts/live_demo.mjs 400        (faster)
import { loadConfig, runJob } from '../lib/ae.js';
import { buildLive } from '../lib/live.js';

const NAME = 'Harbor City 10K - 25 Years';
const C = { night: '#10243E', deep: '#0B1A2E', coral: '#FF6B4A', sand: '#F4E3C1', teal: '#2BB3A3', sea: '#1C7F8C', gold: '#FFC857' };

// Small ExtendScript helpers pasted in front of every step (steps don't share local variables).
const H = `
function rgb(h) { return [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255]; }
function T(L) { return L.property('ADBE Transform Group'); }
function shape(name) { var L = comp.layers.addShape(); L.name = name; return L; }
function cont(L) { var r = L.property('ADBE Root Vectors Group'); return r.property(r.numProperties).property('ADBE Vectors Group'); }
function paint(L, fill, stroke, sw) {
  if (fill) { cont(L).addProperty('ADBE Vector Graphic - Fill'); var c = cont(L); c.property(c.numProperties).property('ADBE Vector Fill Color').setValue(rgb(fill)); }
  if (stroke) { cont(L).addProperty('ADBE Vector Graphic - Stroke'); var d = cont(L), s = d.property(d.numProperties); s.property('ADBE Vector Stroke Color').setValue(rgb(stroke)); s.property('ADBE Vector Stroke Width').setValue(sw || 6); }
}
function rect(L, w, h, x, y, fill, round) {
  L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); cont(L).addProperty('ADBE Vector Shape - Rect');
  var r = cont(L).property(1); r.property('ADBE Vector Rect Size').setValue([w, h]); r.property('ADBE Vector Rect Position').setValue([x, y]); if (round) r.property('ADBE Vector Rect Roundness').setValue(round);
  paint(L, fill);
}
function ell(L, w, h, x, y, fill, stroke, sw) {
  L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); cont(L).addProperty('ADBE Vector Shape - Ellipse');
  var e = cont(L).property(1); e.property('ADBE Vector Ellipse Size').setValue([w, h]); e.property('ADBE Vector Ellipse Position').setValue([x, y]);
  paint(L, fill, stroke, sw);
}
function txt(name, str, size, col, x, y, track) {
  var L = comp.layers.addText(str); L.name = name; var p = L.property('ADBE Text Properties').property('ADBE Text Document'), d = p.value;
  d.fontSize = size; d.applyFill = true; d.fillColor = rgb(col); d.justification = ParagraphJustification.CENTER_JUSTIFY; d.tracking = track || 0;
  try { d.font = 'Arial-BoldMT'; } catch (e) {}
  p.setValue(d); T(L).property('ADBE Position').setValue([x, y]); return L;
}
function ease(p) { for (var k = 1; k <= p.numKeys; k++) { for (var n = 1; n <= 3; n++) { try { var a = []; for (var q = 0; q < n; q++) a.push(new KeyframeEase(0, 75)); p.setTemporalEaseAtKey(k, a, a); break; } catch (e) {} } } }
function keys(p, list) { for (var i = 0; i < list.length; i++) p.setValueAtTime(list[i][0], list[i][1]); ease(p); }
function L_(n) { return comp.layer(n); }
`;
const step = (label, code, extra = {}) => ({ label, code: H + code, ...extra });
const towers = [[-560, 170, 120], [-420, 260, 110], [-290, 210, 100], [300, 240, 110], [430, 320, 120], [570, 190, 110]];

const steps = [
  step('New comp: ' + NAME, `var c = app.project.items.addComp(${JSON.stringify(NAME)}, 1920, 1080, 1, 8, 30); c.openInViewer(); return c.name;`),
  step('Night sky background', `var L = comp.layers.addSolid(rgb('${C.night}'), 'Night sky', 1920, 1080, 1);`),
  step('Horizon glow', `var L = shape('Horizon glow'); ell(L, 2400, 900, 0, 520, '${C.coral}'); T(L).property('ADBE Opacity').setValue(28);`),
  step('Sun disc', `var L = shape('Sun'); ell(L, 520, 520, 0, 0, '${C.gold}'); T(L).property('ADBE Position').setValue([960, 470]);`),
  step('Sun ring, inner', `var L = shape('Ring 1'); ell(L, 640, 640, 0, 0, null, '${C.gold}', 6); T(L).property('ADBE Position').setValue([960, 470]);`),
  step('Sun ring, outer', `var L = shape('Ring 2'); ell(L, 780, 780, 0, 0, null, '${C.coral}', 4); T(L).property('ADBE Position').setValue([960, 470]); T(L).property('ADBE Opacity').setValue(60);`),
  ...towers.map((t, i) => step(`Skyline tower ${i + 1}`, `var L = shape('Tower ${i + 1}'); rect(L, ${t[2]}, ${t[1]}, 0, ${-t[1] / 2}, '${i % 2 ? C.sea : C.deep}', 6); rect(L, ${t[2] - 40}, 14, 0, ${-t[1] + 30}, '${C.gold}', 4); T(L).property('ADBE Position').setValue([${960 + t[0]}, 800]);`)),
  step('Lighthouse', `var L = shape('Lighthouse'); rect(L, 46, 300, 0, -150, '${C.sand}', 8); rect(L, 46, 40, 0, -200, '${C.coral}'); ell(L, 70, 70, 0, -320, '${C.gold}'); T(L).property('ADBE Position').setValue([960 + 760, 800]);`),
  step('Bridge deck', `var L = shape('Bridge deck'); rect(L, 1500, 26, 0, 0, '${C.sand}', 13); T(L).property('ADBE Position').setValue([960, 800]);`),
  step('Bridge pillars', `var L = shape('Bridge pillars'); for (var i = -3; i <= 3; i++) rect(L, 30, 90, i * 220, 45, '${C.sand}', 6); T(L).property('ADBE Position').setValue([960, 812]);`),
  step('Wave, back', `var L = shape('Wave 3'); for (var i = -6; i <= 6; i++) ell(L, 380, 120, i * 300, 0, '${C.sea}'); T(L).property('ADBE Position').setValue([960, 900]);`),
  step('Wave, middle', `var L = shape('Wave 2'); for (var i = -6; i <= 6; i++) ell(L, 380, 130, i * 300 + 150, 0, '${C.teal}'); T(L).property('ADBE Position').setValue([960, 960]);`),
  step('Wave, front', `var L = shape('Wave 1'); for (var i = -6; i <= 6; i++) ell(L, 380, 140, i * 300, 0, '${C.deep}'); rect(L, 2400, 200, 0, 110, '${C.deep}'); T(L).property('ADBE Position').setValue([960, 1030]);`),
  step('The big 25', `txt('25', '25', 330, '${C.night}', 960, 585, -20);`),
  step('Title: HARBOR CITY 10K', `txt('Title', 'HARBOR CITY 10K', 74, '${C.sand}', 960, 140, 220);`),
  step('Line: TWENTY-FIVE YEARS', `txt('Years', 'TWENTY-FIVE YEARS', 40, '${C.gold}', 960, 205, 420);`),
  step('Year plate, left', `var L = shape('Plate 2002'); rect(L, 190, 70, 0, 0, '${C.coral}', 10); T(L).property('ADBE Position').setValue([520, 470]); txt('2002', '2002', 44, '${C.night}', 520, 486, 120);`),
  step('Year plate, right', `var L = shape('Plate 2027'); rect(L, 190, 70, 0, 0, '${C.coral}', 10); T(L).property('ADBE Position').setValue([1400, 470]); txt('2027', '2027', 44, '${C.night}', 1400, 486, 120);`),
  step('Tagline', `txt('Tagline', 'ONE COAST.  EVERY MILE.', 34, '${C.sand}', 960, 1050, 380);`),
  // ---- animation: one visible change per step ----
  step('Animate: sun rises', `keys(T(L_('Sun')).property('ADBE Position'), [[0, [960, 900]], [1.4, [960, 470]]]);`, { show_at: 0.7 }),
  step('Animate: rings open', `keys(T(L_('Ring 1')).property('ADBE Scale'), [[0.9, [0, 0, 100]], [1.7, [100, 100, 100]]]); keys(T(L_('Ring 2')).property('ADBE Scale'), [[1.1, [0, 0, 100]], [2.0, [100, 100, 100]]]);`, { show_at: 1.5 }),
  ...towers.map((t, i) => step(`Animate: tower ${i + 1} rises`, `var p = T(L_('Tower ${i + 1}')).property('ADBE Position'); keys(p, [[${(0.3 + i * 0.12).toFixed(2)}, [${960 + t[0]}, ${800 + t[1] + 20}]], [${(1.0 + i * 0.12).toFixed(2)}, [${960 + t[0]}, 800]]]);`, { show_at: +(0.7 + i * 0.12).toFixed(2), pause_ms: 350 })),
  step('Animate: waves drift', `for (var i = 1; i <= 3; i++) T(L_('Wave ' + i)).property('ADBE Position').expression = '[value[0] + Math.sin(time * ' + (0.9 + i * 0.3) + ' + ' + i + ') * ' + (30 + i * 12) + ', value[1] + Math.sin(time * 1.7 + ' + i + ') * 6]';`, { show_at: 2.2 }),
  step('Animate: the 25 pops in', `keys(T(L_('25')).property('ADBE Scale'), [[1.5, [0, 0, 100]], [2.0, [112, 112, 100]], [2.3, [100, 100, 100]]]);`, { show_at: 2.0 }),
  step('Animate: year plates slide in', `keys(T(L_('Plate 2002')).property('ADBE Position'), [[2.1, [-200, 470]], [2.7, [520, 470]]]); keys(T(L_('2002')).property('ADBE Position'), [[2.1, [-200, 486]], [2.7, [520, 486]]]); keys(T(L_('Plate 2027')).property('ADBE Position'), [[2.1, [2120, 470]], [2.7, [1400, 470]]]); keys(T(L_('2027')).property('ADBE Position'), [[2.1, [2120, 486]], [2.7, [1400, 486]]]);`, { show_at: 2.5 }),
  step('Animate: title and lines fade up', `var n = ['Title', 'Years', 'Tagline']; for (var i = 0; i < n.length; i++) keys(T(L_(n[i])).property('ADBE Opacity'), [[2.6 + i * 0.25, 0], [3.2 + i * 0.25, 100]]);`, { show_at: 3.4 }),
  step('Lighthouse beam blinks', `T(L_('Lighthouse')).property('ADBE Opacity').expression = '70 + 30 * Math.sin(time * 4)';`, { show_at: 4 }),
  step('Finished: park on the final frame', `comp.time = 5; for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false; return comp.numLayers + ' layers';`, { show_at: 5 })
];

const cfg = loadConfig();
const run = async (code, args, o) => {
  const r = await runJob(cfg, { code, args, undoName: o.undo, timeoutSec: o.timeoutSec, label: 'ae_build_live', expectedProject: o.expectedProject });
  if (!r.ok) throw new Error(r.error + (r.line ? ' (line ' + r.line + ')' : ''));
  return r.result;
};
const res = await buildLive(cfg, run, { comp: NAME, title: 'Live build: ' + NAME, pace_ms: Number(process.argv[2]) || 700, steps });
console.log(JSON.stringify(res.ok ? { ok: true, steps: res.steps, seconds: res.seconds, layers: res.done[res.done.length - 1].result } : res, null, 1));
process.exit(res.ok ? 0 : 1);
