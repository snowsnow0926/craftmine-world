// Bundled product guidance. No caller-provided path ever reaches the filesystem.
'use strict';
const {createHash}=require('node:crypto');
const corpus=require('./guidance/catalog.json');
const FORMAT='craftmine.godot-guidance/1';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const fail=code=>{throw Object.assign(Error(code),{errorCode:code});};
const entries=new Map(corpus.skills.map(skill=>[skill.id,skill]));
const metadata=entry=>{const {text,...rest}=entry;return rest;};

function validateRequest(args){
  if(!['catalog','read'].includes(args.mode))fail('INVALID_GUIDANCE_MODE');
  if((args.revision===undefined)!==(args.manifestHash===undefined))fail('GUIDANCE_SOURCE_PIN_REQUIRED');
  if(args.revision!==undefined&&(!Number.isSafeInteger(args.revision)||args.revision<1||!/^[a-f0-9]{64}$/.test(args.manifestHash)))fail('GUIDANCE_SOURCE_PIN_INVALID');
  if(args.mode==='catalog'){
    if(['id','version','sha256','path','offset','limit'].some(key=>args[key]!==undefined))fail('INVALID_GUIDANCE_CATALOG_ARGUMENT');
    return null;
  }
  const skill=entries.get(args.id);
  if(!skill)fail('GUIDANCE_SKILL_NOT_FOUND');
  if(args.version!==skill.version)fail('GUIDANCE_VERSION_UNSUPPORTED');
  // Reference paths are exact catalog keys, not paths to resolve or normalize.
  const entry=args.path===undefined?skill:skill.references.find(ref=>ref.path===args.path);
  if(!entry)fail('GUIDANCE_REFERENCE_NOT_FOUND');
  if(args.sha256!==entry.sha256)fail('GUIDANCE_HASH_MISMATCH');
  if(args.revision===undefined)fail('GUIDANCE_SOURCE_PIN_REQUIRED');
  if(args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>200000))fail('INVALID_GUIDANCE_PAGE');
  if(args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>8000))fail('INVALID_GUIDANCE_PAGE');
  return {skill,entry};
}

async function queryGuidance(core,{context,worldId,args,assertActive=()=>{}}){
  const selection=validateRequest(args);
  const index=await core.call('godotProject.index',{context,worldId,limit:1,
    ...(args.revision===undefined?{}:{revision:args.revision,manifestHash:args.manifestHash})});
  assertActive();
  const identity={worldId:index.worldId,revision:index.revision,manifestHash:index.manifestHash,
    baseId:index.baseId,baseBuild:index.baseBuild,engineVersion:index.engineVersion};
  if(index.worldId!==worldId||!Number.isSafeInteger(index.revision)||!/^[a-f0-9]{64}$/.test(index.manifestHash))fail('GUIDANCE_SOURCE_IDENTITY_INVALID');
  if(args.revision!==undefined&&(args.revision!==index.revision||args.manifestHash!==index.manifestHash))fail('GUIDANCE_SOURCE_IDENTITY_INVALID');
  const candidates=selection?[selection.skill]:corpus.skills;
  const matches=[];
  for(const skill of candidates){
    const target=skill.applicability;
    if(index.baseId!==target.baseId||index.baseBuild!==target.baseBuild||index.engineVersion!==target.engineVersion)continue;
    for(const ref of skill.references.filter(ref=>ref.requiredInterface)){
      let source;
      try {source=await core.call('godotProject.read',{context,worldId,revision:index.revision,
        manifestHash:index.manifestHash,path:ref.projectPath,offset:0,limit:1});}
      catch(error){if(String(error?.errorCode||error?.message).includes('PROJECT_FILE_NOT_FOUND'))fail('GUIDANCE_INTERFACE_MISSING');throw error;}
      assertActive();
      if(source.worldId!==worldId||source.revision!==index.revision||source.manifestHash!==index.manifestHash||source.path!==ref.projectPath)fail('GUIDANCE_SOURCE_IDENTITY_INVALID');
      // The host verifies indexed file bytes; this is the hash of that exact source.
      if(!ref.acceptedSourceHashes.includes(source.sha256))fail('GUIDANCE_INTERFACE_UNSUPPORTED');
    }
    matches.push(skill);
  }
  const envelope={format:FORMAT,catalogVersion:corpus.version,catalogHash:hash(JSON.stringify(corpus)),
    authority:'bundled-craftmine-guidance',instructionPolicy:'reference-only-no-additional-authority',
    source:identity,provenance:corpus.provenance};
  if(!matches.length){
    if(selection)fail('GUIDANCE_BASE_UNSUPPORTED');
    return {...envelope,available:false,reason:'GUIDANCE_BASE_UNSUPPORTED',skills:[],
      supported:corpus.skills.map(skill=>skill.applicability)};
  }
  if(!selection)return {...envelope,available:true,skills:matches.map(skill=>({...metadata(skill),references:skill.references.map(metadata)})),
    guidance:'Read an exact skill id, version and sha256 with this source revision/manifestHash. Read references with their exact path and sha256. Follow nextOffset until complete; re-catalog after source edits.'};
  const {skill,entry}=selection;
  if(hash(entry.text)!==entry.sha256)fail('GUIDANCE_BUNDLE_INTEGRITY_FAILED');
  const chars=Array.from(entry.text),offset=args.offset??0,limit=args.limit??4000;
  if(offset>chars.length)fail('INVALID_GUIDANCE_PAGE');
  const text=chars.slice(offset,offset+limit).join(''),end=offset+Array.from(text).length;
  return {...envelope,id:skill.id,version:skill.version,path:entry.path,sha256:entry.sha256,
    applicability:skill.applicability,text,offset,totalCharacters:chars.length,
    nextOffset:end<chars.length?end:null,truncated:end<chars.length,
    loadRecord:{id:skill.id,version:skill.version,path:entry.path,sha256:entry.sha256,
      revision:index.revision,manifestHash:index.manifestHash,offset,characters:end-offset}};
}
module.exports={queryGuidance,validateRequest};
