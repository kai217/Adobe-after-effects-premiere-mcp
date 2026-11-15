// Illustrator tools (il_*). Scripts run through the KAI MCP Bridge CEP panel inside Illustrator, or, when the panel is not loaded,
// straight through Windows COM / macOS AppleScript (Illustrator must already be running). See docs/AI_GOTCHAS.md.
// Coordinates in these tools are friendly: x/y in points from the artboard's TOP-LEFT corner, y growing DOWN (like AE/Premiere/Figma).
import fs from 'node:fs';
import path from 'node:path';
import { thumbJpeg } from './media.js';
import { readHeartbeat, describeBridge, isILRunning, ROOT } from './ae.js';

export function registerIllustrator({ tool, text, fail, ae, cfg, z }) {
  const il = (name, args, code, opts = {}) => ae(name, args, code, { ...opts, host: 'il' });
  const guard = z.string().optional().describe('Document guard: refuse to run unless the active document path contains this text. Use it for every edit to a client file.');
  const color = z.union([z.string(), z.array(z.number()).length(3), z.null()]).optional().describe('"#rrggbb", [r,g,b] 0-255, or null for none');

  // Shared ExtendScript: artboard-relative top-left coordinates -> Illustrator coordinates.
  const AB = `
    function __ab(d, i) { var r = d.artboards[i || 0].artboardRect; return { L: r[0], T: r[1], R: r[2], B: r[3] }; }
    function __place(it, d, a, x, y) { var ab = __ab(d, a); it.position = [ab.L + x, ab.T - y]; }
    function __style(it, d, A) {
      if (A.fill !== undefined) { if (A.fill === null) it.filled = false; else { it.filled = true; it.fillColor = KAI.color(A.fill, d); } }
      if (A.stroke !== undefined) { if (A.stroke === null) it.stroked = false; else { it.stroked = true; it.strokeColor = KAI.color(A.stroke, d); } }
      if (A.stroke_width !== undefined) it.strokeWidth = A.stroke_width;
      if (A.opacity !== undefined) it.opacity = A.opacity;
    }`;

  tool('il_status', 'Check that Illustrator is reachable and report version, open documents and the active document (artboards, layers, counts, fonts). Call first in an Illustrator session, then il_guide once.', {},
    async () => {
      const hb = readHeartbeat(cfg, 'il'), running = await isILRunning();
      if (!running) return text({ running: false, hint: 'Open Illustrator (and your document) first.' });
      const r = await il('il_status', {}, `
        var docs = []; for (var i = 0; i < app.documents.length; i++) docs.push(app.documents[i].name);
        return { version: app.version, documents: docs, active: app.documents.length ? KAI.docInfo(app.activeDocument) : null };`, { timeoutSec: 60 });
      return text({ running: true, bridge: hb.connected ? describeBridge(hb, 'Illustrator') : 'no panel: using the direct COM/AppleScript route', ...r });
    });

  tool('il_guide', 'Read once per Illustrator session: Illustrator scripting gotchas (Y axis up, points, artboard origin, alerts, fonts, export quirks) and the KAI.* helpers available in every il_run_script.', {},
    async () => text(fs.readFileSync(path.join(ROOT, 'docs', 'AI_GOTCHAS.md'), 'utf8') + '\n\n## KAI helpers (il_run_script)\n' +
      fs.readFileSync(path.join(ROOT, 'jsx', 'il_prelude.jsx'), 'utf8').split('\n').filter(l => /^\s*K\.[A-Za-z_]+ = |^\s*\/\/ /.test(l)).map(l => l.trim()).join('\n')));

  tool('il_run_script', 'Run any ExtendScript in Illustrator and return its result (body of a function; `return` sends data back). Helpers: KAI.doc(ref), KAI.docInfo(doc), KAI.itemInfo(item), KAI.find(doc, name|/re/, layer), KAI.item(...), KAI.layer(doc, "A/B"), KAI.color("#hex"|[r,g,b]), KAI.font(name), KAI.bounds(item), KAI.exportPNG(doc, file, artboard, scale), KAI.exportSVG(...). ARGS holds args. Alerts are suppressed during the run. Illustrator has no scripted undo groups: save a copy (il_save version) before big edits.',
    { code: z.string(), args: z.record(z.any()).optional(), timeout_sec: z.number().optional(), expected_project: guard },
    async (a) => text(await il('il_run_script', a.args || {}, a.code, { timeoutSec: a.timeout_sec, expectedProject: a.expected_project })));

  tool('il_document', 'Describe an Illustrator document: color space, artboards (index, name, size), layer tree, fonts used, counts, and optionally every page item (type, name, layer, bounds, fill/stroke, text contents/font/size, placed file). Read-only.',
    { document: z.string().optional().describe('name, index or path (default: active)'), items: z.boolean().optional().describe('also list page items'), layer: z.string().optional(), limit: z.number().optional() },
    async (a) => text(await il('il_document', a, `
      var d = KAI.doc(ARGS.document), o = KAI.docInfo(d);
      if (ARGS.items) { var src = ARGS.layer ? KAI.layer(d, ARGS.layer).pageItems : d.pageItems, lim = ARGS.limit || 300; o.items = [];
        for (var i = 0; i < src.length && i < lim; i++) o.items.push(KAI.itemInfo(src[i])); o.itemsTruncated = src.length > lim; }
      return o;`)));

  tool('il_new_document', 'Create a new Illustrator document. Units: px (default), pt, in, mm. Color space RGB (default, for video/web) or CMYK (print). Optionally several artboards in a row.',
    { name: z.string().optional(), width: z.number(), height: z.number(), units: z.enum(['px', 'pt', 'in', 'mm']).optional(), color_space: z.enum(['RGB', 'CMYK']).optional(), artboards: z.number().optional(), spacing: z.number().optional() },
    async (a) => text(await il('il_new_document', a, `
      var u = KAI.unit[ARGS.units || 'px'], p = new DocumentPreset();
      p.width = ARGS.width * u; p.height = ARGS.height * u; p.colorMode = ARGS.color_space == 'CMYK' ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
      p.units = ({ px: RulerUnits.Pixels, pt: RulerUnits.Points, 'in': RulerUnits.Inches, mm: RulerUnits.Millimeters })[ARGS.units || 'px'];
      p.numArtboards = ARGS.artboards || 1; p.artboardSpacing = (ARGS.spacing || 40) * u; p.artboardLayout = DocumentArtboardLayout.Row;
      if (ARGS.name) p.title = ARGS.name;
      var d = app.documents.addDocument(ARGS.color_space == 'CMYK' ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB, p);
      return KAI.docInfo(d);`)));

  tool('il_open', 'Open an .ai/.pdf/.svg/.eps file in Illustrator (or switch to it if already open).',
    { path: z.string() },
    async (a) => text(await il('il_open', a, `
      for (var i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName.toLowerCase() == new File(ARGS.path).fsName.toLowerCase()) { app.documents[i].activate(); return KAI.docInfo(app.documents[i]); } } catch (e) {} }
      var f = new File(ARGS.path); if (!f.exists) throw new Error('file not found: ' + ARGS.path);
      return KAI.docInfo(app.open(f));`, { timeoutSec: 120 })));

  tool('il_save', 'Save the active document. mode "save" (in place), "as" (to path; format from extension: .ai .pdf .svg .eps), or "version" (numbered copy next to it, keeps working in the copy).',
    { mode: z.enum(['save', 'as', 'version']).optional(), path: z.string().optional(), document: z.string().optional(), expected_project: guard },
    async (a) => text(await il('il_save', a, `
      var d = KAI.doc(ARGS.document), mode = ARGS.mode || 'save', target = null;
      if (mode == 'save') { if (!d.saved || d.fullName) { try { d.save(); return { saved: d.fullName.fsName }; } catch (e) { throw new Error('document has no file yet: use mode "as" with a path'); } } }
      if (mode == 'version') { var base = d.fullName.fsName.replace(/(_v\\d{3})?\\.ai$/i, ''), n = 1; while (new File(base + '_v' + ('00' + n).slice(-3) + '.ai').exists) n++; target = base + '_v' + ('00' + n).slice(-3) + '.ai'; }
      else target = ARGS.path;
      var f = new File(target), ext = target.split('.').pop().toLowerCase();
      if (ext == 'pdf') d.saveAs(f, new PDFSaveOptions());
      else if (ext == 'svg') d.exportFile(f, ExportType.SVG, new ExportOptionsSVG());
      else if (ext == 'eps') d.saveAs(f, new EPSSaveOptions());
      else { var o = new IllustratorSaveOptions(); o.pdfCompatible = true; o.compressed = true; d.saveAs(f, o); }
      return { saved: f.fsName };`, { expectedProject: a.expected_project, timeoutSec: 180 })));

  tool('il_add', 'Add artwork: rect, ellipse, line, path (points), text, image (place a file, linked or embedded), or svg (import as editable vectors). Position x/y and size w/h are in points from the artboard top-left, y down. Returns the new item.',
    { kind: z.enum(['rect', 'ellipse', 'line', 'path', 'text', 'image', 'svg']), artboard: z.number().optional(), layer: z.string().optional(), name: z.string().optional(),
      x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), radius: z.number().optional().describe('rounded rect corner radius'),
      points: z.array(z.array(z.number())).optional().describe('[[x,y],...] for path/line, artboard top-left, y down'), closed: z.boolean().optional(),
      fill: color, stroke: color, stroke_width: z.number().optional(), opacity: z.number().optional(),
      text: z.string().optional(), font: z.string().optional().describe('PostScript name, e.g. Gotham-Black'), size: z.number().optional(), tracking: z.number().optional(), leading: z.number().optional(), justify: z.enum(['left', 'center', 'right']).optional(),
      file: z.string().optional(), embed: z.boolean().optional(), expected_project: guard },
    async (a) => text(await il('il_add', a, AB + `
      var d = KAI.doc(), A = ARGS, ab = __ab(d, A.artboard), parent = A.layer ? (function(){ try { return KAI.layer(d, A.layer); } catch (e) { var L = d.layers.add(); L.name = A.layer; return L; } })() : d.activeLayer;
      var x = A.x || 0, y = A.y || 0, w = A.w || 100, h = A.h || 100, it;
      if (A.kind == 'rect') it = A.radius ? parent.pathItems.roundedRectangle(ab.T - y, ab.L + x, w, h, A.radius, A.radius) : parent.pathItems.rectangle(ab.T - y, ab.L + x, w, h);
      else if (A.kind == 'ellipse') it = parent.pathItems.ellipse(ab.T - y, ab.L + x, w, h);
      else if (A.kind == 'line' || A.kind == 'path') { var pts = []; for (var i = 0; i < A.points.length; i++) pts.push([ab.L + A.points[i][0], ab.T - A.points[i][1]]);
        it = parent.pathItems.add(); it.setEntirePath(pts); it.closed = A.kind == 'path' ? A.closed !== false : false; if (A.kind == 'line') { it.filled = false; it.stroked = true; } }
      else if (A.kind == 'text') { it = (A.w ? parent.textFrames.areaText(parent.pathItems.rectangle(ab.T - y, ab.L + x, w, h)) : parent.textFrames.add()); it.contents = A.text || '';
        var ca = it.textRange.characterAttributes; if (A.font) ca.textFont = KAI.font(A.font); if (A.size) ca.size = A.size; if (A.tracking !== undefined) ca.tracking = A.tracking; if (A.leading) { ca.autoLeading = false; ca.leading = A.leading; }
        if (A.fill !== undefined && A.fill !== null) ca.fillColor = KAI.color(A.fill, d);
        if (A.justify) it.textRange.paragraphAttributes.justification = ({ left: Justification.LEFT, center: Justification.CENTER, right: Justification.RIGHT })[A.justify];
        if (!A.w) __place(it, d, A.artboard, x, y); }
      else if (A.kind == 'image') { var f = new File(A.file); if (!f.exists) throw new Error('file not found: ' + A.file); it = parent.placedItems.add(); it.file = f;
        if (A.w) { var r = it.height / it.width; it.width = A.w; it.height = A.h || A.w * r; } __place(it, d, A.artboard, x, y); if (A.embed) { it.embed(); it = d.selection && d.selection.length ? d.selection[0] : it; } }
      else if (A.kind == 'svg') { var g = parent.groupItems.createFromFile(new File(A.file)); it = g; if (A.w) { var s = A.w / g.width * 100; g.resize(s, s); } __place(it, d, A.artboard, x, y); }
      if (A.kind != 'text' && A.kind != 'image' && A.kind != 'svg') __style(it, d, A);
      if (A.opacity !== undefined) it.opacity = A.opacity;
      if (A.name) it.name = A.name;
      return KAI.itemInfo(it);`, { expectedProject: a.expected_project })));

  tool('il_set', 'Change existing items found by name (exact or /regex/) and/or layer: fill, stroke, stroke width, opacity, position (x/y from artboard top-left, y down), size, rotation, text contents/font/size/tracking, hidden/locked, rename, stacking (front/back), blend mode.',
    { name: z.string().optional(), layer: z.string().optional(), artboard: z.number().optional(), fill: color, stroke: color, stroke_width: z.number().optional(), opacity: z.number().optional(),
      x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), rotate: z.number().optional(),
      text: z.string().optional(), font: z.string().optional(), size: z.number().optional(), tracking: z.number().optional(),
      hidden: z.boolean().optional(), locked: z.boolean().optional(), rename: z.string().optional(), order: z.enum(['front', 'back', 'forward', 'backward']).optional(),
      blend: z.enum(['normal', 'multiply', 'screen', 'overlay', 'softlight', 'hardlight', 'color', 'luminosity']).optional(), expected_project: guard },
    async (a) => text(await il('il_set', a, AB + `
      var d = KAI.doc(), A = ARGS, items = KAI.find(d, A.name, A.layer), out = [];
      if (!items.length) throw new Error('no items match ' + (A.name || '') + (A.layer ? ' in layer ' + A.layer : ''));
      for (var i = 0; i < items.length; i++) { var it = items[i];
        if (it.typename == 'TextFrame') { var ca = it.textRange.characterAttributes;
          if (A.text !== undefined) it.contents = A.text; if (A.font) ca.textFont = KAI.font(A.font); if (A.size) ca.size = A.size; if (A.tracking !== undefined) ca.tracking = A.tracking;
          if (A.fill !== undefined && A.fill !== null) ca.fillColor = KAI.color(A.fill, d); }
        else if (it.typename == 'PathItem') __style(it, d, A);
        else if (it.typename == 'GroupItem' || it.typename == 'CompoundPathItem') { var ps = it.typename == 'GroupItem' ? it.pathItems : it.pathItems; for (var p = 0; p < ps.length; p++) __style(ps[p], d, A); }
        if (A.opacity !== undefined) it.opacity = A.opacity;
        if (A.w || A.h) { var sx = A.w ? A.w / it.width * 100 : (A.h / it.height * 100), sy = A.h ? A.h / it.height * 100 : sx; it.resize(sx, sy); }
        if (A.x !== undefined || A.y !== undefined) { var b = KAI.bounds(it), ab = __ab(d, A.artboard); __place(it, d, A.artboard, A.x !== undefined ? A.x : b.left - ab.L, A.y !== undefined ? A.y : ab.T - b.top); }
        if (A.rotate) it.rotate(A.rotate);
        if (A.hidden !== undefined) it.hidden = A.hidden; if (A.locked !== undefined) it.locked = A.locked;
        if (A.rename) it.name = items.length > 1 ? A.rename + ' ' + (i + 1) : A.rename;
        if (A.order) it.zOrder(({ front: ZOrderMethod.BRINGTOFRONT, back: ZOrderMethod.SENDTOBACK, forward: ZOrderMethod.BRINGFORWARD, backward: ZOrderMethod.SENDBACKWARD })[A.order]);
        if (A.blend) it.blendingMode = ({ normal: BlendModes.NORMAL, multiply: BlendModes.MULTIPLY, screen: BlendModes.SCREEN, overlay: BlendModes.OVERLAY, softlight: BlendModes.SOFTLIGHT, hardlight: BlendModes.HARDLIGHT, color: BlendModes.COLORBLEND, luminosity: BlendModes.LUMINOSITY })[A.blend];
        out.push(KAI.itemInfo(it)); }
      return { changed: out.length, items: out };`, { expectedProject: a.expected_project })));

  tool('il_export', 'Export artboards: png (scale % of 72 ppi; 400 = 4x), jpg, svg, or pdf. One file per artboard in out_dir (default: work folder). Returns the files written.',
    { format: z.enum(['png', 'jpg', 'svg', 'pdf']), artboards: z.array(z.number()).optional().describe('artboard indexes (default all)'), scale: z.number().optional(), transparent: z.boolean().optional(),
      out_dir: z.string().optional(), prefix: z.string().optional(), document: z.string().optional() },
    async (a) => {
      const out = a.out_dir || path.join(cfg.workDir, 'il', 'exports');
      fs.mkdirSync(out, { recursive: true });
      return text(await il('il_export', { ...a, out: out.replace(/\\/g, '/') }, `
        var d = KAI.doc(ARGS.document), idx = ARGS.artboards, files = [], pre = ARGS.prefix || d.name.replace(/\\.[^.]+$/, '');
        if (!idx) { idx = []; for (var i = 0; i < d.artboards.length; i++) idx.push(i); }
        for (var k = 0; k < idx.length; k++) { var n = idx[k], base = ARGS.out + '/' + pre + '_' + d.artboards[n].name.replace(/[^A-Za-z0-9_-]+/g, '_');
          if (ARGS.format == 'png') files.push(KAI.exportPNG(d, base + '.png', n, ARGS.scale || 100, ARGS.transparent));
          else if (ARGS.format == 'svg') files.push(KAI.exportSVG(d, base + '.svg', n));
          else if (ARGS.format == 'jpg') { d.artboards.setActiveArtboardIndex(n); var o = new ExportOptionsJPEG(); o.artBoardClipping = true; o.horizontalScale = o.verticalScale = ARGS.scale || 100; o.qualitySetting = 90; var f = new File(base + '.jpg'); d.exportFile(f, ExportType.JPEG, o); files.push(f.fsName); }
          else { var po = new PDFSaveOptions(); po.artboardRange = String(n + 1); var pf = new File(base + '.pdf'); d.saveAs(pf, po); files.push(pf.fsName); } }
        return { files: files };`, { timeoutSec: 300 }));
    });

  tool('il_preview', 'Render artboards to PNG (no screen takeover) and show them, to check the work visually.',
    { artboards: z.array(z.number()).optional(), scale: z.number().optional(), max_width: z.number().optional(), document: z.string().optional() },
    async (a) => {
      const dir = path.join(cfg.workDir, 'frames', 'il_' + Date.now()); fs.mkdirSync(dir, { recursive: true });
      const r = await il('il_preview', { ...a, out: dir.replace(/\\/g, '/') }, `
        var d = KAI.doc(ARGS.document), idx = ARGS.artboards || [d.artboards.getActiveArtboardIndex()], files = [];
        for (var k = 0; k < idx.length; k++) files.push(KAI.exportPNG(d, ARGS.out + '/ab' + idx[k] + '.png', idx[k], ARGS.scale || 100, false));
        return { files: files };`, { timeoutSec: 180 });
      const content = [{ type: 'text', text: JSON.stringify(r) }];
      for (const f of r.files) { let ff = f; if (!fs.existsSync(ff)) { const alt = fs.readdirSync(dir).map(n => path.join(dir, n)); ff = alt[0] || f; }
        content.push({ type: 'image', data: (await thumbJpeg(ff, a.max_width || 900)).toString('base64'), mimeType: 'image/jpeg' }); }
      return { content };
    });

  tool('il_trace', 'Vectorize a raster image with Image Trace (logo, sketch, photo) and expand it to editable paths. Give a file to place, or the name of a placed/raster item. Presets: "High Fidelity Photo", "Low Fidelity Photo", "3 Colors", "6 Colors", "16 Colors", "Shades of Gray", "Black and White Logo", "Sketched Art", "Silhouettes", "Line Art", "Technical Drawing".',
    { file: z.string().optional(), item: z.string().optional(), preset: z.string().optional(), x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), name: z.string().optional(), expected_project: guard },
    async (a) => text(await il('il_trace', a, AB + `
      var d = KAI.doc(), A = ARGS, it;
      if (A.file) { it = d.activeLayer.placedItems.add(); it.file = new File(A.file); if (A.w) { var r = it.height / it.width; it.width = A.w; it.height = A.w * r; } __place(it, d, 0, A.x || 0, A.y || 0); }
      else it = KAI.item(d, A.item);
      var t = it.trace(); if (A.preset) t.tracing.tracingOptions.loadFromPreset(A.preset); app.redraw();
      var g = t.tracing.expandTracing(); if (A.name) g.name = A.name;
      return KAI.itemInfo(g);`, { expectedProject: a.expected_project, timeoutSec: 300 })));

  tool('il_to_ae', 'Send Illustrator artwork to After Effects: saves a PDF-compatible copy of the document (or only some layers), imports it into the open AE project as a comp with one layer per Illustrator layer, and optionally converts every layer to native AE shape layers (Create Shapes from Vector Layer) so paths can be animated. Each layer stays separately editable.',
    { document: z.string().optional(), layers: z.array(z.string()).optional().describe('only these top-level layers (default all visible)'), comp_name: z.string().optional(), shapes: z.boolean().optional().describe('convert to AE shape layers (default true)'), folder: z.string().optional().describe('AE project folder name') },
    async (a) => {
      const out = path.join(cfg.workDir, 'il', 'exports', 'to_ae_' + Date.now() + '.ai').replace(/\\/g, '/');
      const r = await il('il_to_ae', { ...a, out }, `
        var src = KAI.doc(ARGS.document), keep = ARGS.layers, hidden = [], __o = null; try { __o = src.fullName; } catch (e) {}
        if (__o && !src.saved) throw new Error('The document has unsaved changes. Save it first (il_save): il_to_ae writes a copy and then reopens the saved original.');
        if (keep) for (var i = 0; i < src.layers.length; i++) { var L = src.layers[i], want = false; for (var k = 0; k < keep.length; k++) if (L.name == keep[k]) want = true; if (!want && L.visible) { L.visible = false; hidden.push(L); } }
        var o = new IllustratorSaveOptions(); o.pdfCompatible = true; o.compressed = false; o.saveMultipleArtboards = false;
        var f = new File(ARGS.out), orig = null; try { orig = src.fullName; } catch (e) {}
        src.saveAs(f, o);
        var layers = []; for (var j = 0; j < src.layers.length; j++) if (src.layers[j].visible) layers.push(src.layers[j].name);
        for (var h = 0; h < hidden.length; h++) hidden[h].visible = true;
        if (orig) { src.close(SaveOptions.DONOTSAVECHANGES); app.open(orig); }
        return { file: f.fsName, layers: layers, reopened: orig ? orig.fsName : null };`, { timeoutSec: 300 });
      const aeRes = await ae('il_to_ae', { file: r.file, comp_name: a.comp_name, shapes: a.shapes !== false, folder: a.folder }, `
        var io = new ImportOptions(new File(ARGS.file)); io.importAs = ImportAsType.COMP_CROPPED_LAYERS;
        var comp = app.project.importFile(io); if (ARGS.comp_name) comp.name = ARGS.comp_name;
        if (ARGS.folder) { var fo = null; for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name == ARGS.folder && app.project.item(i) instanceof FolderItem) fo = app.project.item(i); if (!fo) fo = app.project.items.addFolder(ARGS.folder); comp.parentFolder = fo; }
        var made = [];
        if (ARGS.shapes) { comp.openInViewer(); var cmd = app.findMenuCommandId('Create Shapes from Vector Layer'), n = comp.numLayers;
          for (var l = n; l >= 1; l--) { var L = comp.layer(l); if (!(L.source instanceof FootageItem)) continue;
            for (var s = 1; s <= comp.numLayers; s++) comp.layer(s).selected = false; L.selected = true; app.executeCommand(cmd); made.push(L.name); } }
        var names = []; for (var m = 1; m <= comp.numLayers; m++) names.push(comp.layer(m).name + (comp.layer(m).enabled ? '' : ' (off: original vector)'));
        return { comp: comp.name, size: [comp.width, comp.height], layers: names, shapeLayersMade: made.length };`, { undo: 'Illustrator to AE' });
      return text({ illustrator: r, afterEffects: aeRes });
    });
}
