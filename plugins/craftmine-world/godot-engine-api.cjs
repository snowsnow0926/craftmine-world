'use strict';
// Fixed, measured engine metadata. No engine invocation or project loading on
// the query path. The caller may supply a host-owned installation directory;
// query arguments cannot choose a filesystem path or executable.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const VERSION='4.7.2-stable';
const ENGINE_SHA256='ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424';
const FORMAT='craftmine.godot-engine-api-query/1';
const COLLECTIONS={method:'methods',property:'properties',signal:'signals',enum:'enums',constant:'constants'};
const LIMITATIONS=[
  'Reflection metadata, not full API documentation, examples or semantic gameplay validation.',
  'Only ClassDB classes registered in the headless script context of the pinned editor binary. Additional editor-session classes, Variant builtins, GDScript globals and project-defined classes are not covered.',
  'An editor-binary declaration does not establish Web export availability, sandbox permission or renderer support.',
  'Default arguments use Godot Variant text; object defaults are intentionally not serialized.'
];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const serialize=value=>JSON.stringify(canonical(value))+'\n';
const fail=reason=>{throw Object.assign(Error(reason),{errorCode:reason});};
const clone=value=>JSON.parse(JSON.stringify(value));
const compare=(a,b)=>a<b?-1:a>b?1:0;

