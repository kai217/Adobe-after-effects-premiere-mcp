# Changelog

## Unreleased

### Fixed
- `il_to_ae`: sending a second document to After Effects left that document in front in Illustrator, so the next `il_export` / `il_preview` / `il_save` silently ran on the wrong file. The document that was in front before the call is now brought back, and the result reports which one is active.
- `il_export`: a prefix ending in `_` or `-` gave double separators (`Name__01_Board.jpg`), and artboard names ending in punctuation gave a trailing `_`. Both are trimmed.
- `il_export` / `il_preview`: the result now names the document that was exported, so a wrong-document export shows up at once.

- `ae_check`: no longer reports "blur clipped to its content bounds" on shape layers that already carry a transparent padding group (a rect/ellipse with no visible fill or stroke, e.g. the `Blur Bounds` group MK.halo adds). Before, the warning fired whenever the layer bounds were smaller than 1.2x the comp, even when the blur had room.
- `il_add`: rects, ellipses and paths no longer get Illustrator's default 1 pt black stroke when no `stroke` is given; 2-point paths stay open (3+ points close unless `closed: false`); centre/right-justified point text is now centred on / right-aligned to `x` instead of starting at it.
- `il_to_ae`: failed with "Object is invalid": the Illustrator document reference goes stale after `saveAs`, and AE layer objects go stale after each Create Shapes command. It now works on the active document after the save and re-finds AE layers by name.
- `pr_markers`: adding a marker with `duration` threw "Illegal Parameter type" (marker.end takes seconds, not a Time).
- `pr_build_cut`: `audio: false` now removes the linked audio instead of disabling it, so the sequence no longer runs a frame past the picture.

