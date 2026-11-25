# Editing workflows (how a job runs from start to finish)

This is the process behind every edit made with this MCP, written so a person can follow it and a model can repeat it.
Each section is one kind of job. `kai_workflow` returns one section at a time (`name`: start, broll, interview, motion,
illustrator, reformat, revision, check, deliver, failures, small-models). The *_GOTCHAS guides (ae_guide, pr_guide, il_guide) hold the
low-level scripting rules; this file is the order of work.

## start
Every job, before touching anything.
1. Read the brief and every file that came with the job: the brief, notes, and EVERY tab of a shoot schedule or
   spreadsheet. The shoot schedule tells you what was shot, where, by whom, and in what order. Don't ask the user what
   their own files already say.
2. Check the apps: `ae_status` / `pr_status` / `il_status`. If one is not connected, run `kai_doctor` and report what it
   says. If a call says "busy" after an app was closed or a render was stopped, `kai_reset`.
3. Read the guide for each app you will touch, once per session: `ae_guide`, `pr_guide`, `il_guide`.
4. Show the plan: `kai_plan` with every step, then update it (`done`, `current`) as you go. Give the user a time
   estimate at the start and a short update at each stage of a long job (what's done, what's next, how long).
5. Protect the originals: save a version first (`ae_save` / `pr_save` / `il_save` mode "version"). Never edit the
   client's original sequence or a shared/master comp: clone the sequence (`pr_new_sequence` clone_of) or duplicate the
   comp and edit the copy.
6. The loop for every edit: status -> guide -> inspect (ae_project, ae_comp, ae_dump, ae_layer_props; pr_project,
   pr_sequence, pr_clip_params; media_probe) -> plan -> wait for the user's go -> small edit -> check -> save a version.
   Pass `expected_project` (and `undo_name` in AE) on every editing script. If a call times out, the work usually still
   finishes in the app: check the result (`return app.project.numItems;` or the output file) before running it again.
7. Ask before anything that is hard to undo or could go either way (deleting, overwriting a client file, a long render):
   `kai_ask`, or ask in chat. Don't render or export unless asked.

## broll
B-roll edits: lab tours, facility loops, brand B-roll packages, selects reels. The goal is a cut that reads like a
walk through the space, not a pile of random clips.
1. Inventory the media. `media_probe` on every folder (length, fps, codec, timecode). Note which cameras shot what:
   a second shooter's camera (another format, e.g. BRAW from a tripod camera) is easy to forget and often holds the wides.
   If a back-end tool can't read a format, import it into Premiere (`pr_import`) and look at it there.
2. See every clip. `media_contact_sheet` per clip (or `pr_preview` on a reference timeline with every clip end to end).
   Write one line per clip: location/station, person, task, shot size (wide / medium / close), and whether it moves.
3. Find the smooth parts. Scan every clip for shake (`host_run` with `scripts/stability.py`, see `scripts/stability_sheet.py`
   for a visual). Use only steady ranges; skip ranges where the camera is still settling, refocusing (autofocus hunt), or
   sits still before it starts moving.
4. Decide the order before cutting:
   - Follow the space: entrance/hallway first, then into the room, then one station at a time in the order you would
     walk past them. The order the crew shot in is usually that order (the shoot schedule says it).
   - Each person appears ONCE: put all their shots back to back and show their whole task (start, middle, result).
     Never cut away to someone else and come back to them later.
   - Pattern: wide (sets up the station) -> close-ups of the task -> next wide. Tripod wides from a second camera are
     ideal establishing shots.
   - Archive / older footage from the same place stays together in its own block, in its own order.
   - Long, slow shots over many short ones. Usually 5-10 s per shot; let a good continuous take run.
   - Watch for anything that can't be in the cut: crew or the editor in the background, a camera flash firing (reads as a
     1-frame glitch on a loop), people in colours that pull the eye at the frame edge.
5. Build it. Write the edit as data first (clip, in, out, label per shot), then build in one call:
   `pr_build_cut` (one track, end to end) or `pr_assemble` (several tracks, timed). Rebuild with `replace: true` rather
   than patching many clips.
6. Colour. `pr_grade` with the camera LUT and a look: first Lumetri = LUT only, second = the correction. Match shots from
   other cameras to the main camera (`scripts/frame_stats.py` + `scripts/shot_match.py`). If the LUT can't be applied
   by script in this Premiere version, tell the user the one manual step (Interpret Footage > Input LUT).
