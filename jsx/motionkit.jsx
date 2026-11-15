// KAI motion kit: small ExtendScript helpers for building shape/text motion graphics.
// Load inside a job with: $.evalFile('<install folder>/jsx/motionkit.jsx');
var MK = {};
MK.G = [0.17, 0.88, 0.48];      // brand green
MK.G2 = [0.09, 0.55, 0.29];     // mid green
MK.DK = [0.02, 0.09, 0.05];     // near-black green
MK.CARD = [0.05, 0.14, 0.09];   // card fill
MK.WH = [1, 1, 1];
MK.GREY = [0.68, 0.74, 0.70];

MK.folder = function (n) {
  for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FolderItem && it.name == n) return it; }
  return app.project.items.addFolder(n);
};
MK.find = function (n) {
  for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof CompItem && it.name == n) return it; }
  return null;
};
// New (or replaced) scene comp.
MK.comp = function (n, dur, folder) {
  for (var i = app.project.numItems; i >= 1; i--) { var it = app.project.item(i); if (it instanceof CompItem && it.name == n) it.remove(); }
  var c = app.project.items.addComp(n, 1920, 1080, 1, dur, 30); c.parentFolder = MK.folder(folder || 'Scenes'); return c;
};
MK.shape = function (c, n, pos) { var L = c.layers.addShape(); L.name = n; if (pos) L.property('ADBE Transform Group').property('ADBE Position').setValue(pos); return L; };
MK.group = function (L, n) { var g = L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'); g.name = n; return g; };
// AE invalidates property references when siblings are added, so every accessor re-resolves from the layer by name.
MK.G_ = function (L, n) { return L.property('ADBE Root Vectors Group').property(n); };
MK.handle = function (L, n, shapeMN, sizeMN) {
  return {
    L: L, name: n,
    g: function () { return MK.G_(L, n); },
    size: function () { return MK.G_(L, n).property('ADBE Vectors Group').property(shapeMN).property(sizeMN); },
    round: function () { return MK.G_(L, n).property('ADBE Vectors Group').property(shapeMN).property('ADBE Vector Rect Roundness'); },
    fill: function () { return MK.G_(L, n).property('ADBE Vectors Group').property('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color'); },
    stroke: function () { return MK.G_(L, n).property('ADBE Vectors Group').property('ADBE Vector Graphic - Stroke'); },
    pos: function () { return MK.G_(L, n).property('ADBE Vector Transform Group').property('ADBE Vector Position'); },
    scale: function () { return MK.G_(L, n).property('ADBE Vector Transform Group').property('ADBE Vector Scale'); },
    rot: function () { return MK.G_(L, n).property('ADBE Vector Transform Group').property('ADBE Vector Rotation'); },
    op: function () { return MK.G_(L, n).property('ADBE Vector Transform Group').property('ADBE Vector Group Opacity'); }
  };
};
MK.gpos = function (g) { return g.property('ADBE Vector Transform Group').property('ADBE Vector Position'); };
// Rounded rect in its own group. Returns a handle (call h.size(), h.pos(), h.fill(), ...).
MK.box = function (L, n, w, h, r, col, off) {
  MK.group(L, n);
  var v = function () { return MK.G_(L, n).property('ADBE Vectors Group'); };
  v().addProperty('ADBE Vector Shape - Rect');
  var H = MK.handle(L, n, 'ADBE Vector Shape - Rect', 'ADBE Vector Rect Size');
  H.size().setValue([w, h]); H.round().setValue(r);
  if (col) { v().addProperty('ADBE Vector Graphic - Fill'); H.fill().setValue(col); }
  if (off) H.pos().setValue(off);
  return H;
};
MK.ellipse = function (L, n, d, col, off) {
  MK.group(L, n);
  var v = function () { return MK.G_(L, n).property('ADBE Vectors Group'); };
  v().addProperty('ADBE Vector Shape - Ellipse');
  var H = MK.handle(L, n, 'ADBE Vector Shape - Ellipse', 'ADBE Vector Ellipse Size');
  H.size().setValue([d, d]);
  if (col) { v().addProperty('ADBE Vector Graphic - Fill'); H.fill().setValue(col); }
  if (off) H.pos().setValue(off);
  return H;
};
MK.path = function (L, n, pts, closed, col, strokeCol, sw) {
  MK.group(L, n);
  var v = function () { return MK.G_(L, n).property('ADBE Vectors Group'); };
  v().addProperty('ADBE Vector Shape - Group'); var s = new Shape(); s.vertices = pts; s.closed = closed !== false;
  v().property('ADBE Vector Shape - Group').property('ADBE Vector Shape').setValue(s);
  var H = MK.handle(L, n, 'ADBE Vector Shape - Group', 'ADBE Vector Shape');
  if (strokeCol) MK.stroke(H, strokeCol, sw || 4);
  if (col) { v().addProperty('ADBE Vector Graphic - Fill'); H.fill().setValue(col); }
  return H;
};
// Stroke on a handle's group.
MK.stroke = function (H, col, w) {
  H.g().property('ADBE Vectors Group').addProperty('ADBE Vector Graphic - Stroke');
  var s = H.stroke(); s.property('ADBE Vector Stroke Color').setValue(col); s.property('ADBE Vector Stroke Width').setValue(w); return H;
};
MK.text = function (c, str, size, col, pos, font, just, track) {
  var L = c.layers.addText(str); var p = L.property('ADBE Text Properties').property('ADBE Text Document'); var d = p.value;
  d.resetCharStyle(); d.font = font || 'GTWalsheimPro-Bold'; d.fontSize = size; d.applyFill = true; d.fillColor = col || MK.WH; d.applyStroke = false;
  d.justification = just || ParagraphJustification.CENTER_JUSTIFY; if (track) d.tracking = track; p.setValue(d);
  L.property('ADBE Transform Group').property('ADBE Position').setValue(pos); return L;
};
// Center a text layer's anchor on its visual box (so scale pops from the middle).
MK.centerAnchor = function (L) {
  var r = L.sourceRectAtTime(0, false);
  L.property('ADBE Transform Group').property('ADBE Anchor Point').setValue([r.left + r.width / 2, r.top + r.height / 2]);
};
MK.ease = function (p, inf, outf) {
  var sp = (p.propertyValueType == PropertyValueType.TwoD_SPATIAL || p.propertyValueType == PropertyValueType.ThreeD_SPATIAL);
  for (var k = 1; k <= p.numKeys; k++) {
    var d = (sp || p.propertyValueType == PropertyValueType.COLOR) ? 1 : (p.keyValue(k) instanceof Array ? p.keyValue(k).length : 1), a = [], b = [];
    for (var j = 0; j < d; j++) { a.push(new KeyframeEase(0, inf || 80)); b.push(new KeyframeEase(0, outf || inf || 80)); }
    p.setTemporalEaseAtKey(k, a, b);
  }
  return p;
};
// Keyframes: arr = [[t, v], ...]; eased (default 80% influence).
MK.keys = function (p, arr, inf, outf) { for (var i = 0; i < arr.length; i++) p.setValueAtTime(arr[i][0], arr[i][1]); return MK.ease(p, inf, outf); };
MK.tr = function (L, n) { var m = { pos: 'ADBE Position', scale: 'ADBE Scale', rot: 'ADBE Rotate Z', op: 'ADBE Opacity', anchor: 'ADBE Anchor Point' }; return L.property('ADBE Transform Group').property(m[n]); };
MK.glow = function (L, radius, intensity, threshold) {
  var g = L.property('ADBE Effect Parade').addProperty('ADBE Glo2');
  g.property('Glow Radius').setValue(radius || 40); g.property('Glow Intensity').setValue(intensity || 1); g.property('Glow Threshold').setValue(threshold === undefined ? 40 : threshold); return g;
};
MK.place = function (master, c, start) { var L = master.layers.add(c); L.startTime = start; L.moveBefore(master.layer(master.numLayers)); return L; };
// Soft halo: duplicate the layer underneath, blur it, lower its opacity. Keeps the true color (Glow effect shifts green toward cyan/white).
MK.halo = function (L, blur, opacity) {
  var fx = L.property('ADBE Effect Parade');
  for (var i = fx.numProperties; i >= 1; i--) if (fx.property(i).matchName == 'ADBE Glo2') fx.property(i).remove();
  var D = L.duplicate(); D.name = L.name + ' Halo'; D.moveAfter(L);
  // Shape layers render only as big as their contents, so a blur gets cut off in a hard square. A huge transparent rect widens the layer so the blur can spread.
  if (D.matchName == 'ADBE Vector Layer') { var root = D.property('ADBE Root Vectors Group'); root.addProperty('ADBE Vector Group').name = 'Blur Bounds';
    var bv = function () { return D.property('ADBE Root Vectors Group').property('Blur Bounds').property('ADBE Vectors Group'); };
    bv().addProperty('ADBE Vector Shape - Rect'); bv().property(1).property('ADBE Vector Rect Size').setValue([5000, 5000]);
    bv().addProperty('ADBE Vector Graphic - Fill'); bv().property('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Opacity').setValue(0); }
  var b = D.property('ADBE Effect Parade').addProperty('ADBE Gaussian Blur 2'); b.property(1).setValue(blur || 45);
  try { b.property('Repeat Edge Pixels').setValue(0); } catch (e) {}
  var op = D.property('ADBE Transform Group').property('ADBE Opacity');
  if (op.numKeys == 0) op.setValue(opacity || 60); else op.expression = 'value*' + ((opacity || 60) / 100);
  return D;
};
