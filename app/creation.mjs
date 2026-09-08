import { randomUUID } from 'node:crypto';
import { compileScene,upgradeScene,canonicalJSON } from './scene.mjs';
import { exactKeys,identifier,bounded } from './gameplay.mjs';
import { validateBehavior } from './behavior-contracts.mjs';

const shift=(p,translation,sign=1)=>Object.fromEntries(['x','y','z'].map(k=>[k,Number((p[k]+sign*translation[k]).toFixed(8))]));
const safeId=v=>identifier(v)&&!['constructor','prototype'].includes(v);
const vector=(p,min,max)=>{exactKeys(p,['x','y','z']);for(const n of Object.values(p))bounded(n,min,max);};

export function creationGroups(scene){
  const remaining=new Set((scene.behaviors||[]).map(d=>d.id)),groups=[];
  while(remaining.size){
    const first=remaining.values().next().value,ids=new Set([first]),objects=new Set(),instances=new Set();let growing=true;
    while(growing){growing=false;for(const d of scene.behaviors){
      const targets=[...d.targets,...(d.binding?.objects.map(p=>p.world)||[])];
      if(ids.has(d.id)||targets.some(id=>objects.has(id))||(d.binding&&instances.has(d.binding.instanceId))){
        if(!ids.has(d.id)){ids.add(d.id);growing=true;}
        for(const id of targets)if(!objects.has(id)){objects.add(id);growing=true;}
        if(d.binding)instances.add(d.binding.instanceId);
      }
    }}
    for(const id of ids)remaining.delete(id);
    const behaviors=scene.behaviors.filter(d=>ids.has(d.id)),owned=scene.objects.filter(o=>objects.has(o.id));
    if(owned.length>16)throw Error('一个可复用创作最多包含 16 个相关对象');
    groups.push({id:behaviors.find(d=>d.binding)?.binding.instanceId||first,behaviors,objects:owned});
  }
  return groups;
}

export function captureCreation(group,scene){
  const anchor=group.behaviors.find(d=>d.binding)?.binding.origin||group.objects[0]?.position||{x:0,y:6,z:0},objectKeys=new Map(),behaviorKeys=new Map(),used=new Set();
  for(const o of group.objects){let key=group.behaviors.flatMap(d=>d.binding?.objects||[]).find(p=>p.world===o.id)?.key||o.id;if(used.has(key))key=o.id;used.add(key);objectKeys.set(o.id,key);}
  used.clear();for(const d of group.behaviors){let key=d.binding?.behaviors.find(p=>p.world===d.id)?.local||d.id;if(used.has(key))key=d.id;used.add(key);behaviorKeys.set(d.id,key);}
  const objects=group.objects.map(o=>({key:objectKeys.get(o.id),name:o.name,position:shift(o.position,anchor,-1),parts:structuredClone(o.parts),components:structuredClone(o.components)}));
  const scripts=group.behaviors.map(d=>{
    const aliases=group.objects.map(o=>({local:d.binding?.objects.find(p=>p.world===o.id)?.local||o.id,object:objectKeys.get(o.id)}));
    const {binding,...base}=d;
    return {key:behaviorKeys.get(d.id),definition:{...structuredClone(base),id:behaviorKeys.get(d.id),format:'craftmine.behavior/2',requires:d.requires||[],binding:null,targets:d.targets.map(id=>aliases.find(p=>p.object===objectKeys.get(id)).local)},translation:shift(binding?.translation||{x:0,y:0,z:0},anchor,-1),objects:aliases};
  });
  const required=new Set(scripts.flatMap(s=>s.definition.requires));if(objects.some(o=>o.components.contactDamage>0))required.add('health@1');
  const systems=scene.systems.filter(s=>required.has(s.type+'@1')).map(({source,...s})=>({...structuredClone(s),source:null}));
  const minimum=k=>Math.min(0,...objects.flatMap(o=>o.parts.map(p=>o.position[k]+p.offset[k]))),maximum=k=>Math.max(0,...objects.flatMap(o=>o.parts.map(p=>o.position[k]+p.offset[k]+p.size[k])));
  const checkAnchor={x:Number((-(minimum('x')+maximum('x'))/2).toFixed(8)),y:Number((6-minimum('y')).toFixed(8)),z:Number((-(minimum('z')+maximum('z'))/2).toFixed(8))};
  return {name:group.behaviors[0].name,anchor:checkAnchor,objects,scripts,systems,tests:{format:'craftmine.creation-tests/1',scope:'interface',events:['start','tick','interact','interact','contact','attack','land','restore']}};
}

