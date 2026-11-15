// ARGS: {sequence, looks: {"track_idx": {slider: value}}}  sets the second Lumetri (the correction) per clip
function rd(p){ var f=File(p); f.encoding="UTF-8"; f.open("r"); var s=f.read(); f.close(); return s; }
var LK=ARGS.looks_file ? KAI.parse(rd(ARGS.looks_file)) : ARGS.looks;
var s=KAI.seq(ARGS.sequence);
var map={temperature:['Temperature',0],tint:['Tint',0],saturation:['Saturation',0],exposure:['Exposure',0],contrast:['Contrast',0],highlights:['Highlights',0],shadows:['Shadows',0],whites:['Whites',0],blacks:['Blacks',0],vibrance:['Vibrance',0],creative_saturation:['Saturation',1]};
function byName(L,name,nth){ var k=0; for (var j=0;j<L.properties.numItems;j++) if (L.properties[j].displayName==name){ if(k==(nth||0)) return L.properties[j]; k++; } return null; }
var n=0, errs=[];
for (var key in LK){ var p=key.split("_"), tr=s.videoTracks[parseInt(p[0],10)-1], c=tr.clips[parseInt(p[1],10)]; if(!c){errs.push(key);continue;}
  var L=[]; for (var i=0;i<c.components.numItems;i++) if (c.components[i].displayName=="Lumetri Color") L.push(c.components[i]);
  if (L.length<2){ errs.push(key+":lum"); continue; } var G=L[1];
  for (var sl in LK[key]){ if(!map[sl]) continue; var pr=byName(G,map[sl][0],map[sl][1]); if(pr) pr.setValue(LK[key][sl],true); } n++; }
return {set:n, errors:errs};
