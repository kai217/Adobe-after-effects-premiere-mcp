# Illustrator scripting gotchas (KAI-AE-MCP)

How scripts reach Illustrator
- Through the KAI MCP Bridge CEP panel (same extension as AE/Premiere, host ILST), or, with no panel, straight through Windows COM
  (`Illustrator.Application.DoJavaScriptFile`) / macOS AppleScript (`do javascript`). The direct route only runs when Illustrator is
  already open, so a tool never launches it by surprise. Third-party UXP is not open in Illustrator yet (Nov 2026).
- ExtendScript is ES3: no let/const/arrow functions/JSON. KAI.stringify / KAI.parse are provided.
- Alerts are switched off during every job (`userInteractionLevel = DONTDISPLAYALERTS`) and restored after, so a missing-font or
  link dialog can't block the bridge.
- No scripted undo groups: save a version (il_save mode "version") before big edits.

Coordinates and units
- Internal units are always points (1/72 in), whatever the ruler shows. In an RGB/px document 1 pt = 1 px.
- Illustrator's Y axis points UP. `position` is the item's top-left; `geometricBounds` = [left, top, right, bottom] (top > bottom).
- The origin is the ruler origin of the document, not necessarily artboard 1's corner. Always work relative to
  `doc.artboards[i].artboardRect` = [left, top, right, bottom]. The il_add / il_set tools take x/y from the artboard's top-left with y DOWN.
- `pathItems.rectangle(top, left, width, height)` — top first.
- `visibleBounds` includes stroke width; `geometricBounds` doesn't.
- Clipped groups (clipping masks) report the bounds of ALL the artwork inside them, hidden parts included, for both `geometricBounds` and
  `visibleBounds`. Scaling or centring a clipped group by those numbers puts it in the wrong place. Use `KAI.clipBounds(item)`: it returns the
  clipping path's bounds, and works through groups that contain clipped groups. `KAI.itemInfo` adds `clipBounds` for clipped groups.
- A clipping path is a normal PathItem with `clipping == true`: skip it when recolouring a group, or the mask gets a fill.

Text
- Fonts by PostScript name: `app.textFonts.getByName('Gotham-Black')` (KAI.font also tries "Family Style").
- Point text (`textFrames.add()`) vs area text (`textFrames.areaText(path)`): area text wraps, point text doesn't.
- Character attributes live on `textFrame.textRange.characterAttributes`; paragraph alignment on `.paragraphAttributes.justification`.
- Reading attributes from a whole range (`textFrame.textRange.characterAttributes.size`, `.tracking`) can throw "illegal text range" on a frame
  that was just created or resized. Setting them is fine. To read, use `textFrame.characters[0].characterAttributes`, or keep the value you set.
  To fit point text to a width: measure the frame, remove it and make it again at `size * wanted / measured` instead of re-reading the size.
- Outlining text: `textFrame.createOutline()` returns a GroupItem; do this before sending type to AE if the font may be missing there.

Colour
- Document colour space is fixed at creation (RGB or CMYK). KAI.color() converts hex/RGB to CMYK for CMYK documents.
- `fillColor` on a TextFrame itself does nothing; set it on characterAttributes.

Export
- `exportFile` names files after the artboard when "use artboards" is on; KAI.exportPNG sets the active artboard and clips to it.
- PNG scale is a percentage of 72 ppi: 400 = 4x (288 ppi). Max is 776%.
- SVG export of text: use outlines (fontType OUTLINEFONT) for files going to the web or AE.
- `saveAs` switches the open document to the new file. il_to_ae refuses on unsaved changes, saves a copy, then reopens the original.
- il_export / il_preview / il_save work on the ACTIVE document unless `document` is given. With two documents open, pass `document` (or
  activate the one you mean first); the result names the document it used.
- Don't call `doc.save()` / `saveAs` inside a long il_run_script that also touches a second document: Illustrator can stop answering.
  Do the edits in the script and save afterwards with il_save.
- File names: il_export writes `<prefix>_<artboard name>` with anything that isn't a letter, digit, `_` or `-` turned into `_`.

Illustrator -> After Effects (il_to_ae)
- The .ai must be PDF-compatible. AE imports it as "Composition - Retain Layer Sizes": one AE layer per top-level Illustrator layer.
  Put each part you want to animate on its own top-level layer in Illustrator.
- "Create Shapes from Vector Layer" turns each layer into an editable shape layer (the original vector layer is switched off).
  Gradients, effects, raster images and some blend modes don't convert; those layers stay as vector footage.
- Sublayers are flattened into their parent layer on import.
- il_to_ae closes its temporary copy and reopens the source. If a different document was in front before the call, it is brought back to the
  front afterwards, so following il_* calls keep hitting the same document.
- Live text does not convert: outline it first (il_to_ae does this in the exported copy only).

Image Trace (il_trace)
- `placedItem.trace()` returns a PluginItem; `tracing.tracingOptions.loadFromPreset(name)` uses the preset names shown in the
  Image Trace panel; `expandTracing()` gives a GroupItem of paths. Tracing big photos is slow (run with a long timeout).
