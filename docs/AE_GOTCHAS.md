# After Effects scripting gotchas (read before building)

Every rule here came from a real bug hit while building with this MCP.

## ExtendScript (ES3)
- Reserved words can't be bare object keys or dot properties: `{in: 1}` and `o.in` fail with "Illegal use of reserved word". The MCP quotes them automatically, but write `{'in': 1}` anyway.
- Never concatenate an array into a string (`'[' + color + ']'`). In AE's ExtendScript that throws "invalid numeric result (divide by zero?)". Use `color.join(',')`.
- `instanceof TextLayer` / `ShapeLayer` can return wrong results inside eval'd jobs. Use `layer.matchName` ("ADBE Text Layer", "ADBE Vector Layer", ...) or `KAI.layerType(layer)`.

## Property references
- Adding a property to a shape group (rect, fill, stroke, another group) invalidates earlier references to its siblings ("Object is invalid"). Re-resolve from the layer by name after every `addProperty`. `MK.box/ellipse/path` return handles whose accessors do this for you: `h.size()`, `h.pos()`, `h.fill()`.
- Sibling properties can share a matchName (40 `ADBE Vector Group`s in one layer). Address them by index, not by matchName. `KAI.walk` paths add `[i]` for duplicates, and `KAI.prop` understands it.
- In this AE build, a layer object obtained via `comp.layer(1)` can end up pointing at whatever is at index 1 later. Keep layer names or ids, not objects, across operations that add layers.

- Setting `layer.parent` in a script works like the UI: the child's rotation, scale and position are adjusted to compensate for the parent's current transform. If the parent is already rotated or scaled, children end up with odd rotation and scale (e.g. -10°). Parent first and animate the parent afterwards, or reset the child's rotation and scale after parenting.

## Shape layers and effects
- Shape groups stack top-down: the first group in Contents draws on top. Add a background shape last, or `moveTo(1)` the group that must be on top.
- A blur on a shape layer is clipped to the layer's content bounds, which shows as a faint hard-edged square. Add a large transparent rect ("Blur Bounds") or use `MK.halo`.
- The Glow effect shifts saturated colors (brand green turns cyan/white). For a soft glow in the true color, use a blurred duplicate underneath (`MK.halo`).
- Track mattes (AE 2023+): `layer.setTrackMatte(matteLayer, TrackMatteType.ALPHA)`. The matte layer can sit anywhere and is hidden automatically.
- A "liquid fill" clipped by a matte should have square corners and a flat top. Let the matte do the rounding.

## 3D and layer order
- With 3D layers, z position decides what's in front, not layer order. Negative z is closer to the camera. Text on a 3D panel at z -2 disappears behind a panel at z -4. Keep a clear z order (panel 0, sub-panels -4, content -16).
- AE draws both sides of a layer. For a card flip, give each face an opacity expression based on the parent's Y rotation (front when |y| < 90, back otherwise), and set Orientation Y = 180 on the back face so it reads correctly.
- Shape-layer holes (windows): put the full rect and the hole rects in one group, then Merge Paths with type 3 (Subtract), then the fill.
- Endless parallax: one element plus a Repeater, with position `-((time*speed) % spacing)` so it loops seamlessly.
- Text on a circle: add an ellipse mask to the text layer, set Path Options > Path = 1, and animate First Margin.

## Moving layers between comps
- `layer.copyToComp(comp)` throws inside an Undo Group for layers with parents or linked expressions. Run those jobs without `undo_name`.
- `copyToComp` doesn't always put the copy at index 1. Find the new layer by comparing layer ids before and after.
- After moving layers out of a precomp, expressions using `time` must use `(time - thisLayer.startTime)`, and `layer("Name")` references must be renamed to the new layer names.
- Parent links and track mattes are not copied. Re-apply them after copying.

