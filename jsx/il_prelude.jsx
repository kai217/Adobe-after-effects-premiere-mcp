// KAI MCP Illustrator prelude: helpers available to every il_* job. ExtendScript (ES3), Illustrator DOM.
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

  // ---------- documents ----------
  // K.doc(): active document, or a document by name / index / full path.
  K.doc = function (ref) {
    if (ref === undefined || ref === null || ref === '') { if (!app.documents.length) throw new Error('No Illustrator document is open.'); return app.activeDocument; }
    for (var i = 0; i < app.documents.length; i++) { var d = app.documents[i];
      if (d.name == ref || String(i) == String(ref)) return d;
      try { if (d.fullName.fsName.replace(/\\/g, '/').toLowerCase() == String(ref).replace(/\\/g, '/').toLowerCase()) return d; } catch (e) {} }
    throw new Error('document not found: ' + ref);
  };
  // Colours: [r,g,b] 0-255, '#rrggbb', or null for no fill. CMYK documents get the nearest CMYK.
  K.color = function (c, doc) {
    if (c === null || c === undefined || c === 'none') return new NoColor();
    var r, g, b;
    if (typeof c === 'string') { var h = c.replace('#', ''); r = parseInt(h.substr(0, 2), 16); g = parseInt(h.substr(2, 2), 16); b = parseInt(h.substr(4, 2), 16); }
    else { r = c[0]; g = c[1]; b = c[2]; }
    doc = doc || (app.documents.length ? app.activeDocument : null);
    if (doc && doc.documentColorSpace == DocumentColorSpace.CMYK) {
      var k = 1 - Math.max(r, g, b) / 255, x = new CMYKColor();
      x.black = k * 100; x.cyan = k < 1 ? (1 - r / 255 - k) / (1 - k) * 100 : 0; x.magenta = k < 1 ? (1 - g / 255 - k) / (1 - k) * 100 : 0; x.yellow = k < 1 ? (1 - b / 255 - k) / (1 - k) * 100 : 0; return x;
    }
    var o = new RGBColor(); o.red = r; o.green = g; o.blue = b; return o;
  };
  K.colorOut = function (c) { try {
    if (c.typename == 'RGBColor') return [Math.round(c.red), Math.round(c.green), Math.round(c.blue)];
    if (c.typename == 'CMYKColor') return { c: Math.round(c.cyan), m: Math.round(c.magenta), y: Math.round(c.yellow), k: Math.round(c.black) };
    if (c.typename == 'SpotColor') return { spot: c.spot.name };
    if (c.typename == 'GradientColor') return { gradient: c.gradient.name };
    if (c.typename == 'GrayColor') return { gray: Math.round(c.gray) };
    return c.typename == 'NoColor' ? null : c.typename; } catch (e) { return null; } };
  // Geometry: Illustrator's Y axis points UP and the origin is the artboard ruler origin. geometricBounds = [left, top, right, bottom].
  K.bounds = function (it) { try { var b = it.geometricBounds; return { left: b[0], top: b[1], right: b[2], bottom: b[3], width: b[2] - b[0], height: b[1] - b[3] }; } catch (e) { return null; } };
  K.itemInfo = function (it) {
    var o = { type: it.typename, name: it.name || '', layer: null, bounds: K.bounds(it) };
    try { o.layer = it.layer.name; } catch (e) {}
    try { o.hidden = it.hidden; o.locked = it.locked; o.opacity = it.opacity; } catch (e) {}
    if (it.typename == 'PathItem') { try { o.filled = it.filled; o.fill = it.filled ? K.colorOut(it.fillColor) : null; o.stroked = it.stroked; o.stroke = it.stroked ? K.colorOut(it.strokeColor) : null; o.strokeWidth = it.strokeWidth; o.closed = it.closed; o.points = it.pathPoints.length; } catch (e) {} }
    if (it.typename == 'TextFrame') { try { o.contents = String(it.contents).substr(0, 300); var a = it.textRange.characterAttributes; o.font = a.textFont.name; o.size = a.size; o.fill = K.colorOut(a.fillColor); o.kind = String(it.kind); } catch (e) {} }
    if (it.typename == 'PlacedItem' || it.typename == 'RasterItem') { try { o.file = it.file ? it.file.fsName : null; } catch (e) { o.file = null; } try { o.embedded = it.embedded; } catch (e) {} }
    if (it.typename == 'GroupItem') { try { o.children = it.pageItems.length; o.clipped = it.clipped; } catch (e) {} }
    if (it.typename == 'CompoundPathItem') { try { o.paths = it.pathItems.length; } catch (e) {} }
    if (it.typename == 'SymbolItem') { try { o.symbol = it.symbol.name; } catch (e) {} }
    return o;
  };
  K.layerTree = function (layers, depth) {
    var out = []; depth = depth || 0;
    for (var i = 0; i < layers.length; i++) { var L = layers[i];
      var o = { name: L.name, visible: L.visible, locked: L.locked, items: L.pageItems.length, color: K.colorOut(L.color) };
      if (L.layers.length && depth < 8) o.sublayers = K.layerTree(L.layers, depth + 1);
      out.push(o); }
    return out;
  };
  K.docInfo = function (d) {
    var o = { name: d.name, path: null, saved: d.saved, colorSpace: String(d.documentColorSpace).replace('DocumentColorSpace.', ''), rulerUnits: String(d.rulerUnits),
      width: d.width, height: d.height, artboards: [], layers: K.layerTree(d.layers), counts: { pageItems: d.pageItems.length, paths: d.pathItems.length, text: d.textFrames.length, placed: d.placedItems.length, raster: d.rasterItems.length, symbols: d.symbolItems.length },
      swatches: d.swatches.length, fonts: [] };
    try { o.path = d.fullName.fsName; } catch (e) {}
    for (var a = 0; a < d.artboards.length; a++) { var r = d.artboards[a].artboardRect; o.artboards.push({ index: a, name: d.artboards[a].name, rect: r, width: r[2] - r[0], height: r[1] - r[3] }); }
    var seen = {}; for (var t = 0; t < d.textFrames.length && t < 400; t++) { try { var f = d.textFrames[t].textRange.characterAttributes.textFont.name; if (!seen[f]) { seen[f] = 1; o.fonts.push(f); } } catch (e) {} }
    return o;
  };
  // Find page items by name (exact or /regex/), optionally inside one layer.
  K.find = function (d, name, layerName) {
    var re = null, out = []; if (name && name.charAt(0) == '/') { var m = name.match(/^\/(.*)\/([a-z]*)$/); re = new RegExp(m[1], m[2]); }
    var items = layerName ? K.layer(d, layerName).pageItems : d.pageItems;
    for (var i = 0; i < items.length; i++) { var it = items[i]; if (!name || (re ? re.test(it.name) : it.name == name)) out.push(it); }
    return out;
  };
  K.item = function (d, name, layerName) { var r = K.find(d, name, layerName); if (!r.length) throw new Error('item not found: ' + name); return r[0]; };
  K.layer = function (d, name) { // "Parent/Child" paths are allowed
    var parts = String(name).split('/'), cur = d.layers.getByName(parts[0]);
    for (var i = 1; i < parts.length; i++) cur = cur.layers.getByName(parts[i]);
    return cur;
  };
  K.font = function (n) { try { return app.textFonts.getByName(n); } catch (e) {
      for (var i = 0; i < app.textFonts.length; i++) { var f = app.textFonts[i]; if (f.name == n || f.family + ' ' + f.style == n || f.family == n) return f; }
      throw new Error('font not installed: ' + n); } };
  // Export one artboard as PNG at a scale (100 = 72 ppi). Returns the file path Illustrator actually wrote.
  K.exportPNG = function (d, file, artboard, scale, transparent) {
    d.artboards.setActiveArtboardIndex(artboard || 0);
    var o = new ExportOptionsPNG24(); o.artBoardClipping = true; o.horizontalScale = scale || 100; o.verticalScale = scale || 100; o.transparency = !!transparent; o.antiAliasing = true;
    var f = new File(file); d.exportFile(f, ExportType.PNG24, o); return f.fsName;
  };
  K.exportSVG = function (d, file, artboard) {
    var o = new ExportOptionsSVG(); o.embedRasterImages = true; o.fontType = SVGFontType.OUTLINEFONT; o.cssProperties = SVGCSSPropertyLocation.STYLEATTRIBUTES;
    try { o.saveMultipleArtboards = true; o.artboardRange = String((artboard || 0) + 1); } catch (e) {}
    var f = new File(file); d.exportFile(f, ExportType.SVG, o); return f.fsName;
  };
  K.unit = { pt: 1, px: 1, 'in': 72, mm: 2.834645669, cm: 28.34645669 };
}(KAI));