export function validateCreation(payload){
  exactKeys(payload,['name','anchor','objects','scripts','systems','tests']);vector(payload.anchor,-40,40);
  if(typeof payload.name!=='string'||!payload.name.trim()||payload.name.length>60||!Array.isArray(payload.objects)||payload.objects.length>16||!Array.isArray(payload.scripts)||!payload.scripts.length||payload.scripts.length>8)throw Error('创作模块内容无效');
  const keys=new Set();for(const o of payload.objects){exactKeys(o,['key','name','position','parts','components']);if(!safeId(o.key)||keys.has(o.key))throw Error('创作对象标识重复或无效');keys.add(o.key);vector(o.position,-80,80);}
  const scripts=new Set();for(const s of payload.scripts){
    exactKeys(s,['key','definition','translation','objects']);if(!safeId(s.key)||scripts.has(s.key))throw Error('创作玩法标识重复或无效');scripts.add(s.key);vector(s.translation,-80,80);validateBehavior(s.definition);
    if(s.definition.id!==s.key||s.definition.format!=='craftmine.behavior/2'||s.definition.binding!==null||!Array.isArray(s.objects)||s.objects.length!==keys.size)throw Error('模板需要未绑定的源码和完整对象映射');
    const aliases=new Set(),roles=new Set();for(const p of s.objects){exactKeys(p,['local','object']);if(!safeId(p.local)||aliases.has(p.local)||!keys.has(p.object)||roles.has(p.object))throw Error('模板对象关系无效');aliases.add(p.local);roles.add(p.object);}
    if(s.definition.targets.some(id=>!aliases.has(id)))throw Error('模板源码引用了未保存的对象');
  }
  exactKeys(payload.tests,['format','scope','events']);
  if(payload.tests.format!=='craftmine.creation-tests/1'||payload.tests.scope!=='interface'||JSON.stringify(payload.tests.events)!==JSON.stringify(['start','tick','interact','interact','contact','attack','land','restore']))throw Error('创作模块的检查用例不兼容');
  const needed=new Set(payload.scripts.flatMap(s=>s.definition.requires));if(payload.objects.some(o=>o.components.contactDamage>0))needed.add('health@1');
  if(!Array.isArray(payload.systems)||payload.systems.some(s=>!needed.has(s.type+'@1'))||[...needed].some(r=>!payload.systems.some(s=>s.type===r.split('@')[0])))throw Error('创作模块的依赖定义不完整或包含多余系统');
  const scene=materializeCreation(payload,{id:'creation-check',version:1},payload.anchor,'check-instance');compileScene(scene);
  return structuredClone(payload);
}

export function materializeCreation(payload,source,position,instanceId='creation-'+randomUUID(),existing=null){
  const objects=payload.objects.map((o,index)=>({key:o.key,local:o.key,world:existing?.objects.find(p=>p.key===o.key)?.world||(existing?'instance-object-'+randomUUID():instanceId+'-o'+index)}));
  const behaviors=payload.scripts.map((s,index)=>({local:s.key,world:existing?.behaviors.find(p=>p.local===s.key)?.world||(existing?'instance-behavior-'+randomUUID():instanceId+'-b'+index)}));
  const scene={format:'craftmine.scene/3',title:payload.name,night:false,objects:payload.objects.map(o=>({id:objects.find(p=>p.key===o.key).world,name:o.name,position:shift(o.position,position),parts:structuredClone(o.parts),components:structuredClone(o.components),source:structuredClone(source)})),systems:structuredClone(payload.systems),behaviors:payload.scripts.map(s=>({
    ...structuredClone(s.definition),id:behaviors.find(p=>p.local===s.key).world,targets:s.definition.targets.map(alias=>objects.find(p=>p.key===s.objects.find(a=>a.local===alias).object).world),
    binding:{instanceId,source:structuredClone(source),origin:structuredClone(position),translation:shift(s.translation,position),objects:s.objects.map(p=>({key:p.object,local:p.local,world:objects.find(o=>o.key===p.object).world})),behaviors:structuredClone(behaviors)},
  }))};
  return scene;
}

export function placeCreation(scene,payload,source,player,{bounds,obstacles=[]}={}){
  const next=upgradeScene(scene),front={x:player.x-Math.sin(player.yaw)*5,z:player.z-Math.cos(player.yaw)*5};
  const min=k=>bounds?.min[k]??Math.min(0,...payload.objects.flatMap(o=>o.parts.map(p=>o.position[k]+p.offset[k]))),max=k=>bounds?.max[k]??Math.max(0,...payload.objects.flatMap(o=>o.parts.map(p=>o.position[k]+p.offset[k]+p.size[k])));
  const instanceId='creation-'+randomUUID();let lastError;
  for(let ring=0;ring<10;ring++)for(let side=0;side<(ring?8:1);side++){
    const angle=side*Math.PI/4,position={x:Number((front.x+Math.cos(angle)*ring*2-(min('x')+max('x'))/2).toFixed(2)),y:6-min('y'),z:Number((front.z+Math.sin(angle)*ring*2-(min('z')+max('z'))/2).toFixed(2))};
    if(bounds){
      const area={min:shift(bounds.min,position),max:shift(bounds.max,position)};
      if(area.min.x< -46||area.max.x>46||area.min.z< -46||area.max.z>46||area.min.y<6||area.max.y>38)continue;
      if(obstacles.some(other=>['x','y','z'].every(k=>area.min[k]<other.max[k]-.001&&area.max[k]>other.min[k]+.001)))continue;
    }
    const generated=materializeCreation(payload,source,position,instanceId);
    const candidate={...next,format:'craftmine.scene/3',objects:[...next.objects,...generated.objects],behaviors:[...(next.behaviors||[]),...generated.behaviors],systems:[...next.systems,...generated.systems.filter(s=>!next.systems.some(old=>old.type===s.type)).map(s=>({...s,id:'system-'+randomUUID()}))]};
    try{const build=compileScene(candidate);const body={min:{x:player.x-.4,y:player.y,z:player.z-.4},max:{x:player.x+.4,y:player.y+1.8,z:player.z+.4}};if(build.primitives.some(p=>generated.objects.some(o=>o.id===p.id)&&p.solid&&['x','y','z'].every(k=>p.min[k]<body.max[k]&&p.max[k]>body.min[k])))continue;return candidate;}catch(error){lastError=error;}
  }
  throw Error('附近无法放下完整创作：'+(lastError?.message||'与玩家位置冲突'));
}

export const creationDependencies=payload=>[...new Set(['geometry@2','behavior@2',...payload.scripts.flatMap(s=>s.definition.requires),...payload.scripts.flatMap(s=>s.definition.permissions.map(p=>({'player.motion':'player@1','inventory.write':'inventory@1','hud.message':'hud@1','objects.write':'geometry@2'})[p])),...(payload.objects.some(o=>o.components.contactDamage>0)?['health@1']:[]),...(payload.objects.some(o=>o.components.health>0)?['damageable@1']:[])])].sort();
