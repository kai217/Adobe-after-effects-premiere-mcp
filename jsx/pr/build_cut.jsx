// ARGS: { name, bin, segments: [{ item, in, out, label? }], gap?: seconds, audio?: true|false, replace?: bool }
// Lays segments end to end on V1/A1 of a new sequence, in order. Source times in seconds.
var segs = ARGS.segments; if (!segs || !segs.length) throw new Error('no segments');
var first = KAI.item(segs[0].item), bin = KAI.bin(ARGS.bin);
if (ARGS.replace) { for (var q = app.project.sequences.numSequences - 1; q >= 0; q--) if (app.project.sequences[q].name == ARGS.name) app.project.deleteSequence(app.project.sequences[q]); }
var seq = app.project.createNewSequenceFromClips(ARGS.name, [first], bin);
if (!seq) throw new Error('could not create sequence');
// clear what createNewSequenceFromClips placed
for (var t = 0; t < seq.videoTracks.numTracks; t++) while (seq.videoTracks[t].clips.numItems) seq.videoTracks[t].clips[0].remove(false, true);
for (var t2 = 0; t2 < seq.audioTracks.numTracks; t2++) while (seq.audioTracks[t2].clips.numItems) seq.audioTracks[t2].clips[0].remove(false, true);
var fps = KAI.fps(seq) || 24, fr = 1 / fps, pos = 0, placed = [];
function snap(x) { return Math.round(x * fps) / fps; }
for (var i = 0; i < segs.length; i++) {
  var s = segs[i], it = KAI.item(s.item), a = snap(s['in']), b = snap(s.out);
  if (b - a < fr) continue;
  // In/out are set in the SOURCE frame grid and Premiere floors them to the frame below: snap to the source rate and nudge half a source frame
    // (0-2s of 29.97 footage gives all 60 frames, not 59; 30 fps footage in a 29.97 sequence lands on its own frames)
    var sf = fps; try { var fi = it.getFootageInterpretation(); if (fi && fi.frameRate > 1) sf = fi.frameRate; } catch (e) {}
    it.setInPoint(Math.round(s['in'] * sf) / sf + 0.5 / sf, 4); it.setOutPoint(Math.round(s.out * sf) / sf + 0.5 / sf, 4);
  seq.videoTracks[0].overwriteClip(it, pos);
  it.clearInPoint(4); it.clearOutPoint(4);
  var vc = seq.videoTracks[0].clips[seq.videoTracks[0].clips.numItems - 1];
  if (vc && Math.abs(vc.start.seconds - pos) > 0.5 / fps) { /* placed somewhere unexpected */ }
  if (s.label) { try { vc.name = s.label; } catch (e) {} }
  placed.push({ i: i, item: it.name, src: [a, b], at: snap(pos), len: vc ? snap(vc.end.seconds - vc.start.seconds) : snap(b - a) });
  pos = vc ? vc.end.seconds + (ARGS.gap || 0) : snap(pos + (b - a) + (ARGS.gap || 0)); // chain from the real clip end: avoids 1-frame gaps from rounding
}
// audio:false removes the linked audio (disabling it left the clips on A1 and kept the sequence one frame longer than the picture)
if (ARGS.audio === false) for (var t3 = 0; t3 < seq.audioTracks.numTracks; t3++) for (var c = seq.audioTracks[t3].clips.numItems - 1; c >= 0; c--) seq.audioTracks[t3].clips[c].remove(false, false);
return { sequence: seq.name, fps: fps, duration: pos, clips: seq.videoTracks[0].clips.numItems, placed: placed.length, first: placed.slice(0, 3), last: placed.slice(-2) };