- `pr_build_cut` / `pr_assemble`: clips came out one frame short (0-2 s of 29.97 footage gave 59 frames) and a 30 fps clip in a 29.97 sequence landed a frame early. Premiere floors in/out points to the source frame below, so they are now snapped to the clip's own frame rate and nudged half a source frame. `pr_build_cut` reports each clip's real length.
- `il_to_ae`: live text never converted to shape layers (AE's Create Shapes skips text). The exported copy now has its text outlined (`outline_text`, default on; the original .ai keeps editable type), and `shapeLayersMade` only counts layers that really converted.
- `ae_undo` did nothing: `findMenuCommandId('Undo')` returns an unrelated command id in AE 2026. It now always runs Edit > Undo (command 16).
- `il_preview` / `il_export` left the Illustrator document marked as changed (switching artboards and exporting dirty it), so a following `il_to_ae` refused to run. The saved state is now restored after exporting.
- `ae_layer_props` / `ae_dump` (`only_changed`): X/Y/Z Position no longer show up as changed zeros when dimensions aren't separated.
- `il_to_ae`: with many layers the After Effects comp object went stale between Create Shapes commands ("Object is invalid"); it is now fetched again by id after every command.
- `ae_export_mogrt`: After Effects treats the output path as a folder and names the file after the template, so a folder called `X.mogrt` was created. The template is now exported to a temp folder and moved to the exact path.
- `ae_layer` `move_to` always failed (layers have no `moveTo`): now uses moveToBeginning / moveBefore / moveAfter / moveToEnd.
- `ae_build_master`: overlapping entries were stacked with the first entry on top, hiding titles listed after their background. Later entries now sit above earlier ones.
- `ae_set` with `value` on an animated property now says it set a keyframe at the comp time instead of reporting a plain "value".
- `pr_place`: audio-only files (wav, mp3...) go to an audio track (`audio_track`), and the result reports where the clip landed.
- `pr_captions`: words split by the transcriber ("1" + ".28") are joined again ("1.28").
- `pr_clip`: result now re-reads the clip and notes that Premiere keeps reporting old in/out after start/end edits.
- `pr_save` refuses with a clear message when no project is open (it used to report a save that never happened).
- `media_probe` reports missing files instead of returning empty fields.
- `pr_clip_params`: colors come back as [r, g, b, a].
- `pr_clip_params`: values came back wrapped twice (`{ value: { value: 25 } }`); now plain values.

### Added
- `KAI.clipBounds(item)` (Illustrator): the bounds you actually see of a clipped group. `geometricBounds` / `visibleBounds` of a clipping group include all the hidden artwork, which broke scaling and alignment of masked art. `KAI.itemInfo` reports `clipBounds` for clipped groups.
- `il_guide`: new notes on clipped-group bounds, "illegal text range" when reading text attributes, fitting point text to a width, working with two open documents, and not saving inside long cross-document scripts.
- **Chat inside the apps**: the KAI MCP Bridge panel now has Chat and Activity tabs. Chat runs Claude Code headless (`claude -p`, stream-json) with only this MCP's tools, resumes the same session for follow-ups, streams replies and shows the current step live; Stop and New buttons. Uses the user's Claude Code sign-in; clear messages when Claude Code is missing or not signed in. Files in `<workDir>/chat`.
- **Live activity feed in the KAI MCP Bridge panel** (After Effects, Premiere Pro, Illustrator), modeled on Adobe's in-app AI Assistant: every tool call shows up as a plain-language step with a running / done / error marker, the app, and how long it took. New tools: `kai_say` (short narration between steps), `kai_plan` (plan checklist with done / current step) and `kai_ask` (Proceed / Deny buttons in the panel; the tool waits for the click). Files live in `<workDir>/activity`. Panel is taller by default (340x520) and uses flat SVG icons.
- `pr_open`: open a .prproj (there was no way to open a Premiere project before; dialogs suppressed).
- `install.bat` also registers the server with the **ChatGPT desktop app / Codex** (`~/.codex/config.toml`, 15 min tool timeout for renders) when either is installed.

### Notes from the demo builds (Nov 15 2026)
- A new Premiere effect added through UXP can start with the values last used for that effect, not its defaults: always set the parameters you need.
- Effect point parameters (e.g. Gradient Ramp start/end) on unparented shape layers take comp coordinates; drive them with `toComp(anchorPoint) + offset` so they follow the layer.
- Inside a shape group, an expression on a sibling property must reach it through `content("Group").content(1)`; `thisProperty.propertyGroup()` chains fail there.
- Fill effect Opacity is 0-1, not 0-100. Text tracking is limited to -1000..1000.
- Render ProRes from AE and encode H.264 with ffmpeg (CRF 15) instead of AE's 5 Mbps H.264 template for demo-quality output.



## 2.0.0 — Illustrator + UXP

### Added
- **Illustrator** (host ILST) in the same server and the same CEP bridge, plus a panel-free direct route (Windows COM
  `Illustrator.Application.DoJavaScriptFile`, macOS AppleScript). Tools: il_status, il_guide, il_run_script, il_document,
  il_new_document, il_open, il_save, il_add, il_set, il_export, il_preview, il_trace, il_to_ae. `jsx/il_prelude.jsx` helpers,
  `docs/AI_GOTCHAS.md`. Friendly coordinates everywhere (artboard top-left, y down). Alerts are suppressed during jobs.
- **il_to_ae**: Illustrator layers -> After Effects comp (one layer per Illustrator layer) and optional native shape layers.
- **UXP bridge** (`uxp/kai-mcp-bridge`, manifest v5, Premiere 25.6+): file queue like the CEP bridge, async jobs with `KAI.*`
  helpers (project, seq, clips, transact for one-step undo). Tools: uxp_status, pr_uxp_run, pr_effects_remove (ExtendScript can't
  remove effects), pr_effects_add, pr_effects_list, pr_clip_params (incl. MOGRT text), pr_clip_param_set (values + keyframes).
  Ready for After Effects UXP once it leaves beta. install.mjs packs `dist/kai-mcp-bridge.ccx` and installs it through Creative Cloud.
- Gap-fillers vs. other Adobe MCPs: ae_markers, ae_apply_preset, pr_markers, pr_captions (readable caption blocks built from our
  word-level transcripts, fillers dropped), media_waveform (EBU R128 loudness, true peak, level curve, silences, waveform image).
- kai_doctor reports Illustrator and both UXP hosts. Self-test covers every new tool (ExtendScript parse + UXP async compile).


### Added: round 3 (documentary: stable B-roll, archive media, long takes)
- `scripts/stability.py`: per-second camera shake for every clip (ffmpeg pipe at 12 fps, 320 px gray, phase correlation). jitter = RMS of shift minus a 9-frame smoothed shift (shake), pan = smoothed shift (deliberate move). Pick windows with jitter < 0.5 px and |pan| < 2 px: these are the steady, slow shots worth handing to Warp Stabilizer later. `scripts/stability_sheet.py` makes a contact sheet of each clip's best steady window.
- `scripts/photo_catalog.py` + `scripts/photo_sheet.py`: read a client photo-library catalog (viewer `data.js`: chapters, duplicates, trash), resolve originals on the drive, and make dated contact sheets per chapter (video thumbnails via ffmpeg, original-file fallback when the thumb is missing).
- Archive media as AE comps: every photo or phone video gets its own `ARCH <name>` comp (blurred fill for vertical/4:3 media, slow 6% push, grain) and goes into Premiere by Dynamic Link.
- `jsx/pr/export_frames.jsx`: one PNG per visible clip for the shot-matching loop.
- Dialogue as long continuous takes (`span()`): a take runs from the first word to the last; only pauses longer than 2 s are shortened (to 0.8 s), and every shortened pause is automatically covered by B-roll so it never reads as a jump cut. Head and tail come from the energy edges, clamped so they never reach into the neighbouring word.

### Fixed
- `jsx/pr/grade.jsx` skips AE Dynamic Link comps (`.aep`) and stills: the camera LUT was being applied to archive comps on the B-roll track.
- Score never drops out: the generated score has a continuous low drone/air bed under the whole film.

- `scripts/archive_bbox.py`: finds black borders baked into stills (phone/iPad screenshots). The ARCH comp then masks them off, centres the real picture, and lets wide shots fill the frame instead of boxing them twice.

### Notes
- Premiere DOM: setting `trackItem.inPoint` keeps the clip's timeline length, and `outPoint` then reports a value that doesn't match the duration. To trim a head reliably: QE `razor` at the cut, remove the first piece, then `trackItem.move()` the rest back. Re-check start/end afterwards and nudge with `move()` if the razor landed off-frame.
- One sequence per project carries "FINAL" in its name (the nest with the global look), kept in the sequences bin; older rounds get an "OLD vNN" prefix. `createNewSequenceFromClips` drops the new sequence at the project root, so move it into the bin.
- `device_commit_files` can skip a file whose size did not change (seen with JSON regenerated with the same byte count). Pass `force: true` for regenerated working files and verify by staging back.
- Premiere's DOM cannot remove a clip's effects (`component.remove` does not exist; QE `removeEffects` did nothing). To strip effects, remove the track item and overwrite the project item back in at the same time with the same in/out.

### Added: shot matching + finishing (documentary, round 2)
- Shot matching loop: `scripts/visible_clips.py` (which clip is on screen when, from an edit list), `scripts/frame_stats.py` (luma mean/percentiles, warmth, tint, saturation per exported frame), `scripts/shot_match.py` (per-clip Lumetri corrections toward one target; learns each clip's real slider response from the previous round), `jsx/pr/apply_looks.jsx` (writes the corrections into each clip's correction Lumetri). Two rounds took brightness spread across 96 shots from sd 0.070 to 0.015 and warmth from sd 0.22 to 0.03 (blue-paint shots excluded on purpose).
- Global look the scriptable way: Premiere has no scripted adjustment layer, so the finished edit is nested into a "(FINAL)" sequence and one Lumetri + Noise + Crop (letterbox) sits on the nest clip.
- Music bed ducking with Volume Level keyframes under every dialogue region.

### Fixed
- `pr_import` checks every path exists, is non-empty and readable before importing. A missing file made Premiere open a modal "File Import Failure" dialog that blocked the bridge until someone clicked OK.

### Added: documentary tools (Nov 14 2026)
- `pr_assemble` (`jsx/pr/assemble.jsx`): multi-track timed edit list in one call. Each clip has its own source in/out, timeline time, video track, audio track, scale/position and gain (dB). Interviews on V1/A1, B-roll on V2 with nat sound moved to A3, AE Dynamic Link graphics on V3. Optional Constant Power crossfades on butt edits. `clips_file` takes a JSON path instead of pasting 100+ clips.
- `pr_grade` takes `track` (grade B-roll on V2, not only V1).
- `pr_build_cut` takes `segments_file` (JSON on disk) and clamps negative in-points to 0.
- `scripts/interview_cleanup.py` v3: config-driven (no hard-coded clips), several keep-windows per clip (`wins`) so off-camera questions and setup chat are cut out, every cut "breathes" (word finishes + 0.3 s room tone, 0.1 s lead-in, `tail`/`head` configurable), ranges never cross a window edge or go below 0, stereo WAVs handled.
- `scripts/face_track.py`: optional `n` samples per clip for long takes where the speaker moves.

### Fixed
- `media_contact_sheet`: timestamps were wrong by a factor of `every` (labels said 4 s steps when tiles were 2 s apart). The sheet is now sized to the real tile count (no empty black rows), returns `tiles`/`truncated`, and for sparse sheets (every >= 4 s) seeks each tile instead of decoding the whole file, so a 70 GB interview take no longer times out.
- `pr_assemble`: Premiere's `audioTrack.overwriteClip` also drops the linked video on the matching video track, and the linked-audio cleanup could delete an unrelated clip that started at the same time. Both handled (only the item's own linked media is removed; graphics are placed first).

