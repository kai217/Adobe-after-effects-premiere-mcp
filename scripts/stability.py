"""Per-second camera stability for B-roll picking.
usage: python stability.py clips.txt out.json   (clips.txt: one media path per line)
Decodes each clip at 12 fps, 320 px wide, gray (ffmpeg pipe); global shift between frames by phase correlation.
Per second: jitter = RMS of (shift - smoothed shift) in px@320 (handheld shake), pan = mean |smoothed shift| (intended motion speed)."""
import sys, os, json, subprocess, shutil
import numpy as np, cv2
FF = shutil.which('ffmpeg') or 'ffmpeg'; FPS = 12; W = 320
out = json.load(open(sys.argv[2])) if os.path.exists(sys.argv[2]) else {}
for path in [l.strip() for l in open(sys.argv[1]) if l.strip()]:
    key = os.path.basename(path)
    if key in out: continue
    p = subprocess.Popen([FF, '-v', 'error', '-i', path, '-map', '0:v:0', '-vf', f'fps={FPS},scale={W}:-2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], stdout=subprocess.PIPE)
    H = None; prev = None; shifts = []
    # read first frame to learn height
    buf = b''
    while True:
        if H is None:
            # try common 16:9 heights
            H = 180
        chunk = p.stdout.read(W * H)
        if len(chunk) < W * H: break
        f = np.frombuffer(chunk, np.uint8).reshape(H, W).astype(np.float32)
        if prev is not None:
            (dx, dy), resp = cv2.phaseCorrelate(prev, f)
            shifts.append((dx, dy, resp))
        prev = f
    p.wait()
    if not shifts: out[key] = {'n': 0}; continue
    s = np.array(shifts); xy = s[:, :2]
    k = 9; ker = np.ones(k) / k
    sm = np.stack([np.convolve(xy[:, i], ker, mode='same') for i in range(2)], 1)
    jit = np.linalg.norm(xy - sm, axis=1); pan = np.linalg.norm(sm, axis=1)
    sec = []
    for i in range(0, len(jit), FPS):
        sec.append([round(float(np.sqrt((jit[i:i+FPS] ** 2).mean())), 3), round(float(pan[i:i+FPS].mean()), 3), round(float(s[i:i+FPS, 2].mean()), 3)])
    out[key] = {'n': len(jit) + 1, 'sec': sec}
    json.dump(out, open(sys.argv[2], 'w'))
    print(key, len(sec), 'jit med %.3f' % float(np.median([x[0] for x in sec])), flush=True)
print('STAB DONE')
