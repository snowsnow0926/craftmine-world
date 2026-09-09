const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const groups=['objects','behaviors','systems'];

/** Focus only when the existing full review exceeds its original bound.
 * Keep changed resources, every behavior/system and their object dependency
 * closure. Unchanged objects remain in a source-hashed spatial index. If that
 * complete slice cannot fit, fail explicitly instead of slicing source bytes.
 */
function focusedReviewPrompt(job,reviewPrompt) {
  try{return reviewPrompt(job);}catch(error){
    if(!String(error.message).startsWith('REVIEW_INPUT_TOO_LARGE'))throw error;
  }
  const before=job.input.world.build.scene,after=job.output.artifact.build.scene;
  const ids=new Set();
  const index=new Map();
  for(const scene of [before,after])for(const group of groups)for(const item of scene[group]||[])index.set(`${group}:${item.id}`,item);
  const changed=[];
  for(const group of groups){
    const a=new Map((before[group]||[]).map(item=>[item.id,item])),b=new Map((after[group]||[]).map(item=>[item.id,item]));
    for(const id of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id))){ids.add(`${group}:${id}`);changed.push(`${group}:${id}`);}
  }
  // Changes to environment and global rules can affect every object.
  const globalChange=['title','night','format'].some(key=>before[key]!==after[key]);
  for(const key of index.keys())if(globalChange||!key.startsWith('objects:'))ids.add(key);
  // Include both old and new values: removed dependencies still explain the
  // transition. Match exact JSON strings or source text conservatively.
  let grew=true;
  while(grew){
    grew=false;
    const text=[before,after].flatMap(scene=>groups.flatMap(group=>(scene[group]||[]).filter(item=>ids.has(`${group}:${item.id}`)))).map(item=>JSON.stringify(item)).join('\n');
    for(const [key,item]of index)if(!ids.has(key)&&text.includes(item.id)){ids.add(key);grew=true;}
  }
  const project=scene=>({...scene,...Object.fromEntries(groups.map(group=>[group,(scene[group]||[]).filter(item=>ids.has(`${group}:${item.id}`))]))});
  const omitted=scene=>(scene.objects||[]).filter(item=>!ids.has(`objects:${item.id}`)).map(item=>({id:item.id,name:item.name,position:item.position,hash:hash(item)}));
  const provenance={format:'craftmine.focused-review/1',beforeHash:hash(before),proposedHash:hash(after),included:[...ids].sort(),changed,
    omittedBefore:omitted(before),omittedProposed:omitted(after),limitations:['Unchanged omitted objects are represented by anchors and source hashes, not their complete geometry. Global visual/collision claims about omitted geometry are unverified.']};
  const focused={...job,input:{...job.input,world:{...job.input.world,build:{...job.input.world.build,scene:project(before)}}},
    output:{...job.output,artifact:{...job.output.artifact,build:{...job.output.artifact.build,scene:project(after)}},evidence:{...job.output.evidence,reviewScope:provenance}}};
  const prompt=reviewPrompt(focused);
  return {...prompt,system:prompt.system+'\nThis is an explicitly focused review. machineEvidence.reviewScope names full-scene hashes, all included/changed resource IDs and unchanged omitted object anchors. All behaviors/systems and dependencies are included. Do not infer full geometry of omitted objects. Include reviewScope.limitations in your output limitations; do not claim global visual/collision coverage of the omitted geometry.'};
}
module.exports={focusedReviewPrompt};