### Added: editing tools (Nov 14 2026)
- `pr_build_cut`: build a whole sequence from a list of source in/out ranges in one call (selects reels, interview cleanups, assemblies).
- `pr_grade`: per-clip Lumetri with a .cube loaded as Input LUT plus Basic/Creative look sliders, for a whole sequence in one call. First scripted LUT loading that works (LUTAsset + Input LUT = 1).
- `media_transcribe`: word-level faster-whisper transcript that keeps filler words, run as a background job; picks the GPU with the most free memory, falls back to CPU (`scripts/transcribe.py`).
- `media_contact_sheet`: timestamped contact sheet straight from a video file. `media_probe`: facts for many files at once.
- `host_run` / `host_job`: background shell jobs with logs (turn off with `"allowHostExec": false` in config.json).
- `scripts/interview_cleanup.py`: transcript -> keep-ranges with fillers, stutters (repeated words/bigrams/trigrams) and marked restarts removed; boundaries walk to the nearest silence so word tails aren't clipped; optional QA spans from a re-transcription pass. Output feeds `pr_build_cut`.

- `scripts/face_track.py`: per-clip face position (OpenCV) for centered, head-safe interview framing.
- PR_GOTCHAS: interview framing rules (one base shot, close-up only on story beats), cut audio with 0.3 s tail + crossfades, two-Lumetri LUT-then-grade setup.

