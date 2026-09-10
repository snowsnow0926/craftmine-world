// Evaluator navigation only. A ground ray hit does not prove that a new object
// fits beside existing geometry. This never substitutes or edits a host target.
export function evaluationGroundHasSpace(observation:any):boolean {
 const creation=observation?.payload?.creation,position=creation?.target?.position,player=observation?.payload?.player?.position;
 const vector=(v:any)=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(creation?.target?.surface!=="ground"||!vector(position)||!vector(player)||!Array.isArray(creation.entities))return false;
 // The fixed suite places a unit tree or rock; reserve their union plus a
 // small clearance so the model still uses the exact observed hit position.
 const min=[position[0]-.8,position[1],position[2]-.8],max=[position[0]+.8,position[1]+4,position[2]+.8];
 if(min[0]<-28||max[0]>28||min[2]<-28||max[2]>28||max[1]>16)return false;
 const overlap=(low:number[],high:number[])=>[0,1,2].every(i=>min[i]<high[i]&&max[i]>low[i]);
 if(overlap(player.map((v:number,i:number)=>v-[.5,.9,.5][i]),player.map((v:number,i:number)=>v+[.5,.9,.5][i])))return false;
 for(const entity of creation.entities){
  const box=entity.collisionBounds??entity.bounds??entity.meshBounds;
  if(!box||!vector(box.min)||!vector(box.max))return false;
  if(overlap(box.min,box.max))return false;
 }
 return true;
}
