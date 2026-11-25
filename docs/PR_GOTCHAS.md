# Premiere Pro scripting gotchas (read before editing)

## Transport
- Premiere has no command-line script runner. Every pr_* job goes through the **KAI MCP Bridge** CEP panel, which starts by itself with Premiere (headless) once `install.bat` has run. If pr_status says "not connected", run `kai_doctor`.
- The bridge reports **busy** (a job is running) and **not responding** (Premiere is rendering, showing a modal dialog, or hung). Tools fail fast in those states instead of waiting for the timeout. Don't retry in a loop: tell the user what Premiere is doing.
- Premiere's ExtendScript has **no undo groups**. Before any edit to a real project, save a version (`pr_save` mode "version") so you have a checkpoint, and pass `expected_project` so a script can never land in the wrong project.

## Project rules
- Never edit the client's original sequence. Clone it (`pr_new_sequence` with `clone_of`) and edit the copy.
- Use After Effects comps as **Dynamic Link** clips (`pr_import_ae_comps`), never rendered files, so AE changes update in Premiere. The .aep must be saved first.
- Do not render or export unless the user explicitly asks (`pr_export`).

## Time
- Premiere time is in **ticks**: 254016000000 per second. `Time` objects have `.seconds` and `.ticks` (a string). Use `KAI.sec(x)` to get seconds and `KAI.time(seconds)` to build a Time.
- `seq.timebase` is ticks per frame (a string). `KAI.tc(seq, seconds)` gives the timecode string QE calls expect and snaps to the frame.
- Clip `start`/`end` are timeline times; `inPoint`/`outPoint` are source times.

## Tracks and clips
- In the DOM, tracks and clips are **0-based** (`seq.videoTracks[0]` is V1). The pr_* tools use **1-based** track numbers and 0-based clip indexes (as pr_sequence shows them).
- `track.clips` is a live collection: after inserting or removing, indexes shift. Re-read with pr_sequence before the next edit.
- `overwriteClip` / `insertClip` place video and its linked audio (audio lands on the matching audio track). `insertClip` ripples everything after it on every track.
- `clip.remove(ripple, alignToVideo)`.
- Nested sequences are project items where `item.isSequence()` is true; their media path is empty.
- An AE Dynamic Link clip's `getMediaPath()` is the .aep path (pr_project / pr_sequence mark them `aeComp: true`).

## Motion / effects
- `clip.components` lists Opacity, Motion and effects. Motion's **Position is normalized** (0 to 1 of the frame), not pixels. Scale is a percentage.
- Keyframes: `prop.setTimeVarying(true)`, `prop.addKey(seconds)`, `prop.setValueAtKey(seconds, value, true)`.
- Auto Reframe, Lumetri looks and most effect UIs are not scriptable. Say so instead of faking them.

## QE DOM (undocumented, use carefully)
- `app.enableQE()` then `qe.project.getActiveSequence()`. QE only sees the **active** sequence; set `app.project.activeSequence` first and restore it after.
- `qeSeq.exportFramePNG(timecode, pathWithoutExtension)`: Premiere appends ".png" itself and writes the file asynchronously (pr_preview handles this). On Windows the path must use **backslashes**: a forward-slash path throws "Unknown error exception".

## Sequence settings / reformatting
- `seq.getSettings()` / `seq.setSettings(s)`: `videoFrameWidth`, `videoFrameHeight`, `videoFrameRate`, `videoPixelAspectRatio`. To make a vertical cut: clone the sequence, change the frame size on the clone, then adjust each clip's Motion (Scale / normalized Position).

## Export
- `seq.exportAsMediaDirect(out, preset.epr, app.encoder.ENCODE_ENTIRE)` blocks Premiere until done. `app.encoder.encodeSequence(...)` queues it in Media Encoder instead.

## Dynamic Link items
- AE comps imported with importAEComps are named `CompName/Project.aep` in the bin. Refer to them by nodeId (returned by pr_import_ae_comps) or that full name.

## Color (Lumetri) — found on a real interview edit, Nov 2026
- Add Lumetri with QE: `qeTrack.getItemAt(i).addVideoEffect(qe.project.getVideoEffectByName('Lumetri Color'))`. QE track items include **empty gaps**, so match the QE item to the DOM clip by start time (`item.start.secs`), not by index.
- **Loading a .cube as Input LUT works from script**: set the property named `LUTAsset` to the .cube path (string), **and** set both properties named `Input LUT` to `1`. `Input LUT` alone is just an index into Premiere's menu; `LUTAsset` alone does nothing. `pr_grade` does this.
- Slider properties are found by displayName; some names repeat (`Saturation` = Basic, then Creative, then HSL; `Temperature`/`Tint` = Basic first, HSL later). Pick by occurrence.
- Sliders: Basic Saturation is 100 = unchanged. Exposure is in stops. Everything else 0 = unchanged.
- A per-clip Lumetri (LUT + look) keeps every clip individually tweakable, and a whole-sequence look change is one `pr_grade` call.

