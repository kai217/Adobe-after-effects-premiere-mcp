import json, re, sys, os
"""Interview cleanup v2 (KAI-AE-MCP): word-level transcript -> keep-ranges with fillers, stutters and restarts removed,
every cut breathing (word finishes, ~0.3 s room tone after, ~0.1 s lead-in before).
usage: python interview_cleanup.py config.json out.json
config: {"tail": 0.3, "head": 0.1, "extra": "optional qa spans json",
  "clips": {"<stem>": {"name": "...", "transcript": "x.json", "wav": "x_16k_mono.wav",
     "wins": [[s, e], ...]            # source windows to keep (or "win": [s, e]); off-camera questions/setup chat go between windows
     "drop_spans": [[s, e]], "drop_phrases": ["exact words"], "force": [[s, e]]}}}
transcript: media_transcribe output ({"segments":[{"words":[[s,e,word,p]]}]}) or a list of {"w": [[s,e,word,p]]}.
Feed each clip's ranges to pr_build_cut. Re-transcribe the cut audio and pass leftover fillers back as "extra" spans."""
FILL = {"um", "uh", "umm", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm"}
norm = lambda w: re.sub(r"[^a-z0-9']", "", w.lower())

CFG = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {"clips": {}}
PLAN = CFG["clips"]

import wave, array, math
WAV = all(p.get("wav") for p in PLAN.values()) or None
EXTRA = json.load(open(CFG["extra"])) if CFG.get("extra") else {}
_rms = {}
def rms_of(stem):
    if stem not in _rms:
        w = wave.open(PLAN[stem]["wav"]); n = w.getnframes(); sr = w.getframerate(); ch = w.getnchannels()
        a = array.array("h", w.readframes(n))
        if ch > 1: a = array.array("h", a[::ch])
        hop = sr // 100
        _rms[stem] = [math.sqrt(sum(x * x for x in a[i:i + 2 * hop]) / (2 * hop)) for i in range(0, len(a) - 2 * hop, hop)]
    return _rms[stem]
def snap_e(stem, t, kind):
    if not WAV: return t
    r = rms_of(stem); lo, hi = (t - 0.04, t + 0.06) if kind == "end" else (t - 0.06, t + 0.04)
    cand = [i for i in range(max(0, int(lo * 100)), min(len(r), int(hi * 100) + 1))]
    if not cand: return t
    i = min(cand, key=lambda k: r[k]); return i / 100 + 0.01

USE_SILENCE_WALK = False
def to_silence(stem, t, direction, cap):
    if not USE_SILENCE_WALK: return None
    """walk from t until 3 quiet 10ms frames in a row (relative to local speech level); returns boundary time"""
    if not WAV: return t
    r = rms_of(stem); i0 = int(t * 100); step = 1 if direction > 0 else -1
    peak = max(r[max(0, i0 - 30):i0 + 30] or [1]); thr = max(200, 0.08 * peak); quiet = 0
    for k in range(int(cap * 100)):
        i = i0 + step * k
        if i < 0 or i >= len(r): break
        quiet = quiet + 1 if r[i] < thr else 0
        if quiet >= 3: return (i - step * 2) / 100 + (0.0 if step > 0 else 0.01)
    return None

TAIL = CFG.get("tail", 0.30)   # silence kept after the last word before every cut
HEAD = CFG.get("head", 0.10)   # lead-in kept before the first word after a cut
def _quiet(r, i, thr): return 0 <= i < len(r) and r[i] < thr
def breathe(stem, rng):
    """Every cut: let the word finish (energy), then hold TAIL s of room tone, without running into the next (removed) sound."""
    if not WAV: return rng
    r = rms_of(stem); out = []
    for k, (a, b) in enumerate(rng):
        i0 = int(b * 100)
        peak = max(r[max(0, i0 - 60):i0 + 10] or [1]); thr = max(140, min(0.05 * peak, 350))
        # 1) real end of speech: from a bit before the cut, walk forward to 3 quiet frames (cap 0.6 s)
        i = int((b - 0.15) * 100); end_speech = None; q = 0
        while i < i0 + 60 and i < len(r):
            q = q + 1 if r[i] < thr else 0
            if q >= 3: end_speech = (i - 2) / 100; break
            i += 1
        if end_speech is not None and end_speech > b + 0.15:
            end_speech = None  # voice keeps going well past the cut = a filler glued to the word: don't pull it back in
        if end_speech is None:  # voice runs straight into the next sound: cut at the quietest point near b
            cand = range(max(0, int((b - 0.04) * 100)), min(len(r), int((b + 0.06) * 100)))
            end_speech = min(cand, key=lambda j: r[j]) / 100 if cand else b
            nb = end_speech + 0.02
        else:
            # 2) hold room tone for TAIL s, but stop before any new sound (a removed um/restart) starts
            j = int(end_speech * 100) + 1; lim = int((end_speech + TAIL) * 100)
            while j < lim and _quiet(r, j, thr): j += 1
            nb = j / 100 - (0.03 if j < lim else 0)
        nb = max(nb, b if end_speech >= b else nb)
        # 3) start: walk back from the first word to where its sound begins, keep HEAD s lead-in, stop at earlier sound
        a0 = int((a + 0.10) * 100); i = a0; q = 0; start_speech = a
        while i > a0 - 60 and i > 0:
            q = q + 1 if r[i] < thr else 0
            if q >= 3: start_speech = (i + 3) / 100; break
            i -= 1
        if start_speech < a - 0.15: start_speech = a  # glued to a removed sound before it
        j = int(start_speech * 100) - 1; lim = int((start_speech - HEAD) * 100)
        while j > lim and _quiet(r, j, thr): j -= 1
        na = (j + 1) / 100 + (0.03 if j > lim else 0)
        na = min(na, a)
        out.append([round(na, 3), round(nb, 3)])
    # never overlap/duplicate source: if ranges now touch, join them (continuous speech)
    res = []
    for a, b in out:
        if res and a <= res[-1][1] + 0.04: res[-1][1] = max(res[-1][1], b)
        else: res.append([a, b])
    return res

def words_of(stem):
    d = json.load(open(PLAN[stem]["transcript"]))
    segs = d["segments"] if isinstance(d, dict) else d
    out = []
    for s in segs:
        for w in s.get("words", s.get("w", [])):
            out.append(dict(s=w[0], e=w[1], t=w[2].strip(), n=norm(w[2])))
    # de-dupe zero-length / overlapping duplicates at segment joins
    clean = []
    for w in out:
        if clean and w["s"] < clean[-1]["e"] - 0.05 and w["n"] == clean[-1]["n"]:
            continue
        if w["e"] - w["s"] <= 0.001 and clean and abs(w["s"] - clean[-1]["e"]) < 0.01 and w["n"] == clean[-1]["n"]:
            continue
        clean.append(w)
    return clean

def plan_cut(stem, p):
    wins = p.get("wins") or [p["win"]]
    W = [w for w in words_of(stem) if any(a <= w["s"] <= b for a, b in wins)]
    for i in range(1, len(W)):  # a window boundary always forces a cut (and nothing between windows can leak in)
        if not any(a <= W[i - 1]["s"] <= b and a <= W[i]["s"] <= b for a, b in wins):
            W[i]["newwin"] = True
    keep = [True] * len(W); why = [""] * len(W)
    for i, w in enumerate(W):
        if w["n"] in FILL or w["n"] == "": keep[i] = False; why[i] = "filler"
        for a, b in p.get("drop_spans", []):
            if a <= w["s"] <= b: keep[i] = False; why[i] = "restart"
    # phrases (match on non-filler normalized words, with fillers allowed inside)
    seq = [w["n"] for w in W]
    for ph in p.get("drop_phrases", []):
        toks = [norm(t) for t in ph.split()]
        for i in range(len(seq)):
            if seq[i:i + len(toks)] == toks:
                for k in range(i, i + len(toks)): keep[k] = False; why[k] = "restart"
                break
    # repeated words / bigrams / trigrams among kept words (stutters)
    for n in (3, 2, 1):
        idx = [i for i in range(len(W)) if keep[i]]
        for j in range(len(idx) - 2 * n + 1):
            a = [W[idx[j + k]]["n"] for k in range(n)]; b = [W[idx[j + n + k]]["n"] for k in range(n)]
            if a == b and all(keep[idx[j + k]] for k in range(n)) and W[idx[j + n]]["s"] - W[idx[j + n - 1]]["e"] < 1.2:
                if n == 1 and a[0] in ("had", "very", "really", "so", "ha", "no", "okay"):  # legit doubles
                    continue
                for k in range(n): keep[idx[j + k]] = False; why[idx[j + k]] = "stutter"
    # build ranges
    ranges = []; cur = None; prev_kept = None
    for i, w in enumerate(W):
        if not keep[i]: continue
        removed_before = prev_kept is not None and (prev_kept != i - 1 or w.get("newwin"))
        long_pause = prev_kept is not None and w["s"] - W[prev_kept]["e"] > 0.9
        if cur is None or removed_before or long_pause:
            if cur is not None:
                lim = (W[prev_kept + 1]["s"] if prev_kept + 1 < i else W[prev_kept]["e"] + 0.35) if removed_before else W[prev_kept]["e"] + 0.25
                cur[1] = min(W[prev_kept]["e"] + 0.10, lim) if removed_before else lim
                if removed_before and prev_kept + 1 < i:
                    nr = W[prev_kept + 1]
                    q = to_silence(stem, W[prev_kept]["e"] - 0.05, +1, min(0.65, nr["e"] - W[prev_kept]["e"] + 0.05))
                    if q is not None and q <= nr["e"]: cur[1] = max(cur[1], q + 0.03)
                ranges.append(cur)
            lo = W[i - 1]["e"] if (i > 0 and not keep[i - 1] and not w.get("newwin")) else w["s"] - 0.20
            start = max(w["s"] - 0.08, lo) if removed_before else max(w["s"] - 0.15, lo)
            if removed_before and not w.get("newwin"):
                pr_ = W[i - 1]
                q = to_silence(stem, w["s"] + 0.05, -1, min(0.4, w["s"] - pr_["s"] + 0.05))
                if q is not None and q >= pr_["s"]: start = min(start, q - 0.02)
            cur = [start, None]
        prev_kept = i
    cur[1] = W[prev_kept]["e"] + 0.35; ranges.append(cur)
    # merge tiny gaps, drop tiny ranges
    merged = []
    for a, b in ranges:
        if merged and a - merged[-1][1] < 0.06: merged[-1][1] = b
        else: merged.append([a, b])
    # hard exclusions found by QA (source seconds), shrunk so they never eat a real word from the first transcript
    real = [w for w in W if w["n"] and w["n"] not in FILL]
    safe = []
    for xa, xb in EXTRA.get(stem, []):
        for w in real:
            ws, we = w["s"], w["e"]
            if we - ws > 0.75:  # very stretched word: Whisper folded the filler into it; protect its core
                if (ws + we) / 2 < (xa + xb) / 2: we = ws + 0.55
                else: ws = we - 0.55
            ov = min(xb, we) - max(xa, ws)
            if ov > 0.03:
                if (ws + we) / 2 < (xa + xb) / 2: xa = max(xa, we)
                else: xb = min(xb, ws)
        if xb - xa >= 0.10: safe.append([xa, xb])
    for xa, xb in safe:
        nm = []
        for a, b in merged:
            if xb <= a or xa >= b: nm.append([a, b]); continue
            if xa > a: nm.append([a, xa])
            if xb < b: nm.append([xb, b])
        merged = nm
    for fa, fb in p.get("force", []):  # spans that must play untouched
        keep_r = [[a, b] for a, b in merged if b < fa or a > fb]
        touch = [[a, b] for a, b in merged if not (b < fa or a > fb)]
        lo = min([fa] + [a for a, b in touch]); hi = max([fb] + [b for a, b in touch])
        merged = sorted(keep_r + [[lo, hi]])
    merged = [[snap_e(stem, a, "start"), snap_e(stem, b, "end")] for a, b in merged]
    merged = [[round(a, 3), round(b, 3)] for a, b in merged if b - a >= 0.25]
    merged = breathe(stem, merged)
    # never start before 0 and never breathe across a window edge (off-camera question / setup chat lives there)
    clip = []
    for a, b in merged:
        m = (a + b) / 2; wa, wb = next(((x, y) for x, y in wins if x <= m <= y), (0, 1e9))
        a, b = max(0.0, wa, a), min(wb, b)
        if b - a >= 0.25: clip.append([round(a, 3), round(b, 3)])
    merged = clip
    removed = [(round(W[i]["s"], 2), W[i]["t"], why[i]) for i in range(len(W)) if not keep[i]]
    kept_text = " ".join(W[i]["t"] for i in range(len(W)) if keep[i])
    return merged, removed, kept_text

if __name__ == "__main__":
    allp = {}
    for stem, p in PLAN.items():
        r, rem, txt = plan_cut(stem, p)
        dur = sum(b - a for a, b in r)
        allp[stem] = dict(name=p["name"], ranges=r, removed=rem, text=txt, duration=round(dur, 2), source_windows=p.get("wins") or [p["win"]])
        print(f"{stem} {p['name']}: {len(r)} ranges, {dur:.1f}s (from {sum(b-a for a,b in (p.get('wins') or [p['win']])):.1f}s), removed {len(rem)} words")
    json.dump(allp, open(sys.argv[2] if len(sys.argv) > 2 else "cuts.json", "w"), indent=1)