7. Check (see `check`): a frame from every clip, nobody returns, no gaps, the order reads as a walk.
8. When the user trims or deletes clips in the timeline themselves, "clean it up" means: close every gap (slide later
   clips left, same order), keep any transitions they had (re-add an intro dissolve if its clip was deleted), and report
   the new length per sequence. Don't swap in replacements unless asked; offer them.
9. Export review copies only when asked: 1080p unless told otherwise, size about 150-500 MB.

## interview
Interview + B-roll edits (documentary, testimonial).
1. Transcribe: `media_transcribe` (keeps um/uh; runs as a job, poll `host_job`).
2. Clean up: `scripts/interview_cleanup.py` turns the word transcript into keep-ranges with fillers, stutters and restarts
   removed. Cut on the end of the voice energy, not the word edge, with ~0.3 s of room tone, 4-frame Constant Power
   crossfades on every audio edit. Re-transcribe the cut and remove leftover fillers (two passes).
3. Story first: pick bites by story beat, write the edit list (bite ranges, B-roll cover per bite, graphics times),
   then `pr_assemble`: interview V1/A1, B-roll V2 (no B-roll audio unless asked; nat sound A3 at about -20 dB), music A4.
4. Framing: one base framing for the whole interview, one close-up used only on emotional beats and held for the beat.
   Measure the face (`scripts/face_track.py`), don't guess.
5. Long takes: cut only on pauses over ~2 s and cover the join with B-roll.
6. Titles and stats go over B-roll, not over the person talking.
7. Colour as in `broll`; two lighting setups may need two looks on the same LUT.

## motion
After Effects graphics: titles, cards, openers, end cards, logo builds.
1. One comp per shot or element, so every piece can be replaced or retimed later. Pre-comp sections; the master only
   arranges them.
2. Build with `ae_build_live`: one layer or one visible change per step, with a short label. In step code:
   - use `comp` (given to you) and `S` (survives between steps); there is no `app.project.activeComp`;
   - re-find layers by name: `comp.layer('Title')`; local variables don't survive to the next step;
   - transform properties live under the Transform group:
     `L.property('ADBE Transform Group').property('ADBE Opacity')` (also ADBE Position, ADBE Scale, ADBE Rotate Z,
     ADBE Anchor Point), or `L.transform.opacity`. `L.property('Opacity')` is undefined.
   - text colour: get `L.property('ADBE Text Properties').property('ADBE Text Document')`, change `.value`
     (fillColor, fontSize, font), then `setValue` it back.
   - ES3 only: `var`, no let/const/arrow functions/template strings; write `>` and `<`, never `&gt;`.
3. Change one property on an existing layer with `ae_set` (`layer` and `path` are required; path like
   "ADBE Transform Group/ADBE Opacity", keyframes [[0,0],[1,100]], ease true). Read a layer first with `ae_layer_props`.
4. After each step: `ae_check` on the comp, and `ae_preview` frames at full resolution where things change.
   A step that reports ok but added nothing or changed nothing is not done: check it.
5. Look: bright, saturated, cinematic but happy; soft glows with a blurred duplicate (MK.halo), not the Glow effect.
6. Backgrounds: the comp's background colour (`bgColor`) is NOT part of the picture; it renders transparent. Always add a
   solid layer (`comp.layers.addSolid(...)`), optionally with a Gradient Ramp. (`comp.backgroundColor` does not exist.)
7. What makes it look designed, not "text on a box":
   - several elements, each with its own entrance, staggered 0.2-0.5 s apart (shape pops, a stroke drawing on, text
     revealing per letter, lines growing, a tagline last);
   - eased keys with overshoot (`MK.keys` eases every key; scale 0 -> 112 -> 100);
   - motion blur on moving layers (`comp.motionBlur = true`, `layer.motionBlur = true`);
   - depth: gradient background, soft halo under the hero shape (`MK.halo`), one accent colour family;
   - clear layout: hero shape above, title below it, never white text over a bright shape.
   MK helpers in every step: MK.shape(comp, name, pos), MK.ellipse(L, name, d, col), MK.box(L, name, w, h, r, col),
   MK.path, MK.stroke(handle, col, w), MK.text(comp, str, size, col, pos, font, just, tracking), MK.centerAnchor(L),
   MK.tr(L, 'pos'|'scale'|'rot'|'op'|'anchor'), MK.keys(prop, [[t, v], ...]), MK.halo(L, blur, opacity).
   Text animators: the default selector shape is already Square with Smoothness 100; setting Range Shape by script
   throws "hidden", so don't.