### Fixed
- `pr_grade` put the LUT and the correction in one Lumetri; the correct order is a LUT-only Lumetri first, then the correction now it adds two Lumetris per clip.
- `pr_save` no longer triggers Premiere's modal "Project Modified ... continue?" prompt (it blocked the bridge until someone clicked OK): it saves with `saveAs` to the project's own path, and versions use native path separators.
- `pr_build_cut` left 1-frame gaps (black flashes) every few cuts because positions were summed from rounded durations. It now chains each clip from the previous clip's real end.


### Added: Premiere Pro + shared bridge
- **KAI MCP Bridge** (`cep/`): one CEP extension for After Effects and Premiere Pro. Starts with the app (headless), runs queued jobs one at a time, and writes a heartbeat every second. The server now reports **busy** / **not responding** (render, modal dialog, freeze) and fails fast instead of waiting out the timeout. Fixes the case where a heavy AE render froze AE and every call hung for minutes.
- Stays idle inside the windowless After Effects that Premiere starts for Dynamic Link, so it never runs jobs against the wrong AE.
- Premiere tools: `pr_status`, `pr_guide`, `pr_run_script`, `pr_project`, `pr_sequence`, `pr_import`, `pr_import_ae_comps` (Dynamic Link), `pr_new_sequence`, `pr_place`, `pr_clip`, `pr_preview`, `pr_save`, `pr_export`. Helpers in `jsx/pr_prelude.jsx`, lessons in `docs/PR_GOTCHAS.md`.
- `ae_export_mogrt`: export a comp as a Motion Graphics Template with chosen properties exposed in Essential Graphics.
- `kai_doctor`: install and live-connection diagnostics for both apps.
- Project guard: `expected_project` on edit tools refuses to run if a different project is open.
- `ae_render` format `prores_alpha` (ProRes with transparency).
- `install.bat` / `scripts/install.mjs` install the bridge panel and set PlayerDebugMode.

### Fixed
- `pr_preview`: QE `exportFramePNG` throws "Unknown error exception" on Windows when the path uses forward slashes. Paths are now native (backslashes). Found in the first live Premiere test.
- Bridge: a job left in the queue from an old session (e.g. after a crash) was picked up and run when the panel first connected. Jobs older than 15 minutes are now set aside as `.stale` and never run.
- `install.bat` copied its own folder over the installed one even when the source was older, which rolled the server back to an old version. It now skips the copy when run from the install folder and never overwrites newer files (`robocopy /XO`).
- The self-test now uses a temp work folder instead of the real one.
- `ae_set` and `ae_build_master` were dropped by Claude again: `z.array(z.array(z.any()))` emits array items with no type, which the API rejects ("items must be object,boolean"). Inner items are now typed unions (number / string / boolean / number array).
- `ae_render` failed with "Directory does not exist" when the output folder was new (the folder-creation fix only took effect after a server restart; documented).