## Building cuts
- Range edits: `item.setInPoint(sec, 4)` / `item.setOutPoint(sec, 4)` (4 = all media types), then `track.overwriteClip(item, seconds)`, then `clearInPoint(4)/clearOutPoint(4)`. `pr_build_cut` wraps this.
- `app.project.createNewSequenceFromClips(name, [item], bin)` is the reliable way to get matching sequence settings; remove the clip it places, then lay your ranges.
- `app.newProject(path)` creates and opens a new project from script.

## Running heavy media jobs (ffmpeg, Whisper)
- Use `host_run` / `media_transcribe` (server side). Before those existed, the workaround was writing a .bat from `pr_run_script` and calling `File(bat).execute()`; avoid it now.
- Whisper silently drops "um/uh" unless the prompt contains them: `media_transcribe` passes an `initial_prompt` full of fillers.
- faster-whisper on Windows needs `cublas64_12.dll`. If CUDA 13 is installed system-wide it is missing: `pip install --user nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*` (the script adds those DLL folders itself). When the GPU is often full (local LLM server), so the script picks the GPU with the most free memory and uses int8_float16.
- ffmpeg 8+ removed `-filter_complex_script`; use `-/filter_complex <file>` for long filter graphs (e.g. concatenating 100+ interview ranges).
- Whisper word timestamps are about ±0.1 s. Cutting a filler exactly at Whisper's word edges leaves a sliver of "uh" about half the time. Snap each cut to the quietest 10 ms within ~0.1 s of the boundary, then re-transcribe the cut audio and remove whatever fillers are still heard (two passes catches nearly all).