### Recipe: animated title card (tested; copy and change the words, colours and timing)
`ae_build_live` with comp "Title Card" and these steps:
1. Comp and gradient background:
   `var c = app.project.items.addComp('Title Card', 1920, 1080, 1, 6, 30); c.motionBlur = true; var bg = c.layers.addSolid([0.05, 0.06, 0.12], 'Background', 1920, 1080, 1, 6); bg.property('ADBE Effect Parade').addProperty('ADBE Ramp'); var r = bg.property('ADBE Effect Parade').property(1); r.property('ADBE Ramp-0001').setValue([960, 0]); r.property('ADBE Ramp-0002').setValue([0.16, 0.10, 0.34]); r.property('ADBE Ramp-0003').setValue([960, 1080]); r.property('ADBE Ramp-0004').setValue([0.02, 0.02, 0.07]);`
2. Sun disc pops in:
   `var L = MK.shape(comp, 'Sun', [960, 400]); MK.ellipse(L, 'Disc', 280, [1, 0.5, 0.15]); L.motionBlur = true; MK.keys(MK.tr(L, 'scale'), [[0, [0, 0]], [0.6, [112, 112]], [0.9, [100, 100]]]); MK.keys(MK.tr(L, 'op'), [[0, 0], [0.3, 100]]); MK.halo(L, 80, 70);`
3. Gold ring draws on:
   `var L = MK.shape(comp, 'Ring', [960, 400]); var H = MK.ellipse(L, 'Ring', 400, null); MK.stroke(H, [1, 0.84, 0.4], 8); L.property('ADBE Root Vectors Group').addProperty('ADBE Vector Filter - Trim'); var t = L.property('ADBE Root Vectors Group').property('ADBE Vector Filter - Trim').property('ADBE Vector Trim End'); MK.keys(t, [[0.3, 0], [1.4, 100]]); MK.keys(MK.tr(L, 'rot'), [[0.3, -120], [1.4, 0]]); L.motionBlur = true;`
4. Title reveals letter by letter:
   `var L = MK.text(comp, 'SAND DUNE MEDIA', 120, [1, 1, 1], [960, 690], null, null, 150); L.name = 'Title'; L.motionBlur = true; MK.centerAnchor(L); var anims = function () { return comp.layer('Title').property('ADBE Text Properties').property('ADBE Text Animators'); }; anims().addProperty('ADBE Text Animator'); var ap = function () { return anims().property(1).property('ADBE Text Animator Properties'); }; ap().addProperty('ADBE Text Opacity'); ap().addProperty('ADBE Text Position 3D'); ap().property('ADBE Text Opacity').setValue(0); ap().property('ADBE Text Position 3D').setValue([0, 80, 0]); anims().property(1).property('ADBE Text Selectors').addProperty('ADBE Text Selector'); MK.keys(anims().property(1).property('ADBE Text Selectors').property(1).property('ADBE Text Percent Start'), [[1.0, 0], [2.2, 100]]);`
5. Gold lines grow out:
   `var L = MK.shape(comp, 'Lines', [960, 760]); MK.box(L, 'Line', 640, 4, 2, [1, 0.84, 0.4]); MK.keys(MK.tr(L, 'scale'), [[1.8, [0, 100]], [2.5, [100, 100]]]);`
6. Tagline rises in:
   `var L = MK.text(comp, 'CINEMATIC STORIES', 38, [1, 0.8, 0.45], [960, 810], null, null, 500); L.name = 'Tagline'; L.motionBlur = true; MK.keys(MK.tr(L, 'op'), [[2.2, 0], [2.8, 100]]); MK.keys(MK.tr(L, 'pos'), [[2.2, [960, 830]], [2.8, [960, 810]]]);`
Check: `ae_preview` {"comp": "Title Card", "times": [0.4, 1.2, 1.8, 2.4, 4]}: frames must differ (pop, ring drawing,
letters arriving, tagline). Identical frames mean the animation didn't take.

