import path from 'node:path';
import { materializeCreation } from './creation.mjs';
import { verifyBehaviors } from './behavior-verify.mjs';
import { atomicJSON } from './store.mjs';

export async function checkCreationModule(store,module,{origin,signal,deadline}={}){
  const cached=store.data.library.find(m=>m.id===module.id)?.verifications?.[module.version];
  if(cached?.hash===module.hash&&cached.passed)return cached;
  const preview=store.build(materializeCreation(module.payload,{id:module.id,version:module.version},module.payload.anchor));
  const report=await verifyBehaviors(preview,{origin,signal,deadline,events:module.payload.tests.events});
  atomicJSON(path.join(store.root,'builds',preview.id,'behavior-verification.json'),report);
  if(!report.passed)throw Error('创作源码未通过后台检查：'+report.modules.filter(m=>!m.passed).map(m=>m.id+'：'+m.error).join('；'));
  const ranges=preview.primitives.map(p=>({min:p.min,max:p.max}));
  for(const motion of report.modules.flatMap(m=>m.motions)){
    const object=preview.scene.objects.find(o=>o.id===motion.id);if(!object)continue;
    for(const part of preview.primitives.filter(p=>p.id===motion.id))ranges.push(Object.fromEntries(['min','max'].map(edge=>[edge,Object.fromEntries(['x','y','z'].map(k=>[k,part[edge][k]+motion.position[k]-object.position[k]]))])));
  }
  const bounds={min:{},max:{}};
  for(const axis of ['x','y','z']){bounds.min[axis]=Math.min(0,...ranges.map(r=>r.min[axis]-module.payload.anchor[axis]));bounds.max[axis]=Math.max(0,...ranges.map(r=>r.max[axis]-module.payload.anchor[axis]));}
  return {format:'craftmine.creation-verification/1',hash:module.hash,passed:true,build:preview.id,bounds,checks:report.modules.map(m=>({id:m.id,revision:m.revision,events:m.events})),time:Date.now()};
}
export function rememberCreationCheck(store,module,report){
  store.change(data=>{const entry=data.library.find(m=>m.id===module.id);if(!entry?.versions.some(v=>v.version===module.version&&v.hash===report.hash))throw Error('模块版本已改变，检查结果未保存');entry.verifications??={};entry.verifications[module.version]=report;});
}
