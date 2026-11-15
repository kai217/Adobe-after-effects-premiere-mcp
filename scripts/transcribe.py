"""Word-level transcription for editing (faster-whisper). Keeps filler words.
usage: python transcribe.py <media> <out.json> [--model large-v3] [--device auto|cuda|cpu] [--language en]
Writes {segments:[{s,e,text,words:[[start,end,word,prob,isFiller]]}], fillers:[...], keep:[[s,e],...]}
"""
import os, sys, json, glob, site, argparse, subprocess, shutil

FILLERS = {"um", "uh", "uhm", "umm", "erm", "er", "ah", "hmm", "mm", "mhm"}
SOFT = {"like", "so", "yeah", "you know", "i mean", "kind of", "sort of", "basically", "actually"}

def add_dll_dirs():
    if os.name != "nt":
        return
    cands = []
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        cands += glob.glob(os.path.join(sp, "nvidia", "*", "bin")) + glob.glob(os.path.join(sp, "torch", "lib"))
    cands += glob.glob(r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12*\bin")
    for d in cands:
        try:
            os.add_dll_directory(d); os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]
        except Exception:
            pass

def gpu_by_free_mem():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=index,memory.free", "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
        rows = [tuple(int(x) for x in l.split(",")) for l in out.strip().splitlines()]
        return sorted(rows, key=lambda r: -r[1])
    except Exception:
        return []

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("media"); ap.add_argument("out")
    ap.add_argument("--model", default="large-v3"); ap.add_argument("--device", default="auto"); ap.add_argument("--language", default="en")
    a = ap.parse_args()
    os.environ.setdefault("CUDA_DEVICE_ORDER", "PCI_BUS_ID")
    add_dll_dirs()
    from faster_whisper import WhisperModel
    wav = a.out + ".16k.wav"
    ff = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run([ff, "-v", "error", "-y", "-i", a.media, "-map", "0:a:0", "-ac", "1", "-ar", "16000", wav], check=True)
    model, used = None, None
    if a.device in ("auto", "cuda"):
        for idx, free in gpu_by_free_mem():
            if free < 2500:
                continue
            try:
                m = WhisperModel(a.model, device="cuda", device_index=idx, compute_type="int8_float16")
                list(m.transcribe(wav, language=a.language, vad_filter=True, clip_timestamps=[0, 3])[0])  # forces cuBLAS load
                model, used = m, f"cuda:{idx}"; break
            except Exception as e:
                print("cuda", idx, "failed:", e, file=sys.stderr)
    if model is None:
        model, used = WhisperModel(a.model, device="cpu", compute_type="int8", cpu_threads=max(4, (os.cpu_count() or 8) - 2)), "cpu"
    print("device", used, flush=True)
    prompt = "Um, uh, so, like, you know, I mean, uh, um... Yeah. Hmm, okay, so, um, we, uh, we went there."
    segs, info = model.transcribe(wav, language=a.language, word_timestamps=True, initial_prompt=prompt, condition_on_previous_text=False, vad_filter=False)
    res, fillers, words = [], [], []
    for s in segs:
        ws = []
        for w in (s.words or []):
            t = w.word.strip().lower().strip(".,!?-\u2026")
            f = t in FILLERS
            ws.append([round(w.start, 3), round(w.end, 3), w.word, round(w.probability, 3), f])
            words.append(ws[-1])
            if f: fillers.append([round(w.start, 3), round(w.end, 3), w.word])
        res.append({"s": round(s.start, 3), "e": round(s.end, 3), "text": s.text.strip(), "words": ws})
    json.dump({"media": a.media, "wav": wav, "device": used, "model": a.model, "segments": res, "fillers": fillers}, open(a.out, "w"), indent=0)
    print("done", len(res), "segments", len(fillers), "fillers", flush=True)

if __name__ == "__main__":
    main()