## illustrator
Design in Illustrator, animate in After Effects, cut in Premiere (all three apps on one job).
1. `il_new_document`, then build with `il_build_live` or `il_add`: every part that will move gets its own top-level layer
   with a clear name (circle, sun, road, title, tagline).
2. `il_save`, then `il_to_ae`: each layer becomes an AE layer (shape layers when possible; text is outlined in the copy).
3. Animate in AE as in `motion` (circle draws on, elements rise or slide in one after another), plus a matching end card.
   `ae_save`.
4. Premiere: `pr_import_ae_comps` (Dynamic Link, never rendered files, so AE changes update), cut the footage
   (`pr_build_cut` / `pr_assemble`), animation first, end card last.
5. Check frames, then export only if asked (`pr_export`).

## reformat
Horizontal to vertical (or the reverse).
1. Premiere: clone the sequence, change the frame size on the clone, then reframe each clip (Scale, normalized Position)
   on the subject. Check every clip's frame.
2. After Effects: duplicate the comps, change the size, rebuild layouts so they use the new frame (taller cards, fewer
   columns) instead of shrinking the old layout onto a new background. Keep every approved element's shape (no cut-off
   or reshaped boxes).
3. Make a concept frame or preview for approval before rebuilding a whole project.

## revision
Client revision rounds after the first build.
1. Turn the notes into a numbered fix list with timecodes (`kai_plan`).
2. Small fixes inside an existing timeline: work in the app (swap, trim, regrade). Big restructures (new order, new
   selects, stabilizing): build on the back end from the source files (ffmpeg via `host_run`) and make the AE/Premiere
   project by script at the end, so everything stays reproducible.
3. Never carry problems into the next round: compare against the last approved cut, frame by frame where it changed.
4. Hand back a review page (HTML: timecoded note, fix, done check) plus the same data as JSON next to it.
5. Save a record of the job for training: request, files/context, plan, tool calls (with a short result each), checks
   (e.g. PSNR min dB and frame count) and lessons, next to the HTML/JSON review files. No client media or personal
   info in anything public.
6. Keep the export folder simple: one folder with only the current round's files, older rounds in an "Old rounds" folder.

## check
Before saying anything is done.
- Look at a frame from EVERY clip or shot (`pr_preview` / `ae_preview`), and every frame of anything short that loops.
  Compare against the approved reference cut when there is one.
- Timeline: no gaps (black), no duplicates, nobody comes back after their section, transitions still there, no
  zero-length or one-frame remnants left by overwrite edits.
- Picture: no crew or editor in frame, no flash frames, no autofocus hunts, heads not cut off after reframing or crops.
- AE: `ae_check` clean (no expression errors, missing footage or fonts, clipped blurs).
- Report what changed, the new lengths, and anything you could not do, plainly.

QC recipes (ffmpeg through `host_run`; stage only small results such as tiles, JSON or downscaled frames):
- Contact-sheet sweep: `media_contact_sheet` every 0.4-0.5 s across the whole piece (use `from` + `every`, leave `to`
  out), then zoom into anything odd at full resolution.