## Working on real projects
- Never cut a master comp in the middle of a pre-comp's beat. Duplicate the section comp and edit inside the duplicate.
- Shared child comps (e.g. "V# Original 16x9") are used by several masters. Editing them changes every master.
- Saving: `ae_save` with mode `version` writes a new numbered file and leaves the original untouched.
- Don't render big projects to check work. Use `ae_preview` frames (and `ae_check`) instead.

## Checking your work
- Check at full resolution (`ae_preview` resolution 1) and zoom into edges. Quarter-res contact sheets hide clipped blurs, slivers and peeking shapes.
- Run `ae_check` on the comp after every build step: it finds expression errors, disabled expressions, missing footage and fonts, clipped shape-layer blurs and Glow color shifts.

## Generated or downloaded art
- AI image generators (e.g. Figma `generate_image`) don't give transparent PNGs. Ask for a flat solid pure-magenta (#FF00FF) background and key it out (alpha from `min(R,B) - G`, then despill and a small erode). This works cleanly for trees, characters and window glass.
- If the agent's sandbox can't reach an asset URL, After Effects can download it on the user's machine: `system.callSystem('curl -s -f -L -o "<path>" "<url>"')` (needs "Allow Scripts to Write Files and Access Network").
- For parallax, generate each depth as its own image (sky, far trees, near trees, interior with keyed windows, character), then loop each one with `-((time*speed) % width)` across 2–3 copies.

## Time remap set right after enabling
Setting `timeRemapEnabled = true` and then calling `setValueAtTime` on Time Remapping in the same script can throw "property or a parent property is hidden". Re-fetch the layer, or drive it with an expression (e.g. `linear(time,0,dur,start,0)` to play a precomp in reverse).


## Text reveals and shape paths (documentary graphics)
- Per-character reveal that works: animator with Opacity 0 (+ Blur), selector shape **Square** with Advanced > Smoothness 100, animate **Start** 0 -> 100 (reveal left to right). For an exit animate **End** 0 -> 100 on a second animator. Ramp Up/Down shapes with Offset +-100 leave the text fully visible at both ends, so they don't work as a reveal.
- A new shape layer's anchor is [0,0] at the comp centre: path vertices written in comp pixels land off screen. Set the layer Position to [0,0] first (or write vertices relative to the centre).
- Roughen Edges "Fractal Influence" is 0-1, not 0-100. Read an effect's parameter list once before scripting it (matchNames like `ADBE Roughen Edges-0004` don't tell you the range).
- Undo from a script: `app.executeCommand(16)`. Don't look it up with `findMenuCommandId('Undo')`: in AE 2026 that returns a different command.
- Source Text expressions: `value` is a string in the JavaScript engine (`value.text` is undefined). Slider values need `.value`.
- `comp.exportAsMotionGraphicsTemplate(overwrite, path)` treats `path` as a folder and names the file after `motionGraphicsTemplateName`.
- After `app.executeCommand(...)` the CompItem itself can go stale: keep its id and use `app.project.itemByID(id)`.
- Layers have no `moveTo()`: use moveToBeginning/moveToEnd/moveBefore/moveAfter.

Live builds (ae_build_live)
- After Effects only repaints when a script ends, so one script that makes 30 layers shows them all at once. `ae_build_live` runs each
  step as its own short job with a pause between them: every layer lands in the timeline and the viewer before the next one starts.
  Use it whenever someone is watching or recording, with ONE layer (or one visible change) per step and a short plain label.
- Steps do not share local variables. Step code gets `comp` and `S` (an object that survives between steps); re-find layers by name
  (`comp.layer('Sun')`) or keep values on `S`. `comp` is null until a step creates the comp named in `comp`.
- After each step the comp is opened in the viewer, the layers the step added are selected, and the time indicator moves onto them
  (or to the step's `show_at`). Each step is one Undo group and one line in the bridge panel's Activity feed ("7/38  Skyline tower 1").
- The bridge panel opens on its Live view (chat and activity together), so a window recording catches the prompt and every step.
- `node scripts/live_demo.mjs` is a ready example: a made-up race title card, 38 steps, about 30 seconds.

