// KAI-AE-MCP prelude: helpers available to every job. ExtendScript (ES3).
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

  // ---------- project lookup ----------
  K.items = function () { var r = []; for (var i = 1; i <= app.project.numItems; i++) r.push(app.project.item(i)); return r; };
  K.itemById = function (id) { for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it.id == id) return it; } return null; };
  K.find = function (ref, kind) { // ref: id number, "id:123", or exact name
    if (ref === undefined || ref === null || ref === '') return null;
    if (typeof ref === 'number' || /^id:\d+$/.test(ref) || /^\d+$/.test(ref)) { var it = K.itemById(String(ref).replace('id:', '')); if (it) return it; }
    for (var i = 1; i <= app.project.numItems; i++) {
      var x = app.project.item(i);
      if (x.name == ref && (!kind || (kind == 'comp' && x instanceof CompItem) || (kind == 'footage' && x instanceof FootageItem) || (kind == 'folder' && x instanceof FolderItem))) return x;
    }
    return null;
  };
  K.comp = function (ref) {
    var c = ref ? K.find(ref, 'comp') : app.project.activeItem;
    if (!c || !(c instanceof CompItem)) throw new Error('comp not found: ' + ref);
    return c;
  };
  K.layer = function (comp, ref) {
    if (typeof ref === 'number') return comp.layer(ref);
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name == ref) return comp.layer(i);
    throw new Error('layer not found: ' + ref + ' in ' + comp.name);
  };
  K.prop = function (base, path) { // path: "ADBE Transform Group/ADBE Position" or display names
    var parts = (path instanceof Array) ? path : String(path).split('/');
    var p = base;
    for (var i = 0; i < parts.length; i++) {
      var m = /^(.*)\[(\d+)\]$/.exec(parts[i]); // "ADBE Vector Group[3]" = 3rd child (needed when siblings share a matchName)
      p = m ? p.property(parseInt(m[2], 10)) : p.property(parts[i]);
      if (!p) throw new Error('property not found: ' + parts.slice(0, i + 1).join('/'));
    }
    return p;
  };
  K.itemType = function (it) {
    if (it instanceof CompItem) return 'comp';
    if (it instanceof FolderItem) return 'folder';
    if (it instanceof FootageItem) return it.mainSource instanceof SolidSource ? 'solid' : (it.mainSource instanceof FileSource ? 'file' : 'footage');
    return 'item';
  };
  K.itemInfo = function (it) {
    var o = { id: it.id, name: it.name, type: K.itemType(it), parent: it.parentFolder ? it.parentFolder.name : null };
    if (it instanceof CompItem) { o.w = it.width; o.h = it.height; o.fps = it.frameRate; o.dur = it.duration; o.layers = it.numLayers; o.displayStart = it.displayStartTime; }
    if (it instanceof FootageItem) {
      o.w = it.width; o.h = it.height; o.dur = it.duration;
      try { if (it.file) o.file = it.file.fsName; } catch (e) {}
      try { o.missing = it.footageMissing; } catch (e) {}
    }
    return o;
  };

  // ---------- property values ----------
  K.val = function (v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Array || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    try { if (v instanceof Shape) return K.fullShapes ? { closed: v.closed, vertices: v.vertices, inTangents: v.inTangents, outTangents: v.outTangents, featherSegLocs: v.featherSegLocs, featherRadii: v.featherRadii } : { shape: true, vertices: v.vertices.length, closed: v.closed }; } catch (e) {}
    try { if (v instanceof TextDocument) return { text: v.text, font: v.font, size: v.fontSize, fill: v.applyFill ? v.fillColor : null, tracking: v.tracking, leading: v.leading, justification: String(v.justification) }; } catch (e) {}
    try { if (v instanceof MarkerValue) return { comment: v.comment, duration: v.duration }; } catch (e) {}
    return String(v);
  };
  // Walk a property tree. opts: {keys:true, onlyChanged:false, maxDepth:12, filter:regex string}
  K.walk = function (g, opts, depth, path) {
    opts = opts || {}; depth = depth || 0; path = path || '';
    var out = [];
    if (depth > (opts.maxDepth || 12)) return out;
    for (var i = 1; i <= g.numProperties; i++) {
      var p = g.property(i); if (!p) continue;
      var dup = false; for (var j = 1; j <= g.numProperties; j++) { if (j != i && g.property(j) && g.property(j).matchName == p.matchName) { dup = true; break; } }
      var pp = (path ? path + '/' : '') + p.matchName + (dup ? '[' + i + ']' : '');
      if (p.propertyType == PropertyType.PROPERTY) {
        if (p.propertyValueType == PropertyValueType.NO_VALUE) continue;
        var animated = p.numKeys > 0, expr = false; try { expr = p.expressionEnabled; } catch (e) {}
        if (opts.onlyChanged && !animated && !expr) { var changed = false; try { changed = p.isModified; } catch (e) { changed = true; } if (!changed) continue; }
        if (opts.filter && !new RegExp(opts.filter, 'i').test(pp + ' ' + p.name)) continue;
        var r = { path: pp, name: p.name };
        try { r.value = K.val(p.value); } catch (e) { r.value = null; }
        if (animated) {
          r.numKeys = p.numKeys;
          if (opts.keys !== false) { r.keys = []; var n = Math.min(p.numKeys, opts.maxKeys || 400); for (var k = 1; k <= n; k++) { var kv; try { kv = K.val(p.keyValue(k)); } catch (e) { kv = null; } r.keys.push([Math.round(p.keyTime(k) * 100000) / 100000, kv]); } }
        }
        if (expr) r.expression = p.expression;
        out.push(r);
      } else {
        out = out.concat(K.walk(p, opts, depth + 1, pp));
      }
    }
    return out;
  };
  K.layerInfo = function (l) {
    var o = { index: l.index, name: l.name, enabled: l.enabled, 'in': l.inPoint, out: l.outPoint, start: l.startTime, stretch: l.stretch,
      parent: l.parent ? l.parent.index : null, type: 'layer' };
    try { o.source = l.source ? { id: l.source.id, name: l.source.name, type: K.itemType(l.source) } : null; } catch (e) {}
    o.type = K.layerType(l);
    try { o.trackMatte = l.hasTrackMatte ? String(l.trackMatteType) : null; o.isMatte = l.isTrackMatte; } catch (e) {}
    try { o.threeD = l.threeDLayer; o.audio = l.hasAudio ? l.audioEnabled : null; o.timeRemap = l.timeRemapEnabled; } catch (e) {}
    try { var fx = l.property('ADBE Effect Parade'); o.effects = []; for (var i = 1; i <= fx.numProperties; i++) o.effects.push({ name: fx.property(i).name, matchName: fx.property(i).matchName, enabled: fx.property(i).enabled }); } catch (e) {}
    try { o.masks = l.property('ADBE Mask Parade').numProperties; } catch (e) {}
    return o;
  };
  // Layer type from matchName (instanceof is unreliable for some layer classes in eval'd code).
  K.layerType = function (l) {
    var mn = l.matchName;
    if (mn == 'ADBE Text Layer') return 'text';
    if (mn == 'ADBE Vector Layer') return 'shape';
    if (mn == 'ADBE Camera Layer') return 'camera';
    if (mn == 'ADBE Light Layer') return 'light';
    try { if (l.nullLayer) return 'null'; } catch (e) {}
    try { if (l.adjustmentLayer) return 'adjustment'; } catch (e) {}
    try { var s = l.source; if (s) { if (s instanceof CompItem) return 'precomp'; var ms = s.mainSource; if (ms instanceof SolidSource) return 'solid'; if (ms instanceof PlaceholderSource) return 'placeholder'; if (ms.isStill) return 'still'; if (!s.hasVideo && s.hasAudio) return 'audio'; return 'footage'; } } catch (e) {}
    return 'layer';
  };
  // Everything about one layer: switches, timing, parenting, mattes, masks (with modes), effects, all changed/animated props with key values + expressions.
  K.layerFull = function (l, opts) {
    opts = opts || {};
    var o = K.layerInfo(l);
    var sw = ['shy','solo','locked','guideLayer','motionBlur','threeDLayer','collapseTransformation','frameBlending','preserveTransparency','autoOrient','label','quality','blendingMode','samplingQuality','threeDPerChar','environmentLayer','comment'];
    o.switches = {}; for (var i = 0; i < sw.length; i++) { try { var v = l[sw[i]]; if (v !== undefined && v !== false && v !== '' && v !== null) o.switches[sw[i]] = (typeof v == 'object' || typeof v == 'number') ? String(v) : v; } catch (e) {} }
    try { if (l.trackMatteLayer) o.trackMatteLayer = l.trackMatteLayer.index; } catch (e) {}
    try { var mp = l.property('ADBE Mask Parade'); if (mp && mp.numProperties) { o.maskInfo = []; for (var m = 1; m <= mp.numProperties; m++) { var mk = mp.property(m); o.maskInfo.push({ name: mk.name, mode: String(mk.maskMode), inverted: mk.inverted, locked: mk.locked, motionBlur: String(mk.maskMotionBlur), color: mk.color }); } } } catch (e) {}
    try { var fx = l.property('ADBE Effect Parade'); if (fx && fx.numProperties) { o.effectInfo = []; for (var f = 1; f <= fx.numProperties; f++) o.effectInfo.push({ name: fx.property(f).name, matchName: fx.property(f).matchName, enabled: fx.property(f).enabled }); } } catch (e) {}
    try { if (l.source && l.source.file) o.file = l.source.file.fsName; } catch (e) {}
    try { if (o.type == 'text') { var td = l.property('ADBE Text Properties').property('ADBE Text Document').value; o.text = K.val(td); } } catch (e) {}
    K.fullShapes = opts.fullShapes !== false;
    try { o.props = K.walk(l, { onlyChanged: true, keys: true, maxKeys: opts.maxKeys || 2000 }); } catch (e) { o.propsError = String(e); }
    K.fullShapes = false;
    return o;
  };
  K.frames = function (comp, t) { return Math.round(t * comp.frameRate); };
  K.t = function (comp, frame) { return frame / comp.frameRate; };
})(KAI);
