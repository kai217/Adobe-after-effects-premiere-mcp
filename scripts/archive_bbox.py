# usage: python archive_bbox.py <arch_list.json> <converted stills folder> <out.json>
import json, cv2, numpy as np, os, sys
L=json.load(open(sys.argv[1])); out={}
for e in L:
    if e['video']: continue
    p=os.path.join(sys.argv[2], '%s.png'%e['key'])
    if not os.path.exists(p): p=e['path']
    im=cv2.imread(p, cv2.IMREAD_GRAYSCALE)
    if im is None: out[e['key']]=None; continue
    h,w=im.shape; rows=np.where(im.mean(1)>14)[0]; cols=np.where(im.mean(0)>14)[0]
    if len(rows)==0: continue
    y0,y1,x0,x1=int(rows[0]),int(rows[-1])+1,int(cols[0]),int(cols[-1])+1
    out[e['key']]=dict(w=w,h=h,x0=x0,y0=y0,x1=x1,y1=y1,trim=(y0+h-y1+x0+w-x1)>0.02*(w+h))
json.dump(out,open(sys.argv[3],'w'),indent=0)
for k,v in out.items():
    if v and v['trim']: print(k,v)
