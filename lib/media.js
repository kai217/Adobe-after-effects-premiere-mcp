// Image/video helpers using the bundled ffmpeg (ffmpeg-static): thumbnails, contact sheets, reference frames, diffs.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

function ff(args) {
  return new Promise((resolve, reject) => execFile(ffmpegPath, ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 28, encoding: 'buffer' },
    (err, stdout, stderr) => err ? reject(new Error(String(stderr || err))) : resolve(stdout)));
}

// AE's saveFrameToPng writes asynchronously: wait until each PNG is complete (ends with IEND) and stable.
export async function waitForPngs(files, timeoutMs = 60000) {
  const t0 = Date.now();
  for (const f of files) {
    let last = -1;
    for (;;) {
      try {
        const st = fs.statSync(f);
        if (st.size > 64 && st.size === last) {
          const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, st.size - 12); fs.closeSync(fd);
          if (b.includes(Buffer.from('IEND'))) break;
        }
        last = st.size;
      } catch {}
      if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for AE to finish writing ' + f);
      await new Promise(r => setTimeout(r, 250));
    }
  }
}

// Downscale an image file to a JPEG buffer (max width) for returning to the model.
export async function thumbJpeg(file, maxW = 540) {
  return ff(['-i', file, '-vf', `scale='min(${maxW},iw)':-2`, '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']);
}

// Contact sheet from several image files, with labels burned in (labels via filename order).
export async function contactSheet(files, outFile, { tileW = 270, cols = 6 } = {}) {
  if (!files.length) throw new Error('no frames');
  const inputs = files.flatMap(f => ['-i', f]);
  const n = files.length, c = Math.min(cols, n), rows = Math.ceil(n / c);
  const scaled = files.map((_, i) => `[${i}:v]scale=${tileW}:-2,setsar=1[s${i}]`).join(';');
  const layout = files.map((_, i) => `${(i % c) * tileW}_${Math.floor(i / c)}*h0`).map((s, i) => {
    const col = i % c, row = Math.floor(i / c);
    const x = col === 0 ? '0' : Array.from({ length: col }, (_, k) => `w${k}`).join('+');
    const y = row === 0 ? '0' : Array.from({ length: row }, () => 'h0').join('+');
    return `${x}_${y}`;
  }).join('|');
  const pad = n === 1 ? `${scaled};[s0]copy[out]` : `${scaled};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=0x3a3a3a[out]`;
  await ff([...inputs, '-filter_complex', pad, '-map', '[out]', '-frames:v', '1', outFile]);
  return outFile;
}

// Extract a frame from a reference video at a time (seconds) or frame index (with fps).
export async function extractFrame(video, { time, frame, fps }, outFile) {
  if (frame !== undefined && fps) {
    await ff(['-i', video, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', outFile]);
  } else {
    await ff(['-ss', String(time), '-i', video, '-frames:v', '1', outFile]);
  }
  return outFile;
}

// Mean absolute difference (0-255) between two images after scaling both to the same small size.
export async function imageDiff(a, b, w = 270, h = 480) {
  const raw = async (f) => ff(['-i', f, '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-']);
  const [A, B] = await Promise.all([raw(a), raw(b)]);
  const n = Math.min(A.length, B.length); let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(A[i] - B[i]);
  return Math.round((s / n) * 10) / 10;
}

// Side-by-side pair (reference | AE) for visual review.
export async function sideBySide(a, b, outFile, h = 480) {
  await ff(['-i', a, '-i', b, '-filter_complex', `[0:v]scale=-2:${h}[a];[1:v]scale=-2:${h}[b];[a][b]hstack=inputs=2[o]`, '-map', '[o]', '-frames:v', '1', outFile]);
  return outFile;
}

export function exists(f) { try { fs.accessSync(f); return true; } catch { return false; } }
export { ffmpegPath, path };
