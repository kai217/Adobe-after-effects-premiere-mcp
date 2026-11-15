import json, sys, cv2, numpy as np, os, subprocess, tempfile
FF=os.environ.get('FFMPEG','ffmpeg')
def vthumb(o):
    t=os.path.join(tempfile.gettempdir(),'vt_'+o['id']+'.jpg')
    if not os.path.exists(t):
        ss=max(0.0,(o.get('du') or 2)*0.35)
        subprocess.run([FF,'-v','error','-ss','%.2f'%ss,'-i',o['path'],'-frames:v','1','-vf','scale=480:-2','-y',t])
    return cv2.imread(t)
cat = json.load(open(sys.argv[1], encoding='utf-8'))
chs = [int(x) for x in sys.argv[2].split(',')]
out = sys.argv[3]
per = int(sys.argv[4]) if len(sys.argv) > 4 else 48
sel = [o for o in cat if o['c'] in chs and 'duplicate' not in o['no'].lower()]
sel.sort(key=lambda o: (o['d'] or '9999', o['n']))
idx = []
TW, TH, COLS = 240, 180, 8
for page in range(0, len(sel), per):
    items = sel[page:page + per]
    rows = (len(items) + COLS - 1) // COLS
    sheet = np.zeros((rows * (TH + 22), COLS * TW, 3), np.uint8)
    for i, o in enumerate(items):
        im = cv2.imread(o['thumb']) if os.path.exists(o['thumb']) else None
        if im is None and o['k']=='v': im = vthumb(o)
        if im is None:
            continue
        h, w = im.shape[:2]; s = min(TW / w, TH / h)
        im = cv2.resize(im, (int(w * s), int(h * s)))
        x = (i % COLS) * TW + (TW - im.shape[1]) // 2; y = (i // COLS) * (TH + 22) + (TH - im.shape[0]) // 2
        sheet[y:y + im.shape[0], x:x + im.shape[1]] = im
        lab = '%d %s%s %s' % (page + i, o['k'], ('%.0fs' % o['du']) if o.get('du') else '', (o['d'] or '')[:10])
        cv2.putText(sheet, lab, ((i % COLS) * TW + 3, (i // COLS) * (TH + 22) + TH + 15), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1)
        idx.append({'i': page + i, 'id': o['id'], 'n': o['n'], 'path': o['path'], 'k': o['k'], 'du': o.get('du'), 'd': o['d'], 'c': o['c']})
    cv2.imwrite(out % (page // per), sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])
json.dump(idx, open(out.replace('_%d.jpg', '_idx.json'), 'w', encoding='utf-8'), indent=0)
print(len(sel), 'items', (len(sel) + per - 1) // per, 'sheets')
