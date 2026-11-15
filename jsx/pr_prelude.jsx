// KAI MCP Premiere prelude: helpers available to every pr_* job. ExtendScript (ES3), Premiere Pro DOM.
var KAI = KAI || {};
(function (K) {
  // ---------- JSON (ExtendScript has no JSON object) ----------
  function esc(s) {
    return String(s).replace(/[\\"\u0000-\u001f]/g, function (c) {
      var m = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
      return m[c] || ('\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
    });
  }
  K.stringify = function (v, depth) {
    depth = depth || 0;
    if (depth > 40) return '"[depth]"';
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(Math.round(v * 100000) / 100000) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return '"' + esc(v) + '"';
    if (t === 'function') return 'null';
    if (v instanceof Array) {
      var a = []; for (var i = 0; i < v.length; i++) a.push(K.stringify(v[i], depth + 1));
      return '[' + a.join(',') + ']';
    }
    if (v instanceof File || v instanceof Folder) return '"' + esc(v.fsName) + '"';
    var isPlain = false; try { isPlain = (v.constructor === Object); } catch (e) {}
    if (!isPlain) { try { return '"' + esc(v.toString()) + '"'; } catch (e2) { return '"[object]"'; } }
    var o = [];
    for (var k in v) { if (v.hasOwnProperty(k)) o.push('"' + esc(k) + '":' + K.stringify(v[k], depth + 1)); }
    return '{' + o.join(',') + '}';
  };
  K.parse = function (s) { return eval('(' + s + ')'); }; // input is produced by our own server

  K.writeText = function (path, text) {
    var f = new File(path); f.encoding = 'UTF-8'; f.lineFeed = 'Unix';
    if (!f.open('w')) throw new Error('cannot write ' + path + ' (enable Preferences > Scripting & Expressions > Allow Scripts to Write Files)');
    f.write(text); f.close();
  };

  // ---------- time ----------
  K.TPS = 254016000000; // Premiere ticks per second
  K.sec = function (t) { // Time object, ticks string, or number -> seconds
    if (t === undefined || t === null) return null;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') return Number(t) / K.TPS;
    try { return Math.round(t.seconds * 100000) / 100000; } catch (e) { return null; }
  };
  K.time = function (seconds) { var t = new Time(); t.seconds = seconds; return t; };
  // Timecode string for a sequence time (what QE calls such as exportFramePNG expect). Snaps to the frame at/below the time.
  K.tc = function (seq, seconds) {
    var tb = parseFloat(seq.timebase), fi = Math.floor(seconds * K.TPS / tb + 0.000001); if (!(fi >= 0)) fi = 0;
    var fmt = 100; try { fmt = seq.getSettings().videoDisplayFormat; } catch (e) {}
    try { var fr = new Time(); fr.ticks = String(tb); var t = new Time(); t.ticks = String(fi * tb); return { tc: t.getFormatted(fr, fmt), frame: fi }; } catch (e2) {}
    var nom = Math.round(K.TPS / tb), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return { tc: p(Math.floor(fi / (nom * 3600))) + ':' + p(Math.floor(fi / (nom * 60)) % 60) + ':' + p(Math.floor(fi / nom) % 60) + ':' + p(fi % nom), frame: fi };
  };
  K.fps = function (seq) { try { var s = seq.getSettings().videoFrameRate.seconds; return s ? Math.round(100000 / s) / 100000 : null; } catch (e) { return null; } };

  // ---------- project items ----------
  K.typeName = function (it) { return ({ 1: 'clip', 2: 'bin', 3: 'root', 4: 'file' })[it.type] || String(it.type); };
  K.mediaPath = function (it) { try { return it.getMediaPath() || null; } catch (e) { return null; } };
  K.itemInfo = function (it, binPath) {
    var o = { name: it.name, type: K.typeName(it), nodeId: it.nodeId, bin: binPath || '' };
    var mp = K.mediaPath(it); if (mp) o.media = mp;
    try { if (it.isSequence()) o.type = 'sequence'; } catch (e) {}
    try { if (it.isOffline()) o.offline = true; } catch (e) {}
    if (mp && /\.aepx?$/i.test(mp)) o.aeComp = true; // Dynamic Link After Effects comp
    return o;
  };
  // Walk every item. fn(item, binPath) returning true stops the walk.
  K.walk = function (fn, root, binPath) {
    root = root || app.project.rootItem; binPath = binPath || '';
    for (var i = 0; i < root.children.numItems; i++) {
      var c = root.children[i]; if (fn(c, binPath)) return true;
      if (c.type == 2 && K.walk(fn, c, binPath ? binPath + '/' + c.name : c.name)) return true;
    }
    return false;
  };
  // ref: nodeId, exact name, or "bin/sub/name". Throws if not found.
  K.item = function (ref) {
    var hit = null, want = String(ref);
    K.walk(function (c, bp) { if (c.nodeId == want || c.name == want || (bp ? bp + '/' + c.name : c.name) == want) { hit = c; return true; } return false; });
    if (!hit) throw new Error('project item not found: ' + ref);
    return hit;
  };
  // Find or create a bin by "a/b/c" path.
  K.bin = function (p) {
    var cur = app.project.rootItem; if (!p) return cur;
    var parts = String(p).split('/');
    for (var i = 0; i < parts.length; i++) {
      var next = null;
      for (var j = 0; j < cur.children.numItems; j++) { var c = cur.children[j]; if (c.type == 2 && c.name == parts[i]) { next = c; break; } }
      if (!next) next = cur.createBin(parts[i]);
      cur = next;
    }
    return cur;
  };

  // ---------- sequences ----------
  K.seq = function (ref) {
    if (ref === undefined || ref === null || ref === '') { if (!app.project.activeSequence) throw new Error('no active sequence; pass a sequence name'); return app.project.activeSequence; }
    var s = app.project.sequences;
    for (var i = 0; i < s.numSequences; i++) if (s[i].name == ref || s[i].sequenceID == ref) return s[i];
    throw new Error('sequence not found: ' + ref);
  };
  K.clipInfo = function (c, idx) {
    var o = { index: idx, name: c.name, start: K.sec(c.start), end: K.sec(c.end), 'in': K.sec(c.inPoint), out: K.sec(c.outPoint) };
    try { if (c.disabled) o.disabled = true; } catch (e) {}
    try { var sp = c.getSpeed(); if (sp != 1) o.speed = sp; } catch (e) {}
    try { if (c.projectItem) { o.item = c.projectItem.name; o.nodeId = c.projectItem.nodeId; var mp = K.mediaPath(c.projectItem); if (mp) o.media = mp; if (mp && /\.aepx?$/i.test(mp)) o.aeComp = true; } } catch (e) {}
    try { var fx = []; for (var k = 0; k < c.components.numItems; k++) fx.push(c.components[k].displayName); if (fx.length) o.components = fx; } catch (e) {}
    return o;
  };
  K.trackInfo = function (tr, i, from, to) {
    var o = { index: i + 1, name: tr.name, clips: [] };
    try { o.muted = tr.isMuted(); } catch (e) {}
    try { o.locked = tr.isLocked(); } catch (e) {}
    for (var j = 0; j < tr.clips.numItems; j++) { var c = tr.clips[j], s = K.sec(c.start), e2 = K.sec(c.end);
      if (from !== undefined && e2 < from) continue; if (to !== undefined && s > to) continue; o.clips.push(K.clipInfo(c, j)); }
    return o;
  };
  K.seqInfo = function (seq, from, to) {
    var o = { name: seq.name, id: seq.sequenceID, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, fps: K.fps(seq), duration: K.sec(seq.end), video: [], audio: [], markers: [] };
    for (var i = 0; i < seq.videoTracks.numTracks; i++) o.video.push(K.trackInfo(seq.videoTracks[i], i, from, to));
    for (var a = 0; a < seq.audioTracks.numTracks; a++) o.audio.push(K.trackInfo(seq.audioTracks[a], a, from, to));
    try { var m = seq.markers.getFirstMarker(); var n = 0; while (m && n < 500) { o.markers.push({ start: K.sec(m.start), name: m.name, comment: m.comments }); m = seq.markers.getNextMarker(m); n++; } } catch (e) {}
    return o;
  };
}(KAI));