### Fixed
- `jsx/prelude.jsx`: `KAI.layerInfo` used `in` as a bare object key, which ExtendScript (ES3) rejects with "Illegal use of reserved word". Every tool call failed because of it. The key is now quoted (`'in'`).
- Scripts sent through `ae_run_script` and the other tools are now auto-fixed before they run. Reserved words used as object keys (`{in: 1}`) or dot properties (`o.in`) are quoted (`lib/ae.js` → `fixReservedWords`).
- `ae_preview` / `ae_compare`: AE's `saveFrameToPng` writes asynchronously, so ffmpeg sometimes read half-written PNGs ("Invalid PNG signature", "chunk too big"). The server now waits until each PNG is complete before reading it (`lib/media.js` → `waitForPngs`).
- Script errors no longer pop up in After Effects. Code is compiled with `eval` inside the job's try/catch, so syntax errors come back to the caller as a normal error (with line and type) instead of a modal "Unable to execute script" dialog. Runtime AE dialogs are suppressed during jobs (`app.beginSuppressDialogs`).
- `ae_set` and `ae_build_master` never loaded in Claude: their input schemas used `z.tuple`, which produces array-form `items` that the Anthropic API rejects. They now use plain arrays (`[[time, value], ...]`, `[[frame, comment], ...]`), and all 18 tools load. Self-test passes.

### Setup notes
- Newer Claude desktop builds read `%APPDATA%\Claude\claude_desktop_config.json` (Settings → Desktop app → Extensions → Local MCP servers → Edit config). If the server doesn't show up there after install, add the `kai-after-effects` entry by hand.
- Turn off "Warn User When Executing Files" in AE's Scripting & Expressions preferences, otherwise every call blocks on a confirm dialog.

### Added
- `ae_dump`: reads everything in a comp tree or the whole project to a JSON file: every comp and layer (type, switches, timing, parent, track matte, masks with modes, effects, text), every changed or animated property with full keyframe values, mask/shape vertices and expressions.

- `ae_check`: read-only health check for a comp tree (expression errors, disabled expressions, missing footage/fonts, clipped shape-layer blurs, Glow color shift, broken track mattes). Run it after every build step.
- `ae_guide` + `docs/AE_GOTCHAS.md`: every scripting gotcha found while testing, plus the motion-kit helper list. `ae_status` tells agents to read it once per session.
- `jsx/motionkit.jsx` (MK.*) is now loaded into every job automatically: shape boxes/ellipses/paths with safe accessors, text, eased keyframes, halo glow, comp placement. No `$.evalFile` or machine-specific paths needed.
- `.gitignore` keeps local project data (`assets/`, `config.json`, `library/`) out of the repo.

### Fixed (30s stress test)
- Layer types are now detected by `matchName`. `instanceof TextLayer/ShapeLayer` returned wrong types inside eval'd scripts, so text and shape layers were mislabeled.
- `ae_render` creates the output folder, checks the final Render Queue status, throws on failure (and removes the failed item), and checks that the file exists.
- `ae_preview` contact sheets fill empty cells with dark gray, not black, so they don't look like black frames.

- `KAI.walk` paths were ambiguous when sibling properties share a matchName (e.g. 40 `ADBE Vector Group`s in one shape layer): `KAI.prop` always resolved the first one, so an edit meant for bar 10 hit bar 1. Duplicate siblings now get an index (`ADBE Vector Group[10]`) and `KAI.prop` understands it.

### Notes (motion test)
- In AE's ExtendScript, `'text' + someArray` throws "invalid numeric result (divide by zero?)". Use `someArray.join(',')` when building expression strings (added to AE_GOTCHAS).
- `layer.copyToComp` fails inside an Undo Group for layers with parents or linked expressions, and doesn't always put the copy at index 1. Find the copy by layer id, and run those scripts without `undo_name`.
- After moving layers out of a precomp, expressions that use `time` need `(time - thisLayer.startTime)`.
- A blur on a shape layer is cut off at the layer's content bounds, which shows as a faint hard-edged square. `MK.halo` now adds a 5000px transparent "Blur Bounds" rect so the blur can spread.
- The Glow effect shifts saturated green toward cyan/white. Use a blurred duplicate (`MK.halo`) to keep the color.
- Shape property references go invalid when sibling properties are added. `motionkit.jsx` re-resolves every accessor by name.

### Known issues (found in the 30s stress test)
- AE's UI may stop responding to clicks after a run of scripted jobs (seen once, cause not confirmed). Possibly dialog suppression or a stuck render error; `app.endSuppressDialogs(false)` was called to clear it.
- `ae_build_master` maps source frames linearly, so it can't rebuild layers that use time remapping. The 30s build used `layer.copyToComp` through `ae_run_script` instead, which keeps time remap, effects and keyframes.
