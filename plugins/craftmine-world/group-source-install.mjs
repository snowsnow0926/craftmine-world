// Combine independently verified ZIP plans, never rewrite resources or synthesize a ZIP.
import {validateAssetLock,assetLockHash} from './asset-lock.mjs';
const fail=(code,detail)=>{throw Object.assign(Error(code+(detail?': '+detail:'')),{code});};
const sameBytes=(a,b)=>Buffer.isBuffer(a)&&Buffer.isBuffer(b)&&a.equals(b);
const identity=r=>r.manifest.content.assetId+'@'+r.manifest.content.version;

export function mergeSourceInstallPlans({archives,plans,operationId,worldId,sourceFiles}){
  if(archives.length!==plans.length||archives.length<2||archives.length>8)fail('PACKAGE_GROUP_INVALID');
  const resources=new Map(),payloads=new Map(),declared=new Map();
  for(const archive of archives)for(const resource of archive.resources){
    const content=resource.manifest.content,key=content.assetId,previous=resources.get(key);
    if(previous){
      if(identity(previous)!==identity(resource)||previous.contentHash!==resource.contentHash)fail('PACKAGE_GROUP_RESOURCE_CONFLICT',key);
      continue;
    }
    resources.set(key,resource);
    for(const [field,values]of Object.entries({...content.interfaces,inputActions:[...(content.interfaces?.inputActions??[]),...(content.entry?.sceneInstall?.inputActions??[])]})){
      if(!['inputActions','autoloads','globalClasses','uids','paths','entityIds'].includes(field))continue;
      if(!Array.isArray(values))fail('PACKAGE_GROUP_INVALID_DECLARATION',field);
      for(const name of values){
        if(typeof name!=='string')fail('PACKAGE_GROUP_INVALID_DECLARATION',field);
        const slot=field+'\0'+name,owner=declared.get(slot);
        if(owner&&owner!==key)fail('PACKAGE_GROUP_DECLARATION_CONFLICT',field+': '+name);
        declared.set(slot,key);
      }
    }
    for(const [path,bytes]of resource.files){
      const slot=resource.contentHash+'\0'+path,prior=payloads.get(slot);
      if(prior&&!sameBytes(prior.bytes,bytes))fail('PACKAGE_GROUP_PAYLOAD_CONFLICT',path);
      payloads.set(slot,{contentHash:resource.contentHash,path,bytes});
    }
  }
  const instances=plans.flatMap(plan=>{
    if(plan.ok!==true||plan.applied!==false||plan.worldId!==worldId||!Array.isArray(plan.instances))fail('PACKAGE_GROUP_PLAN_INVALID');
    return plan.instances;
  });
  if(new Set(instances.map(i=>i.instanceId)).size!==instances.length)fail('PACKAGE_GROUP_INSTANCE_CONFLICT');
  const entityIds=instances.flatMap(i=>Object.values(i.entityMap));
  if(new Set(entityIds).size!==entityIds.length)fail('PACKAGE_GROUP_ENTITY_CONFLICT');
  const lock=validateAssetLock({format:'craftmine.assets-lock/1',assets:plans.flatMap(plan=>plan.lock.assets)});
  // UID ownership is a path, not an instance. Reusing identical resources keeps
  // the path; two different files must not register the same script/resource UID.
  const uids=new Map();
  const admitUid=(file,bytes)=>{
    let value;
    if(file.endsWith('.uid'))value=bytes.toString('utf8').trim();
    else if(/\.(tscn|tres)$/.test(file))value=/^\[(?:gd_scene|gd_resource)\b[^\r\n]*\buid="(uid:\/\/[^"]+)"/m.exec(bytes.toString('utf8'))?.[1];
    if(!value)return;
    const prior=uids.get(value);if(prior&&prior!==file)fail('PACKAGE_GROUP_UID_CONFLICT',value);
    uids.set(value,file);
  };
  for(const [file,bytes]of sourceFiles)admitUid(file,bytes);
  for(const entry of lock.assets){const resource=resources.get(entry.asset.assetId);if(!resource)fail('PACKAGE_GROUP_RESOURCE_MISSING');for(const [file,bytes]of resource.files)admitUid(entry.installPath+'/'+file,bytes);}
  return {plan:{...plans[0],operationId,worldId,instances,lock,assetLockHash:assetLockHash(lock),order:[...new Set(plans.flatMap(p=>p.order??[]))]},
    payload:[...payloads.values()],archives:archives.map((archive,index)=>({archiveSha256:archive.archiveSha256,instanceIds:plans[index].instances.map(i=>i.instanceId)}))};
}
