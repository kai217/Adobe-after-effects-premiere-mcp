# adobe-after-effects-premiere-mcp
**Adobe After Effects + Premiere Pro MCP server for Claude** (plus Illustrator). Control After Effects and Premiere Pro with AI: build edits, comps, captions, color and motion graphics from plain-English requests.

Lets Claude work inside your running **After Effects, Premiere Pro and Illustrator** in the background (no screen takeover).
One server, three apps, two bridges: ExtendScript through the CEP bridge (every app) and modern **UXP** for Premiere Pro.

Install: double-click `install.bat`, then fully restart the Claude desktop app, After Effects and Premiere Pro.
In After Effects turn on Edit > Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network".

`install.bat` registers the MCP server with Claude and installs the **KAI MCP Bridge** panel into both apps
(it links `cep/` into Adobe's CEP extensions folder and sets PlayerDebugMode so the unsigned panel can load).
The bridge starts by itself when an app opens; Window > Extensions (Legacy) > KAI MCP Bridge shows its status.

## How it talks to the apps
Two bridges, same file-queue design (any number of Claude sessions can share them; no ports):
- **CEP bridge** (`cep/`, ExtendScript): After Effects, Premiere Pro, Illustrator. Full access to everything the classic scripting DOMs can do.
- **UXP bridge** (`uxp/kai-mcp-bridge`, modern async JS): Premiere Pro 25.6+. Adds what ExtendScript can't: remove/add effects by
  matchName, read and set every component parameter incl. MOGRT/Essential Graphics text, keyframes, and one-step undo for whole edits.
  The same plugin will run in After Effects as soon as AE's UXP leaves beta (AE 27). Illustrator doesn't open UXP to third parties yet.
- **Direct routes** (no panel at all): After Effects via `AfterFX.exe -r`, Illustrator via Windows COM / macOS AppleScript.

- The server writes job files (ExtendScript) into a queue folder; the bridge runs them one at a time.
- The bridge writes a heartbeat every second, so Claude knows if an app is **connected**, **busy** with a job (and for how long),
  or **not responding** (rendering, a modal dialog, frozen). Tools fail fast with that reason instead of hanging.
- After Effects also works without the panel ("direct" mode: `AfterFX.exe -r`). Premiere needs the panel.
- The bridge stays off inside the windowless After Effects that Premiere launches for Dynamic Link.
- Queue and heartbeat files live in `%USERPROFILE%\KAI-AE-MCP-work` (only your user account can write there).

## Tools
After Effects: ae_status, ae_guide, ae_check, ae_run_script, ae_project, ae_comp, ae_layer_props, ae_dump, ae_set, ae_layer,
ae_preview, ae_compare, ae_import, ae_replace_footage, ae_save (versions), ae_open, ae_undo, ae_render, ae_build_master,
ae_library, ae_effects, ae_export_mogrt.

Premiere Pro: pr_status, pr_guide, pr_run_script, pr_project, pr_sequence, pr_import, pr_import_ae_comps (Dynamic Link),
pr_new_sequence (clone or from clips), pr_place, pr_clip, pr_preview (still frames, no render), pr_save (versions), pr_export,
pr_build_cut (sequence from in/out ranges), pr_assemble (multi-track timed edit list: interviews, B-roll, nat sound, graphics), pr_grade (LUT + look on every clip of any video track).

Illustrator: il_status, il_guide, il_run_script, il_document, il_new_document, il_open, il_save (versions), il_add (rect/ellipse/line/path/
text/image/svg), il_set, il_export (png/jpg/svg/pdf per artboard), il_preview, il_trace (Image Trace to vectors), il_to_ae (Illustrator
layers -> AE comp, optionally native shape layers).

Premiere UXP: uxp_status, pr_uxp_run, pr_effects_remove, pr_effects_add, pr_effects_list, pr_clip_params, pr_clip_param_set.

Markers, presets, captions, audio: ae_markers, ae_apply_preset (.ffx), pr_markers, pr_captions (caption track from our transcripts or an
.srt), media_waveform (LUFS, true peak, level curve, silences, waveform image).

Media: media_probe, media_contact_sheet (timestamped), media_transcribe (word-level, keeps fillers), host_run / host_job (background jobs).

All: kai_doctor (diagnoses install, PlayerDebugMode, CEP + UXP bridge state for every app).

Edit tools accept `expected_project`: the job refuses to run unless the open project path matches, so a script can never land in the wrong file.

Every action is logged to `%USERPROFILE%\KAI-AE-MCP-work\logs\*.jsonl` (training data). Each AE edit is one named Undo step ("AI: ...").

## Agent workflow
1. `ae_status` / `pr_status`: confirm the app is reachable and see the open project. If not, `kai_doctor`.
2. `ae_guide` / `pr_guide`: read the known gotchas once per session.
3. On real projects, save a version first, duplicate the comp / clone the sequence, and edit the copy. Pass `expected_project`.
4. Check visually: `ae_preview` at resolution 1 or `pr_preview`, then `ae_check`.
5. Never render or export unless the user asks.

## When you find a bug
Fix it in the code, add a line to `CHANGELOG.md`, and add the lesson to `docs/AE_GOTCHAS.md` or `docs/PR_GOTCHAS.md` so the next agent doesn't hit it. Run `node scripts/selftest.mjs` before committing.
