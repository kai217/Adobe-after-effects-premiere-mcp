// ARGS: { name, bin?, like: itemRef (sequence settings come from it), replace?: bool,
//   clips: [{ item, in, out, at, v?: videoTrack (1-based, 0 = audio only), a?: audioTrack (1-based, 0 = no audio),
//             scale?, pos?: [x,y] normalized, gain_db?, label?, disabled? }],
//   xfade?: { frames: 4, tracks: [1] }   // Constant Power audio crossfade on every edit between two clips on these audio tracks
// }
// Multi-track timed edit list: places every range at its own timeline time. Linked audio of a video placement lands on the
// matching audio track (Premiere rule); if a != v that audio is removed and, when a > 0, the audio is placed on track a instead
// (audioTrack.overwriteClip in turn drops linked video on the matching video track, which is removed again).
var A = ARGS, clips = A.clips; if (!clips || !clips.length) throw new Error('no clips');
var bin = KAI.bin(A.bin || 'Sequences');
if (A.replace) { for (var q = app.project.sequences.numSequences - 1; q >= 0; q--) if (app.project.sequences[q].name == A.name) app.project.deleteSequence(app.project.sequences[q]); }
var seq = app.project.createNewSequenceFromClips(A.name, [KAI.item(A.like || clips[0].item)], bin);
if (!seq) throw new Error('could not create sequence');
for (var t = 0; t < seq.videoTracks.numTracks; t++) while (seq.videoTracks[t].clips.numItems) seq.videoTracks[t].clips[0].remove(false, true);
for (var t2 = 0; t2 < seq.audioTracks.numTracks; t2++) while (seq.audioTracks[t2].clips.numItems) seq.audioTracks[t2].clips[0].remove(false, true);
var fps = KAI.fps(seq) || 24; function snap(x) { return Math.round(x * fps) / fps; }
// make sure there are enough tracks
var needV = 1, needA = 1; for (var i = 0; i < clips.length; i++) { needV = Math.max(needV, clips[i].v || 0); needA = Math.max(needA, clips[i].a || 0, clips[i].v || 0); }
app.project.activeSequence = seq; app.enableQE(); var qs = qe.project.getActiveSequence();
var addV = needV - seq.videoTracks.numTracks, addA = needA - seq.audioTracks.numTracks;
if (addV > 0 || addA > 0) qs.addTracks(Math.max(0, addV), seq.videoTracks.numTracks, Math.max(0, addA), 1, seq.audioTracks.numTracks, 0, 0, 0);
function clipAt(track, at) { for (var k = track.clips.numItems - 1; k >= 0; k--) if (Math.abs(track.clips[k].start.seconds - at) < 0.6 / fps) return track.clips[k]; return null; }
function comp(c, name) { for (var k = 0; k < c.components.numItems; k++) if (c.components[k].displayName == name) return c.components[k]; return null; }
function prop(cmp, name) { if (!cmp) return null; for (var k = 0; k < cmp.properties.numItems; k++) if (cmp.properties[k].displayName == name) return cmp.properties[k]; return null; }
function setGain(ac, db) { var p = prop(comp(ac, 'Volume'), 'Level'); if (p) p.setValue(Math.pow(10, (db - 15) / 20), true); } // Premiere stores 0 dB as 0.1778
var placed = 0, errs = [], end = 0;
for (var i = 0; i < clips.length; i++) {
  var c = clips[i];
  try {
    var it = KAI.item(c.item), a = snap(c['in']), b = snap(c.out), at = snap(c.at), v = (c.v === undefined ? 1 : c.v), au = (c.a === undefined ? v : c.a);
    if (b - a < 1 / fps) continue;
    it.setInPoint(a, 4); it.setOutPoint(b, 4);
    if (v > 0) {
      seq.videoTracks[v - 1].overwriteClip(it, at);
      var vc = clipAt(seq.videoTracks[v - 1], at);
      if (vc) {
        if (c.label) try { vc.name = c.label; } catch (e) {}
        if (c.scale !== undefined || c.pos) { var m = comp(vc, 'Motion'); if (c.scale !== undefined) prop(m, 'Scale').setValue(c.scale, true); if (c.pos) prop(m, 'Position').setValue(c.pos, true); }
        if (c.disabled) vc.disabled = true;
      }
      if (au != v && seq.audioTracks.numTracks >= v) { var la = clipAt(seq.audioTracks[v - 1], at); if (la && la.projectItem && la.projectItem.nodeId == it.nodeId) la.remove(false, true); } // only our own linked audio, never a clip that happens to start at the same time
    }
    if (au > 0 && (v == 0 || au != v)) {
      seq.audioTracks[au - 1].overwriteClip(it, at);
      // audioTrack.overwriteClip also drops the linked VIDEO on the matching video track: take it back off
      if (au - 1 < seq.videoTracks.numTracks) { var lv = clipAt(seq.videoTracks[au - 1], at); if (lv && lv.projectItem && lv.projectItem.nodeId == it.nodeId && !(v == au)) lv.remove(false, true); }
    }
    if (au > 0 && c.gain_db !== undefined) { var ac = clipAt(seq.audioTracks[au - 1], at); if (ac) setGain(ac, c.gain_db); }
    it.clearInPoint(4); it.clearOutPoint(4);
    placed++; end = Math.max(end, at + (b - a));
  } catch (e) { errs.push(i + ': ' + e); try { it.clearInPoint(4); it.clearOutPoint(4); } catch (e2) {} }
}
var xf = 0;
if (A.xfade) {
  var tr = qe.project.getAudioTransitionByName('Constant Power'), fr = A.xfade.frames || 4, tcs = '00;00;00;' + (fr < 10 ? '0' : '') + fr;
  var trs = A.xfade.tracks || [1];
  for (var k = 0; k < trs.length; k++) {
    var dom = seq.audioTracks[trs[k] - 1], qt = qs.getAudioTrackAt(trs[k] - 1);
    for (var j = 1; j < dom.clips.numItems; j++) {
      if (Math.abs(dom.clips[j].start.seconds - dom.clips[j - 1].end.seconds) > 0.5 / fps) continue; // only butt edits
      for (var q2 = 0; q2 < qt.numItems; q2++) { var qi = qt.getItemAt(q2); if (qi.type == 'Clip' && Math.abs(qi.start.secs - dom.clips[j].start.seconds) < 0.5 / fps) { try { qi.addTransition(tr, true, tcs, '00;00;00;00', 0.5, false, true); xf++; } catch (e) {} break; } }
    }
  }
}
return { sequence: seq.name, fps: fps, placed: placed, errors: errs, duration: end, video_tracks: seq.videoTracks.numTracks, audio_tracks: seq.audioTracks.numTracks, crossfades: xf };
