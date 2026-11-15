import json, os, subprocess, sys
"""Face position per timeline clip, for interview framing.
usage: python face_track.py clips.json faces.json
clips.json: {"<sequence>": [{"i": clipIndex, "path": media, "in": srcSec, "out": srcSec}, ...]} (dump it with pr_run_script)
needs opencv-python-headless 4.x (5.x dropped CascadeClassifier) and ffmpeg on PATH.
Output per clip: faces [[cx, cy, h, top], ...] normalized to the source frame, sampled at 10/50/90% of the clip
(or n evenly spaced points when the clip entry has "n").
Windows: if cv2 lives in a side folder, set PYTHONPATH to it."""
import shutil
import cv2, numpy as np
FF = shutil.which("ffmpeg") or "ffmpeg"
clips = json.load(open(sys.argv[1], encoding="utf-8"))
casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
w, h = 960, 540
def grab(path, t):
    r = subprocess.run([FF, "-v", "error", "-ss", f"{t:.3f}", "-i", path, "-map", "0:v:0", "-frames:v", "1", "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True)
    if len(r.stdout) < w * h: return None
    return np.frombuffer(r.stdout[:w * h], np.uint8).reshape(h, w)
out = {}
for seq, L in clips.items():
    res = []
    for c in L:
        d = c["out"] - c["in"]; samples = []
        n = int(c.get("n", 3))  # long takes where the speaker moves: ask for more samples (e.g. one every 3 s)
        fr = [(k + 0.5) / n for k in range(n)] if n != 3 else [0.1, 0.5, 0.9]
        for f in fr if d > 1.5 else (0.5,):
            g = grab(c["path"], c["in"] + d * f)
            if g is None: continue
            fs = casc.detectMultiScale(g, 1.1, 6, minSize=(60, 60))
            if len(fs):
                x, y, ww, hh = max(fs, key=lambda r: r[2] * r[3])
                samples.append([(x + ww / 2) / w, (y + hh / 2) / h, hh / h, y / h])
        res.append({"i": c["i"], "faces": samples})
        print(seq[:20], c["i"], len(samples), flush=True)
    out[seq] = res
json.dump(out, open(sys.argv[2], "w"), indent=0)
print("FACES DONE")
