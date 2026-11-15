import json, sys, os, subprocess, cv2, numpy as np
FF=os.environ['FFMPEG']
d=json.load(open(sys.argv[1])); paths=[l.strip() for l in open(sys.argv[2]) if l.strip()]
P={os.path.basename(p):p for p in paths}
rows=[]
for n,v in d.items():
    sec=v['sec']; best=cur=bs=0
    for i,s in enumerate(sec):
        cur = cur+1 if (s[0]<0.5 and abs(s[1])<2.0) else 0
        if cur>best: best=cur; bs=i-cur+1
    if best>=3: rows.append((n,bs,best))
rows.sort()
TW,TH,C=320,180,6
tmp=os.path.join(os.environ['TEMP'],'stabsheet'); os.makedirs(tmp,exist_ok=True)
pages=[rows[i:i+48] for i in range(0,len(rows),48)]
for pi,pg in enumerate(pages):
    sheet=np.zeros((((len(pg)+C-1)//C)*(TH+20),C*TW,3),np.uint8)
    for i,(n,bs,best) in enumerate(pg):
        t=bs+best/2; f=os.path.join(tmp,n+'.jpg')
        if not os.path.exists(f): subprocess.run([FF,'-v','error','-ss','%.2f'%t,'-i',P[n],'-frames:v','1','-vf','scale=320:-2','-y',f])
        im=cv2.imread(f)
        if im is not None:
            im=cv2.resize(im,(TW,TH)); x=(i%C)*TW; y=(i//C)*(TH+20); sheet[y:y+TH,x:x+TW]=im
        cv2.putText(sheet,'%s %d+%ds'%(n[:9],bs,best),((i%C)*TW+3,(i//C)*(TH+20)+TH+15),cv2.FONT_HERSHEY_SIMPLEX,0.45,(0,255,255),1)
    cv2.imwrite(sys.argv[3]%pi,sheet,[cv2.IMWRITE_JPEG_QUALITY,78])
print(len(rows),'clips',len(pages),'pages')