## Saving
- `app.project.save()` can pop a modal **"Project Modified – the project file has been modified since last save. Do you wish to continue?"** It showed up repeatedly after scripted `saveAs` versions on an exFAT drive whose path mixed `/` and `\`. While it's open the bridge is blocked. `pr_save` now saves with `saveAs(<own path, native separators>)`, which never shows the prompt. Don't call `app.project.save()` inside `pr_run_script`; call `pr_save` instead.

## Interview framing rules
- One **base** framing for the whole interview: chest/waist-up, face centered horizontally, eyes near the upper third, a little headroom. On 4K-in-4K that was about **123%** for a seated subject. Kai picks the base; match it.
- One **close-up** (about chest-up, ~190%), used **only on emotional / story beats** and held for the whole beat. Never alternate medium/close on every cut, and never punch in mid-sentence.
- Measure, don't guess: run `scripts/face_track.py` on the timeline clips, take the median face position, re-center only clips where the subject actually moved, then check that the head top stays inside the frame for every clip. Pull a frame from the middle of every clip (`pr_preview`) before saying it's done.
- Motion Position math: `pos = target - (face - 0.5) * scale`, clamped to `[1 - scale/2, scale/2]` so the edges stay covered.

## Interview audio cuts
- Never cut on the transcript's word end. Find where the voice energy actually stops, then keep about **0.3 s** of room tone before the cut. Put a 4-frame Constant Power audio crossfade on every edit (QE: `audioItem.addTransition(qe.project.getAudioTransitionByName("Constant Power"), false, "00;00;00;04", "00;00;00;00", 0.5, false, true)`).
- Removing fillers that are glued to a word with no pause will clip the word. Keep the full word and live with the "uh".

## Color with a camera LUT
- Two Lumetris per clip: the first holds **only** the conversion LUT (Input LUT) with every slider at default, the second holds the correction. Never put the correction in the same Lumetri as the conversion LUT. (An adjustment layer carrying the LUT above graded clips also works.)
- Default look: bright, warm, saturated but not rainbow, cinematic contrast, shadows not crushed.


## Building a documentary timeline (documentary project, Nov 2026)
- Lay it out as data first (bites with source ranges, B-roll cover per bite, graphics times), then build in one `pr_assemble` call. Re-running with `replace: true` is cheaper and safer than patching dozens of clips.
- Pull doc bites from the **cleaned** interview ranges (fillers/stutters already out, 0.3 s tails), not from raw transcript times.
- `videoTrack.overwriteClip` puts linked audio on the matching audio track; `audioTrack.overwriteClip` puts linked video on the matching video track. Remove only the clip whose `projectItem.nodeId` is the item you placed, or you will delete a neighbour that starts on the same frame.
- Place graphics (AE comps) before nat sound: their (possibly empty) linked audio is an overwrite edit too.
- Audio: Constant Power crossfades on butt edits, and a 6-frame fade at every edge that meets a gap, so a cut into silence never clicks. Nat sound under B-roll at about -20 dB, 10-frame crossfades.
- Volume Level from script is stored as `10^((dB-15)/20)` (0 dB = 0.1778).
- Stats/titles over an on-camera interview collide with the subject; put them over B-roll instead.
- Two light setups in one film (sunny family day vs overcast day) need two looks on the same LUT: the overcast footage needed much more contrast and deeper blacks (contrast 75, blacks -55, highlights -40) to match.


## Matching shots and a global look (documentary project)
- Indoor and outdoor B-roll through the same LUT and grade end up far apart (indoor blue, overcast flat). Measure instead of eyeballing: export one frame per on-screen clip (QE `exportFramePNG`), run `scripts/frame_stats.py`, correct exposure / blacks / temperature / saturation per clip with `scripts/shot_match.py`, apply with `jsx/pr/apply_looks.jsx`, measure again. Two rounds is enough.
- Don't chase tint: the green in a forest is content, not a cast. Leave shots whose subject is a colour (blue paint) out of the warmth match, or they turn orange.
- Lumetri responds very differently per clip (a dark piano shot needs ~2x the exposure move of a bright exterior), so the second round must use the measured response, not a fixed gain.
- No scripted adjustment layers (`qe.project` has newBlackVideo/newColorMatte/newTransparentVideo, not adjustment layers). Nest the edit and put the global look on the nest clip.
- Letterbox (Crop on the nest) eats headroom: re-check every close-up after adding it. 2.39:1 cut the top of the subject's head on 150% close-ups; 2:1 with 140% close-ups works.
- Volume Level keyframes: `prop.setTimeVarying(true)`, `addKey(t)`, `setValueAtKey(t, 10^((dB-15)/20), true)`; times are clip time.
- `pr_import` of a file that isn't there yet (still copying) opens a modal error dialog. `pr_import` now refuses instead.

## Round 3 lessons (documentary project)
- Never rely on a "replace" rebuild when a FINAL nest points at the sequence: deleting the sequence breaks the nest. Delete and recreate the FINAL nest too (createNewSequenceFromClips + QE addVideoEffect for Crop/Noise/Lumetri, then set values by property index).
- Clip effects cannot be removed by script. Remove the track item and overwrite it back in.
- Shot-matching keys are `track_idx` by time order: if the cover list changes, rerun the matching rounds; if only dialogue edges change and the clip count/order is identical, the last round's looks can be reapplied as is.
- Long interview takes: cut only on pauses longer than about 2 s, keep 0.8 s of that pause, and cover the join with B-roll.
- B-roll: measure shake before picking (stability.py). Phone media and photos go in through AE comps, never through the camera LUT.
- Trimming a clip head by script: razor + remove + move, not `inPoint` (see CHANGELOG).
- Archive stills that are screenshots have black bars and phone UI (home bar) baked in: crop them in the comp (archive_bbox.py), never box them twice.
- Naming: exactly one "FINAL" sequence, in the sequences bin; older rounds prefixed "OLD vNN".
- `projectItem.setInPoint/setOutPoint(seconds, 4)` floor to the source frame below and use the SOURCE frame rate: snap to the clip's own fps and add half a source frame, or every clip loses its last frame. `trackItem.inPoint` of 30 fps footage in a 29.97 sequence reports a converted value; trust `projectItem.getInPoint()`.
- UXP effects added with `VideoFilterFactory.createComponent` may inherit the last-used values for that effect. Set every parameter you rely on.
- After changing a clip's `end`/`start`, Premiere keeps reporting the old `inPoint`/`outPoint`; trust start/end and check frames.
- `app.openDocument(path, true, true, true, true)` opens a project without conversion / locate-media / warning dialogs.

## Overwrite edits (found on a real interview rebuild, Nov 2026)
- `overwriteClip` drops the clip's Lumetri grade and Motion settings: re-apply both after every overwrite.
- Overwriting a clip that has linked audio (an AE comp, a B-roll file) punches its audio into A1/A2: afterwards remove
  every A1/A2 clip that isn't the VO or music and re-lay those.
- Overwrites can leave zero-length or one-frame remnants: scan for them and remove them; extend an end with `clip.end`.
- Setting `trackItem.start` does not shift the in point; `trackItem.inPoint/outPoint` can be set directly, and
  `trackItem.move(Time)` moves a clip.
