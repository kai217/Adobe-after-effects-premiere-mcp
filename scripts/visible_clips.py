import json,sys
e=json.load(open(sys.argv[1]))['clips']; out=[]
for tr in (1,2):
    L=sorted([c for c in e if c['v']==tr],key=lambda c:c['at'])
    for i,c in enumerate(L): c['_idx']=i; c['_end']=c['at']+c['out']-c['in']
V1=[c for c in e if c['v']==1]; V2=[c for c in e if c['v']==2]
for c in V2: out.append(dict(track=2,idx=c['_idx'],item=c['item'],t=round(c['at']+0.55*(c['_end']-c['at']),3)))
for c in V1:
    # visible parts of c not covered by any V2 clip
    segs=[[c['at'],c['_end']]]
    for b in V2:
        ns=[]
        for a,z in segs:
            if b['_end']<=a or b['at']>=z: ns.append([a,z]); continue
            if b['at']>a: ns.append([a,b['at']])
            if b['_end']<z: ns.append([b['_end'],z])
        segs=ns
    segs=[s for s in segs if s[1]-s[0]>0.4]
    if segs:
        a,z=max(segs,key=lambda s:s[1]-s[0]); out.append(dict(track=1,idx=c['_idx'],item=c['item'],t=round(a+0.55*(z-a),3)))
out.sort(key=lambda x:x['t'])
json.dump(out,open(sys.argv[2],'w'),indent=0); print(len(out))
