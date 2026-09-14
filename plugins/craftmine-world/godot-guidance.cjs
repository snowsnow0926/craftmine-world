// Bundled product guidance. No caller-provided path ever reaches the filesystem.
'use strict';
const {createHash}=require('node:crypto');
const corpus=require('./guidance/catalog.json');
const FORMAT='craftmine.godot-guidance/1';
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const fail=(code,detail)=>{throw Object.assign(Error(code+(detail?': '+detail:'')),{errorCode:code});};
const entries=new Map(corpus.skills.map(skill=>[skill.id,skill]));
const metadata=entry=>{const {text,...rest}=entry;return rest;};
const interfaceAlias=(candidate,name)=>{const lower=candidate.toLowerCase(),bytecode=name.slice(0,-3)+'.gdc';return lower===name||lower.startsWith(name+'.')||lower===bytecode||lower.startsWith(bytecode+'.');};
const unsupported=path=>fail('GUIDANCE_INTERFACE_UNSUPPORTED',
  'Guidance source compatibility changed at '+path+'. This is not a write-permission denial. Reinspect current source and follow actual godot_project_patch/host policy; do not revert a legitimate edit just to load this recipe.');

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
  if(args.offset!==undefined&&(!Number.isSafeInteger(args.offset)||args.offset<0||args.offset>200000))fail('INVALID_GUIDANCE_PAGE','offset must be an integer from 0 to 200000 Unicode characters; omit it to start at 0, then follow nextOffset.');
  if(args.limit!==undefined&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>8000))fail('INVALID_GUIDANCE_PAGE','limit must be an integer from 1 to 8000 Unicode characters; omit it for 4000. Follow nextOffset with the same id, version, sha256, path and source pins.');
  const characters=Array.from(entry.text).length;
  if((args.offset??0)>characters)fail('INVALID_GUIDANCE_PAGE','offset exceeds this selected text (totalCharacters='+characters+'). Start at 0 or follow nextOffset; null means this text is complete.');
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
  const matches=[],interfaceMatches=[];
  for(const skill of candidates){
    const target=skill.applicability;
    // Core advances baseBuild to the applied build after adoption. Exact
    // interface hashes below retain the version gate across that lineage.
    const knownBuild=index.baseBuild===target.baseBuild||(/^gbd-[a-f0-9]{64}$/.test(index.baseBuild)&&skill.references.some(ref=>ref.requiredInterface));
    if(index.baseId!==target.baseId||!knownBuild||index.engineVersion!==target.engineVersion)continue;
    let interfaceMatch={skillId:skill.id,profile:'legacy-reference-hashes',referencePaths:{}};
    if(skill.interfaceCohorts){
      const {createProjectQuery}=require('./godot-query.cjs');
      const query=createProjectQuery({core:{call:async(method,args)=>{const result=await core.call(method,args);assertActive();return result;}},context,worldId});
      const {files,identity:cohortIdentity}=await query.allFiles({revision:index.revision,manifestHash:index.manifestHash});
      if(cohortIdentity.baseId!==index.baseId||cohortIdentity.engineVersion!==index.engineVersion)fail('GUIDANCE_SOURCE_IDENTITY_INVALID');
      const {variants,reservedPaths}=skill.interfaceCohorts;
      const adapter=files.find(file=>file.path==='craftmine_shared/base_adapter.gd');
      const bridge=files.find(file=>file.path==='craftmine_shared/runtime_bridge.gd');
      // A legacy adapter may also appear in an engine-wrapper cohort. Its
      // unchanged bytes alone must not classify a retained bare legacy world
      // as an incomplete extension; wrapper members identify that extension.
      const modern=files.some(file=>reservedPaths.some(name=>interfaceAlias(file.path,name)))||variants.some(v=>v.referencePaths['craftmine_shared/base_adapter.gd']&&v.files.find(file=>file.path===adapter?.path)?.acceptedSourceHashes.includes(adapter?.sha256)||v.referencePaths['craftmine_shared/runtime_bridge.gd']&&v.files.find(file=>file.path===bridge?.path)?.acceptedSourceHashes.includes(bridge?.sha256));
      if(modern){
        const controlled=[...new Set(variants.flatMap(v=>v.files.map(file=>file.path)))];
        const alias=files.find(file=>controlled.some(name=>file.path!==name&&interfaceAlias(file.path,name)));
        if(alias)unsupported(alias.path+' (reserved interface alias)');
        const cohort=variants.find(v=>v.files.every(expected=>files.some(file=>file.path===expected.path&&expected.acceptedSourceHashes.includes(file.sha256)))&&
          !files.some(file=>reservedPaths.includes(file.path)&&!v.files.some(expected=>expected.path===file.path)));
        if(!cohort)unsupported('craftmine_shared/base_adapter.gd (complete guidance interface cohort required)');
        interfaceMatch={skillId:skill.id,profile:cohort.profile,referencePaths:cohort.referencePaths};
      }
    }
    for(const ref of skill.references.filter(ref=>ref.requiredInterface)){
      const projectPath=interfaceMatch.referencePaths[ref.projectPath]??ref.projectPath;
      let source;
      try {source=await core.call('godotProject.read',{context,worldId,revision:index.revision,
        manifestHash:index.manifestHash,path:projectPath,offset:0,limit:1});}
      catch(error){if(String(error?.errorCode||error?.message).includes('PROJECT_FILE_NOT_FOUND'))fail('GUIDANCE_INTERFACE_MISSING');throw error;}
      assertActive();
      if(source.worldId!==worldId||source.revision!==index.revision||source.manifestHash!==index.manifestHash||source.path!==projectPath)fail('GUIDANCE_SOURCE_IDENTITY_INVALID');
      // The host verifies indexed file bytes; this is the hash of that exact source.
      if(!ref.acceptedSourceHashes.includes(source.sha256))unsupported(projectPath);
    }
    matches.push(skill);interfaceMatches.push(interfaceMatch);
  }
  const envelope={format:FORMAT,catalogVersion:corpus.version,catalogHash:hash(JSON.stringify(corpus)),
    authority:'bundled-craftmine-guidance',instructionPolicy:'reference-only-no-additional-authority',
    source:identity,provenance:corpus.provenance,requiredInterfacePolicy:corpus.requiredInterfacePolicy,interfaceMatches};
  if(!matches.length){
    if(selection)fail('GUIDANCE_BASE_UNSUPPORTED');
    return {...envelope,available:false,reason:'GUIDANCE_BASE_UNSUPPORTED',skills:[],
      supported:corpus.skills.map(skill=>skill.applicability)};
  }
  if(!selection)return {...envelope,available:true,skills:matches.map(skill=>({...metadata(skill),references:skill.references.map(metadata)})),
    guidance:'Read an exact skill id, version and sha256 with this source revision/manifestHash. Read references with their exact path and sha256. For read, limit is 1-8000 Unicode characters (default 4000); offset starts at 0. Follow nextOffset until null using the same selected text and source pins; re-catalog after source edits.'};
  const {skill,entry}=selection;
  if(hash(entry.text)!==entry.sha256)fail('GUIDANCE_BUNDLE_INTEGRITY_FAILED');
  const chars=Array.from(entry.text),offset=args.offset??0,limit=args.limit??4000;
  const text=chars.slice(offset,offset+limit).join(''),end=offset+Array.from(text).length;
  return {...envelope,id:skill.id,version:skill.version,path:entry.path,sha256:entry.sha256,
    applicability:skill.applicability,text,offset,totalCharacters:chars.length,
    nextOffset:end<chars.length?end:null,truncated:end<chars.length,
    loadRecord:{id:skill.id,version:skill.version,path:entry.path,sha256:entry.sha256,
      revision:index.revision,manifestHash:index.manifestHash,offset,characters:end-offset}};
}
module.exports={queryGuidance,validateRequest};
