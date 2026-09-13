// Imports only the immutable packages shipped with the product into the existing
// asset catalog. No player path, world source, or installed instance is changed.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
function loadBuiltinPackages(directory){
  const root=fs.realpathSync(directory),catalogPath=path.join(root,'catalog.json');
  if(fs.statSync(catalogPath).size>262144)fail('BUILTIN_CATALOG_TOO_LARGE');
  const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
  if(catalog.format!=='craftmine.builtin-source-library/1'||!Array.isArray(catalog.entries)||catalog.entries.length>64)fail('BUILTIN_CATALOG_INVALID');
  const ids=new Set();
  const entries=catalog.entries.map(entry=>{
    const model=entry?.mediaKind==='model';
    if(!entry||!/^cw\.[a-z0-9._-]{1,72}$/.test(entry.assetId)||!Number.isSafeInteger(entry.version)||entry.version<1||!['object','scene','module'].includes(entry.kind)||
      (entry.mediaKind!==undefined&&!['model','package'].includes(entry.mediaKind))||(model?entry.kind!=='object'||!/^[a-z0-9._-]+\.glb$/.test(entry.file):!/^[a-z0-9._-]+\.zip$/.test(entry.file))||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>8*1024*1024||!/^([a-f0-9]{64})$/.test(entry.sha256)||
      typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>120||!Array.isArray(entry.tags)||entry.tags.length>32||entry.tags.some(tag=>typeof tag!=='string'||!tag.trim()||Buffer.byteLength(tag)>40)||
      !entry.source||['origin','author','license','licenseStatus'].some(key=>typeof entry.source[key]!=='string'||!entry.source[key].trim()))fail('BUILTIN_ENTRY_INVALID');
    const key=entry.assetId+'@'+entry.version;if(ids.has(key))fail('BUILTIN_ENTRY_DUPLICATE');ids.add(key);
    const filename=path.join(root,entry.file),stat=fs.lstatSync(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||path.dirname(fs.realpathSync(filename))!==root||stat.size!==entry.bytes)fail('BUILTIN_PACKAGE_INVALID');
    if(hash(fs.readFileSync(filename))!==entry.sha256)fail('BUILTIN_PACKAGE_HASH_MISMATCH');
    return {...entry,filename};
  });
  return {root,entries};
}
function matches(record,entry){
  const version=record?.version_,files=version?.files;
  return version?.assetId===entry.assetId&&version.version===entry.version&&version.kind===entry.kind&&version.mediaKind===(entry.mediaKind??'package')&&Array.isArray(files)&&files.length===1&&
    files[0].path===entry.file&&files[0].sha256===entry.sha256&&files[0].bytes===entry.bytes&&files[0].mediaType===(entry.mediaKind==='model'?'model/gltf-binary':'application/x-godot-package');
}
async function seedBuiltinSourceLibrary({directory,call}){
  if(typeof call!=='function')fail('BUILTIN_CORE_REQUIRED');
  // Verify the whole product inventory before importing any entry.
  const {root,entries}=loadBuiltinPackages(directory);
  const result={format:'craftmine.builtin-source-library-status/1',imported:[],existing:[],conflicts:[]};
  for(const entry of entries){
    let record;
    try{record=await call('asset.read',{assetId:entry.assetId,version:entry.version});}
    catch(error){if(![error.errorCode,error.code,error.message].includes('ASSET_NOT_FOUND'))throw error;}
    if(record){
      if(matches(record,entry))result.existing.push(entry.assetId);
      else result.conflicts.push({assetId:entry.assetId,version:entry.version,reason:'BUILTIN_VERSION_CONFLICT'});
      continue;
    }
    await call('asset.import',{operationId:'builtin-'+entry.sha256,sourceRoot:root,sourcePath:entry.filename,assetId:entry.assetId,version:entry.version,kind:entry.kind,
      mediaKind:entry.mediaKind??'package',path:entry.file,mediaType:entry.mediaKind==='model'?'model/gltf-binary':'application/x-godot-package',displayName:entry.label,source:entry.source,tags:entry.tags});
    const imported=await call('asset.read',{assetId:entry.assetId,version:entry.version});
    if(!matches(imported,entry))fail('BUILTIN_IMPORT_RECEIPT_MISMATCH');
    result.imported.push(entry.assetId);
  }
  return result;
}
module.exports={loadBuiltinPackages,seedBuiltinSourceLibrary};