function createEngineApi({directory=path.join(__dirname,'engine-api',VERSION)}={}){
  let loaded;
  function load(){
    if(loaded)return loaded;
    let index,data,bytes;
    try{
      index=JSON.parse(fs.readFileSync(path.join(directory,'index.json'),'utf8'));
      bytes=fs.readFileSync(path.join(directory,'classdb.json'));
      data=JSON.parse(bytes.toString('utf8'));
    }catch(error){fail(error.code==='ENOENT'?'ENGINE_API_METADATA_MISSING':'ENGINE_API_METADATA_INVALID');}
    if(index.format!=='craftmine.godot-engine-api-index/1'||data.format!=='craftmine.godot-engine-api-data/1'
      ||index.dataFile!=='classdb.json'||index.engineVersion!==VERSION||data.engineVersion!==VERSION
      ||index.dataBytes!==bytes.length||index.dataSha256!==hash(bytes)||index.engineSha256!==data.engineSha256
      ||index.engineSha256!==ENGINE_SHA256||index.extractorSha256!==data.extractorSha256||!Array.isArray(data.classes)||!data.classes.length
      ||Object.keys(index.classes||{}).length!==data.classes.length)fail('ENGINE_API_METADATA_INTEGRITY_MISMATCH');
    const classes=new Map();
    for(const [offset,entry] of data.classes.entries()){
      if(!entry||typeof entry.name!=='string'||classes.has(entry.name)||!Object.values(COLLECTIONS).every(key=>Array.isArray(entry[key])))fail('ENGINE_API_METADATA_INVALID');
      const indexed=index.classes[entry.name];
      if(indexed?.offset!==offset||indexed.sha256!==hash(serialize(entry))||indexed.inherits!==entry.inherits)fail('ENGINE_API_METADATA_INTEGRITY_MISMATCH');
      classes.set(entry.name,entry);
    }
    for(const entry of classes.values()){
      const seen=new Set([entry.name]);let parent=entry.inherits;
      while(parent){if(seen.has(parent)||!classes.has(parent))fail('ENGINE_API_INHERITANCE_INVALID');seen.add(parent);parent=classes.get(parent).inherits;}
    }
    loaded={index,data,classes};return loaded;
  }
  function ancestors(name,classes){
    const result=[];let parent=classes.get(name).inherits;
    while(parent){result.push(parent);parent=classes.get(parent).inherits;}
    return result;
  }
  function members(name,classes,inherited=true,kind){
    const rows=[],seen=new Set();
    for(const owner of [name,...(inherited?ancestors(name,classes):[])]){
      const entry=classes.get(owner);
      for(const [memberKind,collection] of Object.entries(COLLECTIONS)){
        if(kind&&kind!==memberKind)continue;
        for(const member of entry[collection]){
          const id=memberKind+':'+member.name;
          if(seen.has(id))continue;seen.add(id);
          rows.push({kind:memberKind,name:member.name,declaredIn:owner,inherited:owner!==name,metadata:member});
        }
      }
    }
    return rows.sort((a,b)=>compare(a.kind,b.kind)||compare(a.name,b.name));
  }
  function query(args={}){
    if(!args||typeof args!=='object'||Array.isArray(args))fail('ENGINE_API_QUERY_INVALID');
    const allowed=['mode','className','memberName','kind','query','offset','limit','inherited','engineVersion','corpusHash'];
    if(Object.keys(args).some(key=>!allowed.includes(key)))fail('ENGINE_API_QUERY_UNKNOWN_FIELD');
    const {mode='info',offset=0,limit=20,inherited=true}=args;
    if(!['info','class','member','search'].includes(mode)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof inherited!=='boolean')fail('ENGINE_API_QUERY_INVALID');
    if(args.kind!==undefined&&!Object.hasOwn(COLLECTIONS,args.kind)&&!(mode==='search'&&args.kind==='class'))fail('ENGINE_API_QUERY_KIND_INVALID');
    for(const key of ['className','memberName','query','engineVersion','corpusHash'])if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key].trim()||args[key].length>160))fail('ENGINE_API_QUERY_INVALID');
    if(offset>0&&(!args.engineVersion||!args.corpusHash))fail('ENGINE_API_CONTINUATION_PIN_REQUIRED');
    const envelope={format:FORMAT,provenance:'pinned-engine-classdb',limitations:LIMITATIONS.slice()};
    const unknown=(reason,extra={})=>({...envelope,status:'unknown',available:false,reason,...extra});
    if(args.engineVersion&&args.engineVersion!==VERSION)return unknown('ENGINE_API_VERSION_NOT_INSTALLED',{requestedVersion:args.engineVersion,installedVersion:VERSION});
    let catalog;
    try{catalog=load();}catch(error){return unknown(error.errorCode||'ENGINE_API_METADATA_INVALID');}
    const {index,data,classes}=catalog;
    envelope.pin={engineVersion:VERSION,corpusHash:index.dataSha256};
    envelope.engineSha256=index.engineSha256;envelope.actualVersion=index.actualVersion;
    if(args.corpusHash&&args.corpusHash!==index.dataSha256)return unknown('ENGINE_API_METADATA_PIN_MISMATCH');
    const page=rows=>{
      if(offset>rows.length)fail('ENGINE_API_QUERY_PAGE_INVALID');
      const items=rows.slice(offset,offset+limit),nextOffset=offset+items.length<rows.length?offset+items.length:null;
      return {...envelope,status:'known',available:true,items,offset,nextOffset,total:rows.length,
        pageComplete:true,complete:offset===0&&nextOffset===null};
    };
    if(mode==='info')return clone({...envelope,status:'known',available:true,coverage:data.coverage,
      metadataBytes:index.dataBytes,extractorSha256:index.extractorSha256,environment:data.environment,
      modes:['info','class','member','search'],kinds:['class',...Object.keys(COLLECTIONS)]});
    if(mode==='class'||mode==='member'){
      if(!args.className)fail('ENGINE_API_CLASS_REQUIRED');
      const entry=classes.get(args.className);
      if(!entry)return unknown('CLASS_NOT_IN_RUNTIME_METADATA',{className:args.className,engineSupport:'unknown'});
      const common={className:entry.name,inherits:entry.inherits,ancestors:ancestors(entry.name,classes),apiType:entry.apiType,enabled:entry.enabled,instantiable:entry.instantiable};
      const rows=members(entry.name,classes,inherited,args.kind);
      if(mode==='member'){
        if(!args.memberName)fail('ENGINE_API_MEMBER_REQUIRED');
        const matching=rows.filter(row=>row.name===args.memberName);
        if(!matching.length)return unknown('MEMBER_NOT_IN_RUNTIME_METADATA',{...common,memberName:args.memberName,engineSupport:'unknown'});
        return clone({...page(matching),...common});
      }
      return clone({...page(rows),...common});
    }
    const term=args.query?.trim().toLowerCase();if(!term)fail('ENGINE_API_SEARCH_REQUIRED');
    if(args.className&&!classes.has(args.className))return unknown('CLASS_NOT_IN_RUNTIME_METADATA',{className:args.className,engineSupport:'unknown'});
    const rows=[];
    for(const entry of classes.values()){
      if(args.className&&entry.name!==args.className)continue;
      if((!args.kind||args.kind==='class')&&entry.name.toLowerCase().includes(term))rows.push({kind:'class',name:entry.name,className:entry.name,inherits:entry.inherits});
      if(args.kind==='class')continue;
      // Global search lists each declaration once. A class filter may include
      // its inherited surface with declaredIn attribution.
      for(const member of members(entry.name,classes,!!args.className&&inherited,args.kind)){
        if(member.name.toLowerCase().includes(term))rows.push({kind:member.kind,name:member.name,className:entry.name,declaredIn:member.declaredIn,inherited:member.inherited});
      }
    }
    rows.sort((a,b)=>compare(a.className,b.className)||compare(a.kind,b.kind)||compare(a.name,b.name));
    return clone({...page(rows),query:args.query,searchScope:args.className?'class-surface':'declared-members'});
  }
  return {query};
}
const defaultApi=createEngineApi();
module.exports={createEngineApi,queryEngineApi:args=>defaultApi.query(args),VERSION,FORMAT};
