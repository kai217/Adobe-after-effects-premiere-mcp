"""Color stats for exported frames. usage: python frame_stats.py folder out.json
Per frame: luma mean/p05/p50/p95 (Rec.709, 0-1), midtone warmth (R-B)/Y and tint (G-(R+B)/2)/Y, saturation."""
import sys, os, json, glob
import numpy as np, cv2
res = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.png'))):
    im = cv2.imread(f, cv2.IMREAD_COLOR)
    if im is None: continue
    h, w = im.shape[:2]; im = cv2.resize(im, (480, int(480 * h / w)), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    b, g, r = im[..., 0], im[..., 1], im[..., 2]
    Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    m = (Y > 0.15) & (Y < 0.85)
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b); sat = (mx - mn) / (mx + 1e-4)
    res[os.path.basename(f)] = dict(mean=float(Y.mean()), p05=float(np.percentile(Y, 5)), p50=float(np.percentile(Y, 50)), p95=float(np.percentile(Y, 95)),
        warm=float(((r - b)[m]).mean() / (Y[m].mean() + 1e-4)) if m.any() else 0.0, tint=float(((g - (r + b) / 2)[m]).mean() / (Y[m].mean() + 1e-4)) if m.any() else 0.0,
        sat=float(sat[m].mean()) if m.any() else 0.0)
json.dump(res, open(sys.argv[2], 'w'), indent=0)
print(len(res))
