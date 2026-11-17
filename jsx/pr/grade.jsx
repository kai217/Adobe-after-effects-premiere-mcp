// ARGS: { sequence, track?: 1-based video track (default 1), lut, look: {temperature, tint, saturation, exposure, contrast, highlights, shadows, whites, blacks, vibrance, creative_saturation}, clips?: [indexes] }
// Two Lumetri Colors per V1 clip: [0] = only the .cube conversion LUT (sliders at default), [1] = the look sliders. Reuses existing ones.
var TI = (ARGS.track || 1) - 1, s = KAI.seq(ARGS.sequence), tr = s.videoTracks[TI], prev = app.project.activeSequence;
app.project.activeSequence = s; app.enableQE();
var qtr = qe.project.getActiveSequence().getVideoTrackAt(TI), lumFx = qe.project.getVideoEffectByName('Lumetri Color');
function lums(c) { var o = []; for (var i = 0; i < c.components.numItems; i++) if (c.components[i].displayName == 'Lumetri Color') o.push(c.components[i]); return o; }
function byName(L, name, nth) { var k = 0; for (var j = 0; j < L.properties.numItems; j++) if (L.properties[j].displayName == name) { if (k == (nth || 0)) return L.properties[j]; k++; } return null; }
var look = ARGS.look || {}, done = 0, errs = [];
var map = { temperature: ['Temperature', 0], tint: ['Tint', 0], saturation: ['Saturation', 0], exposure: ['Exposure', 0], contrast: ['Contrast', 0],
  highlights: ['Highlights', 0], shadows: ['Shadows', 0], whites: ['Whites', 0], blacks: ['Blacks', 0], vibrance: ['Vibrance', 0], creative_saturation: ['Saturation', 1], sharpen: ['Sharpen', 0], faded_film: ['Faded Film', 0] };
// QE item index skips empty gaps differently than DOM; match by start time.
function qeItemAt(startSec) { for (var q = 0; q < qtr.numItems; q++) { var it = qtr.getItemAt(q); try { if (it.type == 'Clip' && Math.abs(it.start.secs - startSec) < 0.02) return it; } catch (e) {} } return null; }
for (var ci = 0; ci < tr.clips.numItems; ci++) {
  if (ARGS.clips && ARGS.clips.length) { var want = false; for (var w = 0; w < ARGS.clips.length; w++) if (ARGS.clips[w] == ci) want = true; if (!want) continue; }
  if (/\.aep$/i.test(tr.clips[ci].projectItem.name) || /\.(png|jpe?g|psd|tiff?)$/i.test(tr.clips[ci].projectItem.name)) continue;  // AE Dynamic Link comps and stills are never log camera footage: no LUT/grade
  var c = tr.clips[ci], need = ARGS.lut ? 2 : 1, have = lums(c).length;
  if (have < need) { var qi = qeItemAt(c.start.seconds); if (!qi) { errs.push(ci + ': QE item not found'); continue; } for (var a = have; a < need; a++) qi.addVideoEffect(lumFx); }
  var L = lums(c); if (L.length < need) { errs.push(ci + ': Lumetri not added'); continue; }
  try {
    var G = L[L.length - 1];
    if (ARGS.lut) { byName(L[0], 'LUTAsset').setValue(ARGS.lut, true); byName(L[0], 'Input LUT', 0).setValue(1, true); byName(L[0], 'Input LUT', 1).setValue(1, true);
      L = lums(c); G = L[1]; byName(G, 'LUTAsset').setValue('', true); byName(G, 'Input LUT', 0).setValue(0, true); byName(G, 'Input LUT', 1).setValue(0, true); L = lums(c); G = L[1]; }
    for (var k in look) { if (!map[k]) continue; var p = byName(G, map[k][0], map[k][1]); if (p) p.setValue(look[k], true); }
    done++;
  } catch (e) { errs.push(ci + ': ' + e); }
}
try { if (prev && prev.sequenceID != s.sequenceID) app.project.activeSequence = prev; } catch (e) {}
// PR27_LUT_WARNING (Nov 17 2026, tested in Premiere 26.5.3 and 27.0): writing Lumetri 'LUTAsset' + 'Input LUT' from ExtendScript
// stores the path in the project but Lumetri never loads the LUT (render, export and re-open all stay log). UXP rejects the write
// ('Illegal Parameter type'). So report it: the caller must bake the LUT (scripts/bake_lut.py) or pick it in the Lumetri panel.
var warnings = []; if (ARGS.lut) warnings.push('Premiere ' + app.version + ': the Lumetri conversion LUT path was written but Lumetri does NOT load LUTs set by script, so the clips still render as log. Bake the LUT with ffmpeg (scripts/bake_lut.py) or choose it in Lumetri > Basic Correction > Input LUT by hand.');
return { sequence: s.name, graded: done, errors: errs, warnings: warnings };
