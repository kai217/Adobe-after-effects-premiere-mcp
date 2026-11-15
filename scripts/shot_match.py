import json,sys
# usage: match.py vis.json stats_prev.json looks_prev.json out_looks.json [stats_before.json looks_before.json]
vis=json.load(open(sys.argv[1])); S=json.load(open(sys.argv[2])); LP=json.load(open(sys.argv[3])) if sys.argv[3]!='-' else None
SB=json.load(open(sys.argv[5])) if len(sys.argv)>5 else None; LB=json.load(open(sys.argv[6])) if len(sys.argv)>6 else None
TGT=dict(mean=0.44,p05=0.19,warm=0.31,tint=0.07,sat=0.30)
FAM_I=dict(temperature=12,tint=3,exposure=0.1,contrast=45,highlights=-10,shadows=0,whites=14,blacks=-26,saturation=150,vibrance=25,creative_saturation=108)
SUBJECT_I=dict(temperature=6,tint=-4,exposure=0,contrast=75,highlights=-40,shadows=-8,whites=12,blacks=-55,saturation=135,vibrance=25,creative_saturation=106)
BROLL=dict(temperature=12,tint=2,exposure=0.25,contrast=30,highlights=-15,shadows=8,whites=10,blacks=-12,saturation=140,vibrance=30,creative_saturation=110)
G0=dict(exposure=0.22,blacks=0.0016,temperature=0.006,tint=-0.0025,saturation=0.0028)  # default response per slider unit
def key(i): return [k for k in S if k.startswith('%03d_'%i)][0]
out={}
for i,v in enumerate(vis):
    k='%d_%d'%(v['track'],v['idx']); s=S[key(i)]
    if LP and k in LP: look=dict(LP[k])
    else: look=dict(BROLL if v['track']==2 else (FAM_I if v['item'].startswith('A007') else SUBJECT_I))
    g=dict(G0)
    if SB and LB and k in LB:  # measured response from the previous round
        sb=SB[[kk for kk in SB if kk.startswith('%03d_'%i)][0]]; lb=LB[k]
        for sl,met in (('exposure','mean'),('blacks','p05'),('temperature','warm'),('saturation','sat')):
            d=look.get(sl,0)-lb.get(sl,0)
            if abs(d)>1e-6:
                gg=(s[met]-sb[met])/d
                if gg*G0[sl]>0: g[sl]=0.5*G0[sl]+0.5*gg   # same sign: blend, keeps it stable
    def step(sl,met,lim,lo,hi,damp=0.85):
        d=damp*(TGT[met]-s[met])/g[sl]; d=max(-lim,min(lim,d)); look[sl]=round(max(lo,min(hi,look.get(sl,0)+d)),3)
    step('exposure','mean',1.2,-2.5,2.5)
    step('blacks','p05',40,-90,40)
    if v['item'][:9] not in ('A008C0055','A008C0038'): step('temperature','warm',40,-60,80,0.7)  # blue paint is the subject there, not a cast
    # tint is mostly foliage content, not a cast: leave it
    step('saturation','sat',40,80,190)
    out[k]=look
json.dump(out,open(sys.argv[4],'w'),indent=0)
print(len(out))
