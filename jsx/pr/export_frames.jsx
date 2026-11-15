// ARGS: {sequence, vis_file, dir}  exports one PNG per visible clip: NNN_track_idx.png
function rd(p){ var f=File(p); f.encoding="UTF-8"; f.open("r"); var s=f.read(); f.close(); return s; }
var V=KAI.parse(rd(ARGS.vis_file)), s=KAI.seq(ARGS.sequence); app.project.activeSequence=s; app.enableQE(); var q=qe.project.getActiveSequence();
new Folder(ARGS.dir).create(); var n=0, err=[];
for (var i=0;i<V.length;i++){ var v=V[i]; var nm=(i<10?"00":(i<100?"0":""))+i+"_"+v.track+"_"+v.idx;
  try{ q.exportFramePNG(KAI.tc(s,v.t).tc, ARGS.dir+"\\"+nm); n++; }catch(e){ err.push(nm+":"+e); } }
return {n:n, err:err.slice(0,3)};
