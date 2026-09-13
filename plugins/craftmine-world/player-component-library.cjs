// Player publication uses the existing immutable Rust catalog. Paths and image
// bytes below are host-owned; the renderer only supplies metadata and a source ref.
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
const fields=(value,keys)=>check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),'INVALID_PARAMS');
const text=(value,max,empty=false)=>check(typeof value==='string'&&(empty||value.trim())&&Buffer.byteLength(value)<=max&&!/[\x00-\x08\x0b-\x1f]/.test(value),'INVALID_PUBLICATION_METADATA');
const identity=args=>{text(args.worldId,240);check(/^[a-zA-Z0-9_-]{8,100}$/.test(args.operationId),'INVALID_OPERATION_ID');};
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());
async function atomic(file,value){const temporary=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,file);}
function metadata(args){
  fields(args,['worldId','operationId','revision','manifestHash','nodePath','assetId','version','displayName','tags','aliases','notes','preview']);identity(args);
  check(/^player\.component\.[a-z0-9][a-z0-9._-]{0,62}$/.test(args.assetId)&&args.assetId.length<=80,'INVALID_PUBLICATION_ASSET_ID');
  check(Number.isSafeInteger(args.version)&&args.version>=1&&args.version<=100000&&Number.isSafeInteger(args.revision)&&args.revision>=0&&/^[a-f0-9]{64}$/.test(args.manifestHash),'INVALID_PARAMS');
  text(args.nodePath,1024);text(args.displayName,200);text(args.notes??'',3000,true);
  const tags=args.tags??[],aliases=args.aliases??[];check(Array.isArray(tags)&&Array.isArray(aliases)&&tags.length+aliases.length<=29,'INVALID_PUBLICATION_TAGS');
  for(const value of [...tags,...aliases])text(value,40);
  return {worldId:args.worldId,operationId:args.operationId,revision:args.revision,manifestHash:args.manifestHash,nodePath:args.nodePath,assetId:args.assetId,version:args.version,displayName:args.displayName.trim(),tags:[...new Set(tags)].sort(),aliases:[...new Set(aliases)].sort(),notes:args.notes??''};
}
function previewOf(value,worldId){
  if(value==null)return null;fields(value,['worldId','buildId','pngBase64','sha256']);
  check(value.worldId===worldId&&typeof value.buildId==='string'&&value.buildId.length<=240&&typeof value.pngBase64==='string'&&value.pngBase64.length<=700000,'PUBLICATION_PREVIEW_INVALID');
  const bytes=Buffer.from(value.pngBase64,'base64');check(bytes.toString('base64')===value.pngBase64&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&sha(bytes)===value.sha256,'PUBLICATION_PREVIEW_INVALID');
  return value;
}
function createPlayerComponentLibrary({call,source,selected,directory}){
  check(typeof call==='function'&&source?.exportSource&&typeof selected==='function'&&path.isAbsolute(directory),'PUBLICATION_HOST_REQUIRED');
  const entries=new Map(),pending=new Map(),writes=new Map();
  const keyOf=args=>sha(JSON.stringify([args.worldId,args.operationId]));
  const fileOf=key=>path.join(directory,key+'.json');
  const save=(key,entry)=>{const previous=writes.get(key)??Promise.resolve(),next=previous.catch(()=>{}).then(async()=>{await fs.mkdir(directory,{recursive:true});await atomic(fileOf(key),entry);}).finally(()=>{if(writes.get(key)===next)writes.delete(key);});writes.set(key,next);return next;};
  const read=async key=>{if(entries.has(key))return entries.get(key);const value=await fs.readFile(fileOf(key),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(value)entries.set(key,value);return value;};
  const projection=entry=>entry.result??{status:entry.status,worldId:entry.worldId,operationId:entry.operationId};
  const current=async args=>check(await selected()===args.worldId,'GODOT_WORLD_CHANGED');
  return {
    async publishSource(args){
      const input=metadata(args),key=keyOf(input),binding=canonical(input);await current(input);
      const previous=await read(key);
      if(previous){check(!previous.binding||previous.binding===binding,'PUBLICATION_OPERATION_CONFLICT');if(previous.status==='cancelled'||previous.result)return projection(previous);}
      if(pending.has(key))return pending.get(key);
      const entry=previous??{worldId:input.worldId,operationId:input.operationId,binding,status:'preparing'};entries.set(key,entry);
      const guard=async()=>{check(entry.status!=='cancelled','PUBLICATION_CANCELLED');await current(input);check(entry.status!=='cancelled','PUBLICATION_CANCELLED');};
      const running=(async()=>{
        if(!entry.archiveSha256){
          await save(key,entry);await guard();
          const exported=await source.exportSource(Object.fromEntries(['worldId','revision','manifestHash','nodePath','assetId','version'].map(k=>[k,input[k]])),{assertActive:()=>check(entry.status!=='cancelled','PUBLICATION_CANCELLED')});await guard();
          const bytes=Buffer.from(exported.archiveBase64,'base64');check(bytes.length<=5*1024*1024&&sha(bytes)===exported.archiveSha256,'PUBLICATION_ARCHIVE_INVALID');
          const {unpackStaticPackage,packStaticPackage}=await import('./package-zip.mjs'),{contentHash}=await import('./package-format.mjs');
          const archive=unpackStaticPackage(bytes),resource=archive.resources[0];check(archive.resources.length===1&&resource.manifest.content.assetId===input.assetId&&resource.manifest.content.version===input.version,'PUBLICATION_ARCHIVE_INVALID');
          const content=structuredClone(resource.manifest.content);
          content.entry.publication={format:'craftmine.player-component-publication/1',scope:'local-library',source:exported.source,displayName:input.displayName,tags:input.tags,aliases:input.aliases,notes:input.notes,licenseStatus:'unverified'};
          const packed=packStaticPackage({root:{id:input.assetId,version:input.version},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files:Object.fromEntries(resource.files)}]});
          check(packed.length<=5*1024*1024,'PACKAGE_COMPONENT_TOO_LARGE');
          const archivePath=path.join(directory,key+'.zip');await fs.writeFile(archivePath,packed);await guard();
          Object.assign(entry,{status:'prepared',archiveSha256:sha(packed),archivePath,source:exported.source,files:exported.files,requiredSourceFiles:exported.requiredSourceFiles,preview:previewOf(args.preview,input.worldId)});await save(key,entry);
        }
        await guard();
        // Cancellation is accepted only before the native commit is dispatched.
        // Once committing, status/retry reconciles the actual durable receipt.
        entry.status='committing';await save(key,entry);
        const filename=input.assetId+'.zip',origin='player-component:'+sha(JSON.stringify(entry.source));
        await call('asset.import',{operationId:'player-component-'+key,sourceRoot:directory,sourcePath:entry.archivePath,assetId:input.assetId,version:input.version,kind:'object',mediaKind:'package',path:filename,mediaType:'application/x-godot-package',displayName:input.displayName,source:{origin,author:'Local player',license:'Not verified; retained source declarations are not a grant',licenseStatus:'unverified'},tags:[...new Set(['player','component','local',...input.tags,...input.aliases])].sort()});
        await call('asset.annotate',{operationId:'player-component-notes-'+key,assetId:input.assetId,displayName:input.displayName,tags:[...new Set(['player','component','local',...input.tags,...input.aliases])].sort(),notes:input.notes});
        const record=await call('asset.read',{assetId:input.assetId,version:input.version}),version=record.version_;
        check(version?.assetId===input.assetId&&version.version===input.version&&version.files?.length===1&&version.files[0].sha256===entry.archiveSha256,'PUBLICATION_IMPORT_RECEIPT_INVALID');
        let previewStatus='unavailable';
        if(entry.preview){
          const settingsHash=sha('source-world-view:'+entry.preview.sha256),begun=await call('asset.previewBegin',{assetId:input.assetId,version:input.version,settingsHash,owner:'craftmine.player-component-library'});
          if(begun.claim){const result=await call('asset.previewFinish',{operationId:'player-component-preview-'+key,assetId:input.assetId,version:input.version,settingsHash,claimId:begun.claim.claimId,attempt:begun.claim.attempt,status:'ok',detail:'Source world view; not an isolated component render or runtime verification',facts:{picture:true,decoder:'host-world-frame/1',digest:entry.preview.sha256,thumbnailBase64:entry.preview.pngBase64,mimeType:'image/png',sourceWorldId:input.worldId,sourceBuildId:entry.preview.buildId,previewScope:'source-world-view'}});if(result.applied!==false)previewStatus='source-world-view';}
          else if(begun.cached)previewStatus='source-world-view';
        }
        entry.result={status:'completed',worldId:input.worldId,operationId:input.operationId,assetRef:{assetId:input.assetId,version:input.version,contentHash:version.contentHash},source:entry.source,archiveSha256:entry.archiveSha256,files:entry.files,requiredSourceFiles:entry.requiredSourceFiles,previewStatus,applied:false};entry.status='completed';await save(key,entry);return entry.result;
      })().finally(()=>pending.delete(key));pending.set(key,running);return running;
    },
    async publishSourceStatus(args){fields(args,['worldId','operationId']);identity(args);const entry=await read(keyOf(args));return entry?projection(entry):{status:'not-found',worldId:args.worldId,operationId:args.operationId};},
    async cancelPublishSource(args){
      fields(args,['worldId','operationId']);identity(args);const key=keyOf(args),entry=await read(key);
      if(entry&&['committing','completed'].includes(entry.status))return {...projection(entry),cancelled:false};
      const cancelled=entry??{worldId:args.worldId,operationId:args.operationId};cancelled.status='cancelled';entries.set(key,cancelled);await save(key,cancelled);return {...projection(cancelled),cancelled:true};
    },
    async drain(){await Promise.allSettled([...pending.values()]);},
  };
}
module.exports={createPlayerComponentLibrary};