- Frame-diff: per clip, extract every frame small (`scale=96:-1`), take the mean absolute difference between neighbouring
  frames, and flag spikes inside a clip (a cut that shouldn't be there) and at the first/last frames (flash frames).
  Tile the flagged frames and look at them.
- Compare with the approved version (PSNR):
  `ffmpeg -i approved.mp4 -i new.mov -lavfi "[0:v]format=yuv420p,settb=1001/24000[a];[1:v]format=yuv420p,settb=1001/24000[b];[a][b]psnr=stats_file=psnr.log" -f null NUL`
  Where nothing was meant to change every frame should be over ~40 dB; under ~35 dB is a real difference. Use `settb`
  when the time bases differ or the comparison hangs.
- Where is on-screen text (for SRTs/transcripts): render the master and a textless version, downscale both to gray
  (`scale=108:192,format=gray -f rawvideo`) and diff per frame: frames with a cluster of changed pixels carry text.
- Audio: `volumedetect` per channel (`pan=mono|c0=c0,volumedetect`) to prove what each channel holds; render everything
  except music and check it is silent to prove there is no VO/SFX.
- Lip sync after re-cutting audio: each video clip's source start = timeline time + that segment's audio offset.

## deliver
Renders and deliverables. Only when asked; some large AE projects must not be rendered on the edit machine at all.
- AE output templates (AE 2027, Windows): "High Quality" is ProRes 422 Standard (not HQ), "High Quality with Alpha" is
  ProRes 4444, "Lossless" is uncompressed AVI (~25 MB per 4K frame). For ProRes 422 HQ: render Lossless, then
  `-c:v prores_ks -profile:v 3 -vendor apl0 -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a pcm_s24le`
- Audio: `om.setSettings({'Output Audio':'On'})` works; 24-bit is rejected there, so convert in ffmpeg.
- Render from a script: add the item, `applyTemplate`, set `om.file`, set every other queued item's `render=false`,
  `renderQueue.render()`, check `status == RQItemStatus.DONE`, remove the queue item. A long render times out the tool
  call but keeps going: watch the output file size.
- Textless / submaster: keep a list of every text layer ([compId, layerIndex]), confirm each is really a text layer,
  disable them, render, re-enable them. Diff master vs textless: only text may change (logos and icons stay).
- Stems: in the main comp switch off every audio layer except one group, render AIFF 48 kHz, repeat for dialogue /
  music / SFX, restore.
- H.264 review/delivery MP4 (HD): two-pass `-c:v libx264 -preset slow -profile:v high -level:v 4.2 -b:v 19M -maxrate 25M -bufsize 3M -c:a aac -b:a 256k -movflags +faststart`.
  Measure the real average and peak bitrate and report them honestly.
- When the edit machine can't render: write a .jsx the user runs (File > Scripts > Run Script File) that finds the comp
  by name, queues master / textless / stems into a folder next to the project, restores every toggled layer in a
  `finally`, doesn't save, and shows a summary. Pick templates by name with fallbacks and tell the user to confirm HQ.
- Organize: one folder per deliverable set; old files go to an `_old_<date>` folder, never deleted.

## failures
| Symptom | Cause | Fix |
|---|---|---|
| Every call says "busy" | a render or job was stopped in the app | `kai_reset` |
| Bridge not connected after a relaunch | AE opened in Safe Mode after a force-quit | relaunch normally, decline Safe Mode, `kai_doctor`; never force-quit AE |
| Tool call timed out | the script is still running in the app | check the result or output files; don't run it again blindly |
| `host_job` shows only the end of the log | output too long | write it to a file and read the file |
| "Tool ... not found" | wrong tool name | use a name from `small-models`; don't invent one |
| "Invalid input at X" | argument X missing or wrong type | add/fix that one argument |
| Contact sheet error "-to smaller than -ss" | `to` given | leave `to` out, use `from` + `every` |
| PSNR hangs or warns about time base | different time bases | `settb=1001/24000` on both inputs |
| Transcript job finished but no file | the MCP restarted mid-job | run `media_transcribe` again |

## small-models
Rules for local or small models (Gemma, Qwen and others) driving this MCP through a client that only offers a generic
"call MCP tool" command.
- Use only tool names that exist. The core set: ae_status, ae_guide, ae_project, ae_comp, ae_layer_props(layer*),
  ae_set(layer*, path*), ae_layer(layer*), ae_build_live(steps*), ae_run_script(code*), ae_preview, ae_check, ae_save;
  pr_status, pr_project, pr_sequence, pr_import(paths*), pr_build_cut(name*), pr_assemble(name*), pr_grade(sequence*),
  pr_clip(track*, clip*), pr_preview(times*), pr_save, pr_export(output*, preset*); il_status, il_new_document(width*,
  height*), il_add(kind*), il_build_live(steps*), il_to_ae, il_export(format*); media_probe(paths*),
  media_contact_sheet(path*), media_transcribe(path*), host_run(command*), host_job; kai_plan, kai_say, kai_workflow.
  (* = required.) If unsure, call `kai_workflow` with the job type, or `ae_guide` / `pr_guide` / `il_guide`.
- Arguments are a JSON object with exactly the names above. A "not found" error means the tool name is wrong; an
  "invalid input at X" error means argument X is missing or the wrong type. Fix that one thing; don't invent new names.
- Never say done because a call returned ok: confirm with ae_layer_props / ae_preview / pr_sequence that the change
  is really there.
