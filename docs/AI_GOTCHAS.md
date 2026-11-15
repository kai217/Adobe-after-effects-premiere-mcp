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

Text
- Fonts by PostScript name: `app.textFonts.getByName('Gotham-Black')` (KAI.font also tries "Family Style").
- Point text (`textFrames.add()`) vs area text (`textFrames.areaText(path)`): area text wraps, point text doesn't.
- Character attributes live on `textFrame.textRange.characterAttributes`; paragraph alignment on `.paragraphAttributes.justification`.
- Outlining text: `textFrame.createOutline()` returns a GroupItem; do this before sending type to AE if the font may be missing there.

Colour
- Document colour space is fixed at creation (RGB or CMYK). KAI.color() converts hex/RGB to CMYK for CMYK documents.
- `fillColor` on a TextFrame itself does nothing; set it on characterAttributes.

Export
- `exportFile` names files after the artboard when "use artboards" is on; KAI.exportPNG sets the active artboard and clips to it.
- PNG scale is a percentage of 72 ppi: 400 = 4x (288 ppi). Max is 776%.
- SVG export of text: use outlines (fontType OUTLINEFONT) for files going to the web or AE.
- `saveAs` switches the open document to the new file. il_to_ae refuses on unsaved changes, saves a copy, then reopens the original.

Illustrator -> After Effects (il_to_ae)
- The .ai must be PDF-compatible. AE imports it as "Composition - Retain Layer Sizes": one AE layer per top-level Illustrator layer.
  Put each part you want to animate on its own top-level layer in Illustrator.
- "Create Shapes from Vector Layer" turns each layer into an editable shape layer (the original vector layer is switched off).
  Gradients, effects, raster images and some blend modes don't convert; those layers stay as vector footage.
- Sublayers are flattened into their parent layer on import.

Image Trace (il_trace)
- `placedItem.trace()` returns a PluginItem; `tracing.tracingOptions.loadFromPreset(name)` uses the preset names shown in the
  Image Trace panel; `expandTracing()` gives a GroupItem of paths. Tracing big photos is slow (run with a long timeout).
