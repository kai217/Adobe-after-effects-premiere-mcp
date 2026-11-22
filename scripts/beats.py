"""Beat grid of a music file with numpy only (no librosa): tempo, beat times, strongest hits, loudness per second.
usage: python beats.py <ffmpeg> <audio> [--offset S] [--duration S] [--cuts 1.2,3.4,...]
--offset: seconds into the song that play at video time 0 (beats are reported in VIDEO time when given).
--cuts: video cut times; reports how far each one is from the nearest beat.
Prints JSON."""
import sys, json, argparse, subprocess
import numpy as np

SR, HOP, N = 22050, 512, 2048

def load(ff, path, start, dur):
    cmd = [ff, "-v", "error", "-ss", str(max(0.0, start)), "-i", path] + (["-t", str(dur)] if dur else []) + ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

def onset_env(y):
    n = 1 + max(0, (len(y) - N) // HOP)
    win = np.hanning(N).astype(np.float32)
    frames = np.lib.stride_tricks.as_strided(y, shape=(n, N), strides=(y.strides[0] * HOP, y.strides[0]))
    mag = np.log1p(10 * np.abs(np.fft.rfft(frames * win, axis=1)))
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux -= np.convolve(flux, np.ones(16) / 16, mode="same")  # remove slow trend
    flux = np.maximum(flux, 0)
    return flux / (flux.std() + 1e-9)

def tempo(env, lo=85, hi=180):
    fps = SR / HOP
    ac = np.correlate(env, env, mode="full")[len(env) - 1:]
    ac = ac / (ac[0] + 1e-9)
    idx = np.arange(len(ac))
    def comb(L, K=8):  # strength of a beat period: autocorrelation at 1x..Kx the period
        return sum(np.interp(k * L, idx, ac) for k in range(1, K + 1)) / K
    cands = np.linspace(60 * fps / hi, 60 * fps / lo, 3000)
    sc = np.array([comb(L) for L in cands])
    L = cands[int(np.argmax(sc))]
    return 60 * fps / L, L

def track(env, period, tight=100.0):
    # Ellis 2007 dynamic-programming beat tracker
    n = len(env); score = env.copy(); back = -np.ones(n, dtype=int)
    p = int(round(period)); window = np.arange(-2 * p, -p // 2 + 1)
    txcost = -tight * np.log(-window / period) ** 2
    for i in range(n):
        lo = i + window; m = lo >= 0
        if not m.any(): continue
        cand = score[lo[m]] + txcost[m]; k = int(np.argmax(cand))
        score[i] = env[i] + cand[k]; back[i] = lo[m][k]
    # last beat: best score in the final period
    i = int(np.argmax(score[-p:])) + n - p; beats = []
    while i >= 0: beats.append(i); i = back[i]
    return np.array(beats[::-1])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("ffmpeg"); ap.add_argument("audio")
    ap.add_argument("--offset", type=float, default=0.0); ap.add_argument("--duration", type=float, default=0.0); ap.add_argument("--cuts", default="")
    a = ap.parse_args()
    y = load(a.ffmpeg, a.audio, a.offset, a.duration)
    env = onset_env(y); bpm, period = tempo(env); b = track(env, period)
    t = (b * HOP + N / 2) / SR  # frame centre; seconds from offset (= video time when offset given)
    strength = env[b]
    hits = sorted(zip(strength.tolist(), t.tolist()), reverse=True)[:12]
    sec = int(len(y) / SR); rms = [round(float(20 * np.log10(np.sqrt(np.mean(y[i * SR:(i + 1) * SR] ** 2)) + 1e-9)), 1) for i in range(sec)]
    out = {"bpm": round(float(bpm), 2), "beat_period": round(60 / float(bpm), 4), "offset": a.offset,
           "time_base": "video (offset applied)" if a.offset else "song", "beats": [round(float(x), 3) for x in t],
           "strongest_hits": [round(h[1], 3) for h in sorted(hits, key=lambda h: h[1])], "rms_db_per_second": rms}
    if a.cuts:
        cuts = [float(c) for c in a.cuts.split(",") if c.strip()]
        out["cuts"] = [{"cut": c, "nearest_beat": round(float(t[np.argmin(np.abs(t - c))]), 3), "off_by": round(float(t[np.argmin(np.abs(t - c))] - c), 3),
                        "off_frames_30fps": round(float((t[np.argmin(np.abs(t - c))] - c) * 30), 1)} for c in cuts]
    print(json.dumps(out))

if __name__ == "__main__":
    main()
