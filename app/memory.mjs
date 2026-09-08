import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { compileScene, upgradeScene, clone, canonicalJSON } from './scene.mjs';
import { SYSTEMS, identifier, exactKeys, validateSystem } from './gameplay.mjs';

export const MODULE_RUNTIME='craftmine-web/2';
const hash=content=>createHash('sha256').update(canonicalJSON(content)).digest('hex');
function payloadOf(kind,definition){
  if(kind==='gameplay')return {name:definition.name,type:definition.type,config:clone(definition.config)};
  return {name:definition.name,parts:clone(definition.parts),components:clone(definition.components)};
}
export function validateModule(input){
  exactKeys(input,['format','runtime','id','version','kind','hash','name','description','dependencies','payload','origin']);
  if(input.format!=='craftmine.module/1'||input.runtime!==MODULE_RUNTIME||!identifier(input.id)||!Number.isInteger(input.version)||input.version<1||input.version>100000||!['object','gameplay'].includes(input.kind))throw Error('模块格式或运行约定不兼容');
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>60||typeof input.description!=='string'||input.description.length>2000||input.name!==input.payload?.name)throw Error('模块名称或来源需求无效');
  if(!input.origin||typeof input.origin!=='object'||Array.isArray(input.origin))throw Error('模块来源无效');
  exactKeys(input.origin,['build','definition','time']);
  if(typeof input.origin.build!=='string'||input.origin.build.length>80||!identifier(input.origin.definition)||!Number.isFinite(input.origin.time))throw Error('模块来源无效');
  let dependencies;
  if(input.kind==='object'){
    exactKeys(input.payload,['name','parts','components']);
    if(!Array.isArray(input.payload.parts)||!input.payload.parts.length||input.payload.parts.length>128)throw Error('模块几何无效');
    const parts=input.payload.parts,minimum=k=>Math.min(...parts.map(p=>p?.offset?.[k])),maximum=k=>Math.max(...parts.map(p=>p?.offset?.[k]+p?.size?.[k]));
    const object={id:'module-check',...clone(input.payload),position:{x:Math.min(0,46-maximum('x')),y:6-minimum('y'),z:Math.min(0,46-maximum('z'))},source:null};
    // A contact-damage object declares the health dependency. Validate using it.
    const systems=object.components?.contactDamage>0?[{id:'health-check',name:'生命值',type:'health',source:null,config:{maxHealth:100,fallDamage:5,regenPerSecond:0}}]:[];
    compileScene({format:'craftmine.scene/2',title:'模块校验',night:false,objects:[object],systems});
    dependencies=systems.length?['geometry@2','health@1']:['geometry@2'];
  }else{
    exactKeys(input.payload,['name','type','config']);
    validateSystem({id:'module-check',...input.payload,source:null});dependencies=SYSTEMS[input.payload.type].dependencies;
  }
  if(JSON.stringify(input.dependencies)!==JSON.stringify(dependencies)||input.hash!==hash({kind:input.kind,payload:input.payload}))throw Error('模块内容哈希或依赖校验失败');
  return clone(input);
}
export class ModuleLibrary {
  constructor(root,write){this.root=path.join(root,'modules');this.write=write;}
  file(id,version){if(!identifier(id)||!Number.isInteger(version)||version<1||version>100000)throw Error('模块版本无效');return path.join(this.root,id,version+'.json');}
  read(data,id,version){
    const entry=data.library.find(m=>m.id===id),record=entry?.versions.find(v=>v.version===version);
    if(!record)throw Error('模块版本不存在');
    const module=validateModule(JSON.parse(fs.readFileSync(this.file(id,version),'utf8')));
    if(module.id!==id||module.version!==version||module.hash!==record.hash)throw Error('模块索引与文件不一致');
    return module;
  }
  register(data,input){
    const module=validateModule(input);let entry=data.library.find(m=>m.id===module.id);
    const existing=entry?.versions.find(v=>v.version===module.version);
    if(existing){if(existing.hash!==module.hash)throw Error('同一模块版本的内容冲突，未覆盖已有记忆');this.read(data,module.id,module.version);return;}
    if(entry&&entry.kind!==module.kind)throw Error('模块类别冲突');
    if(data.library.length>=512&&!entry)throw Error('本地模块库已达到 512 项上限，请先导出整理');
    const file=this.file(module.id,module.version);
    if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.hash!==module.hash)throw Error('模块文件版本冲突');}
    else this.write(file,module);
    if(!entry){entry={id:module.id,kind:module.kind,name:module.name,description:module.description,latest:module.version,versions:[]};data.library.push(entry);}
    entry.versions.push({version:module.version,hash:module.hash,time:module.origin.time});entry.versions.sort((a,b)=>a.version-b.version);
    if(module.version>=entry.latest){entry.latest=module.version;entry.name=module.name;entry.description=module.description;}
  }
  capture(data,scene,prompt,buildId){
    data.library??=[];data.moduleBindings??={object:{},gameplay:{}};
    const normalized=upgradeScene(scene),captured=[];
    for(const [kind,definitions]of [['object',normalized.objects],['gameplay',normalized.systems]])for(const definition of definitions){
      const payload=payloadOf(kind,definition),contentHash=hash({kind,payload});
      let id=data.moduleBindings[kind][definition.id]?.id||definition.source?.id;
      let entry=data.library.find(m=>m.id===id&&m.kind===kind);
      if(!entry){id=kind+'-'+randomUUID();entry=null;}
      const identical=entry?.versions.find(v=>v.hash===contentHash);
      if(identical){data.moduleBindings[kind][definition.id]={id,version:identical.version};continue;}
      const version=(entry?.latest||0)+1;
      const module={format:'craftmine.module/1',runtime:MODULE_RUNTIME,id,version,kind,hash:contentHash,name:definition.name,description:String(prompt).slice(0,2000),
        dependencies:kind==='object'?(definition.components.contactDamage>0?['geometry@2','health@1']:['geometry@2']):SYSTEMS[definition.type].dependencies,
        payload,origin:{build:buildId,definition:definition.id,time:Date.now()}};
      this.register(data,module);data.moduleBindings[kind][definition.id]={id,version};captured.push({id,version,name:module.name});
    }
    return captured;
  }
  retrieve(data,query,selected=null){
    const normalized=String(query).toLowerCase(),tokens=new Set([...normalized.matchAll(/[a-z0-9]+|[\u3400-\u9fff]/g)].map(m=>m[0]).filter(t=>!['的','我','个','一','请','把','在','了','和','是','这','要'].includes(t)));
    const selectedRef=data.moduleBindings?.object[selected];
    const ranked=data.library.map((m,i)=>{const name=m.name.toLowerCase(),text=m.description.toLowerCase();let score=normalized.includes(name)?30:0;for(const token of tokens){if(name.includes(token))score+=8;if(text.includes(token))score+=1;}if(selectedRef?.id===m.id)score+=100;return {m,score,i};}).sort((a,b)=>b.score-a.score||b.i-a.i);
    const results=[];let size=0;
    for(const {m,score}of ranked){if(results.length>=6)break;if(!score&&results.length>=2)continue;const module=this.read(data,m.id,m.latest),length=JSON.stringify(module).length;if(size+length>45000)continue;results.push(module);size+=length;}
    return results;
  }
  instantiate(data,scene,id,version,player){
    const module=this.read(data,id,version),next=upgradeScene(scene),source={id,version};
    if(module.kind==='gameplay'){
      const old=next.systems.find(s=>s.type===module.payload.type),definition={id:old?.id||'system-'+randomUUID(),...clone(module.payload),source};
      next.systems=next.systems.filter(s=>s.type!==definition.type);next.systems.push(definition);compileScene(next);return next;
    }
    if(module.dependencies.includes('health@1')&&!next.systems.some(s=>s.type==='health'))throw Error('此对象需要生命值模块，请先复用或创建生命值模块');
    const min=Object.fromEntries(['x','y','z'].map(k=>[k,Math.min(...module.payload.parts.map(p=>p.offset[k]))]));
    const size=Object.fromEntries(['x','y','z'].map(k=>[k,Math.max(...module.payload.parts.map(p=>p.offset[k]+p.size[k]))-min[k]]));
    const front={x:player.x-Math.sin(player.yaw)*5,z:player.z-Math.cos(player.yaw)*5};
    let lastError;
    for(let ring=0;ring<10;ring++)for(let side=0;side<(ring?8:1);side++){
      const angle=side*Math.PI/4,position={x:Number(Math.max(-40,Math.min(40,front.x+Math.cos(angle)*ring*2-size.x/2-min.x)).toFixed(2)),y:6-min.y,z:Number(Math.max(-40,Math.min(40,front.z+Math.sin(angle)*ring*2-size.z/2-min.z)).toFixed(2))};
      if(player.x+.4>position.x+min.x&&player.x-.4<position.x+min.x+size.x&&player.z+.4>position.z+min.z&&player.z-.4<position.z+min.z+size.z)continue;
      const object={id:'instance-'+randomUUID(),...clone(module.payload),position,source};
      const candidate={...next,objects:[...next.objects,object]};
      try{compileScene(candidate);return candidate;}catch(e){lastError=e;}
    }
    throw Error('附近没有足够的放置空间：'+lastError?.message);
  }
}
