import json, os, sys, re, collections
# usage: python photo_catalog.py <viewer data.js> <photo library root> <out.json>
src, root = sys.argv[1], sys.argv[2]
viewer = os.path.dirname(src)
s = open(src, encoding='utf-8').read()
d = json.loads(s[s.index('{'):s.rindex('}') + 1])
items = d['items']
ch = d['chapters']
mm = json.load(open(os.path.join(root, 'Project Backups', 'move-map.json'), encoding='utf-8'))
print('move-map', json.dumps(mm)[:800])
cnt = collections.Counter((it['c'], it['k']) for it in items)
for (c, k), n in sorted(cnt.items()):
    print(c, ch[c - 1] if 0 < c <= len(ch) else '?', k, n)

def resolve(it):
    p = it['p']
    cands = []
    rel = p[3:] if re.match(r'^[A-Z]:\\', p) else p
    cands.append(os.path.join(root, 'Original Media', rel))
    cands.append(os.path.join(root, rel))
    parts = rel.split('\\', 1)  # path saved under a renamed top folder
    if len(parts) == 2:
        cands.append(os.path.join(root, parts[1]))
        cands.append(os.path.join(root, 'Original Media', parts[1]))
    for c in cands:
        if os.path.exists(c):
            return c
    return None

out = []
miss = 0
for it in items:
    if it['c'] in (2, 4, 5, 6, 7) or it.get('fl'):
        rp = resolve(it)
        if not rp:
            miss += 1
            continue
        out.append({'id': it['id'], 'n': it['n'], 'c': it['c'], 'k': it['k'], 'd': it.get('d', ''), 'du': it.get('du'),
                    'w': it.get('w'), 'h': it.get('h'), 'no': it.get('no', '')[:200], 'fl': it.get('fl', ''), 's': it.get('s'), 'r': it.get('r'),
                    'path': rp, 'thumb': os.path.join(viewer, 'thumbs', it['id'] + '.jpg')})
print('kept', len(out), 'missing', miss)
json.dump(out, open(sys.argv[3], 'w', encoding='utf-8'), indent=0)
c4 = [o for o in out if o['c'] == 4]
print('ch4', len(c4), collections.Counter(o['k'] for o in c4))
for o in sorted(c4, key=lambda o: o['d'] or 'z')[:400]:
    print(o['k'], o['d'], o['n'], o.get('du'), o['no'][:90])
