// CP0 package format: strict JSON parsing, canonical content identity, path and
// kind rules, legacy kind mapping and dependency-lock validation.
//
// The canonical form is the RFC 8785 subset frozen for this product: UTF-8, no
// whitespace, object keys sorted by UTF-16 code unit sequence, arrays keep
// order, strings escape only quote, backslash and U+0000..U+001F, and numbers
// must be JSON integer literals inside the JavaScript safe range. Float
// literals are refused so Rust and JavaScript cannot disagree about a hash.
import {createHash} from 'node:crypto';

export const PACKAGE_FORMAT='craftmine.package/1';
export const RESOURCE_FORMAT='craftmine.resource/1';
export const LOCK_FORMAT='craftmine.assets-lock/1';
export const PACKAGE_KINDS=['base','world','module','object','scene','raw','data'];
const MAX_SAFE_INTEGER=9007199254740991n;
const MAX_PATH_BYTES=240;
const ASSET_ID=/^[a-z0-9][a-z0-9._-]{0,79}$/;
const HASH=/^[a-f0-9]{64}$/i;
const DEVICES=new Set(['CON','PRN','AUX','NUL',...Array.from({length:9},(_,i)=>'COM'+(i+1)),...Array.from({length:9},(_,i)=>'LPT'+(i+1))]);
const SECTIONS=['entry','interfaces','compatibility','state','licenses'];
const fail=code=>{throw Error(code);};
const requireValue=(condition,code)=>{if(!condition)fail(code);};
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const compareKeys=(left,right)=>left<right?-1:left>right?1:0;

// ---------------------------------------------------------------------------
// Strict JSON parsing (hand-written: JSON.parse silently keeps the last
// duplicate key, which would let two archives share a hash with different bytes)
// ---------------------------------------------------------------------------

class StrictParser{
  constructor(text){this.text=text;this.pos=0;}
  peek(){return this.text[this.pos];}
  skip(){while(this.pos<this.text.length&&' \t\n\r'.includes(this.text[this.pos]))this.pos++;}
  expect(character){requireValue(this.peek()===character,'INVALID_JSON');this.pos++;}
  literal(word,value){requireValue(this.text.startsWith(word,this.pos),'INVALID_JSON');this.pos+=word.length;return value;}
  value(){
    this.skip();const character=this.peek();
    if(character==='{')return this.object();
    if(character==='[')return this.array();
    if(character==='"')return this.string();
    if(character==='t')return this.literal('true',true);
    if(character==='f')return this.literal('false',false);
    if(character==='n')return this.literal('null',null);
    if(character==='-'||(character>='0'&&character<='9'))return this.number();
    fail('INVALID_JSON');
  }
  object(){
    this.expect('{');const result={};
    this.skip();
    if(this.peek()==='}'){this.pos++;return result;}
    for(;;){
      this.skip();const key=this.string();this.skip();this.expect(':');
      const value=this.value();
      requireValue(!Object.prototype.hasOwnProperty.call(result,key),'PACKAGE_DUPLICATE_KEY');
      result[key]=value;
      this.skip();const character=this.peek();
      if(character===','){this.pos++;continue;}
      if(character==='}'){this.pos++;return result;}
      fail('INVALID_JSON');
    }
  }
  array(){
    this.expect('[');const result=[];
    this.skip();
    if(this.peek()===']'){this.pos++;return result;}
    for(;;){
      result.push(this.value());
      this.skip();const character=this.peek();
      if(character===','){this.pos++;continue;}
      if(character===']'){this.pos++;return result;}
      fail('INVALID_JSON');
    }
  }
  string(){
    this.expect('"');let result='';
    for(;;){
      const character=this.peek();
      if(character===undefined)fail('INVALID_JSON');
      if(character==='"'){this.pos++;return result;}
      if(character==='\\'){
        this.pos++;const escape=this.peek();this.pos++;
        if(escape==='"'){result+='"';continue;}
        if(escape==='\\'){result+='\\';continue;}
        if(escape==='/'){result+='/';continue;}
        if(escape==='b'){result+='\b';continue;}
        if(escape==='f'){result+='\f';continue;}
        if(escape==='n'){result+='\n';continue;}
        if(escape==='r'){result+='\r';continue;}
        if(escape==='t'){result+='\t';continue;}
        requireValue(escape==='u','INVALID_JSON');
        const first=this.hex4();
        if(first>=0xd800&&first<0xdc00){
          requireValue(this.peek()==='\\'&&this.text[this.pos+1]==='u','INVALID_JSON');
          this.pos+=2;
          const second=this.hex4();
          requireValue(second>=0xdc00&&second<0xe000,'INVALID_JSON');
          result+=String.fromCodePoint(0x10000+((first-0xd800)<<10)+(second-0xdc00));
          continue;
        }
        requireValue(!(first>=0xdc00&&first<0xe000),'INVALID_JSON');
        result+=String.fromCharCode(first);
        continue;
      }
      requireValue(character>=' ','INVALID_JSON');
      result+=character;this.pos++;
    }
  }
  hex4(){
    const text=this.text.slice(this.pos,this.pos+4);
    requireValue(/^[0-9a-fA-F]{4}$/.test(text),'INVALID_JSON');
    this.pos+=4;
    return parseInt(text,16);
  }
  number(){
    const start=this.pos;
    if(this.peek()==='-')this.pos++;
    const digits=this.pos;
    while(this.peek()>='0'&&this.peek()<='9')this.pos++;
    requireValue(this.pos>digits,'INVALID_JSON');
    requireValue(!(this.text[digits]==='0'&&this.pos>digits+1),'INVALID_JSON');
    const next=this.peek();
    requireValue(next!=='.'&&next!=='e'&&next!=='E','PACKAGE_FLOAT_NOT_CANONICAL');
    const value=BigInt(this.text.slice(start,this.pos));
    requireValue(value<=MAX_SAFE_INTEGER&&value>=-MAX_SAFE_INTEGER,'PACKAGE_NUMBER_OUT_OF_RANGE');
    return Number(value);
  }
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

const escapeString=value=>{
  let out='';
  for(const character of value){
    if(character==='"')out+='\\"';
    else if(character==='\\')out+='\\\\';
    else if(character==='\b')out+='\\b';
    else if(character==='\f')out+='\\f';
    else if(character==='\n')out+='\\n';
    else if(character==='\r')out+='\\r';
    else if(character==='\t')out+='\\t';
    else if(character<' ')out+='\\u'+character.charCodeAt(0).toString(16).padStart(4,'0');
    else out+=character;
  }
  return out;
};
const canonicalInto=(value,out)=>{
  if(value===null){out.push('null');return;}
  if(value===true){out.push('true');return;}
  if(value===false){out.push('false');return;}
  if(typeof value==='number'){
    requireValue(Number.isInteger(value),'PACKAGE_FLOAT_NOT_CANONICAL');
    requireValue(Number.isSafeInteger(value),'PACKAGE_NUMBER_OUT_OF_RANGE');
    out.push(Object.is(value,-0)?'0':String(value));
    return;
  }
  if(typeof value==='string'){out.push('"'+escapeString(value)+'"');return;}
  if(Array.isArray(value)){
    out.push('[');
    value.forEach((item,index)=>{if(index)out.push(',');canonicalInto(item,out);});
    out.push(']');
    return;
  }
  if(isObject(value)){
    const keys=Object.keys(value).sort(compareKeys);
    out.push('{');
    keys.forEach((key,index)=>{if(index)out.push(',');out.push('"'+escapeString(key)+'":');canonicalInto(value[key],out);});
    out.push('}');
    return;
  }
  fail('INVALID_JSON');
};

export function canonicalJSON(text){
  requireValue(typeof text==='string','INVALID_JSON');
  const parser=new StrictParser(text),value=parser.value();
  parser.skip();
  requireValue(parser.pos===text.length,'INVALID_JSON');
  return canonicalValue(value);
}
export function canonicalValue(value){
  const out=[];
  canonicalInto(value,out);
  return out.join('');
}
export function contentHash(value){return createHash('sha256').update(canonicalValue(value)).digest('hex');}

// ---------------------------------------------------------------------------
// Paths, kinds and legacy mapping
// ---------------------------------------------------------------------------

export function validatePath(path){
  requireValue(typeof path==='string'&&path.length>0&&Buffer.byteLength(path)<=MAX_PATH_BYTES,'INVALID_PACKAGE_PATH');
  requireValue(!path.includes('\\')&&!path.includes(':')&&!path.startsWith('/')&&!path.endsWith('/'),'INVALID_PACKAGE_PATH');
  for(const segment of path.split('/')){
    requireValue(segment.length>0&&segment!=='.'&&segment!=='..','INVALID_PACKAGE_PATH');
    requireValue(!DEVICES.has(segment.split('.')[0].toUpperCase()),'INVALID_PACKAGE_PATH');
  }
  return path;
}
export function validateEntries(paths){
  requireValue(Array.isArray(paths),'INVALID_PACKAGE_PATH');
  const seen=new Set();
  for(const path of paths){
    validatePath(path);
    const folded=path.normalize('NFC').toLowerCase();
    requireValue(!seen.has(folded),'PACKAGE_DUPLICATE_ENTRY');
    seen.add(folded);
  }
  return [...paths].sort(compareKeys);
}
export function validateKind(kind){
  requireValue(typeof kind==='string'&&PACKAGE_KINDS.includes(kind),'INVALID_PACKAGE_KIND');
  return kind;
}

const LEGACY_KINDS={object:'object',gameplay:'module',scene:'scene',raw:'raw',data:'data','world-template':'world',base:'base'};
const LEGACY_FORMATS=new Set(['craftmine.module/1','craftmine.module/2','craftmine.module/3','craftmine.module/4']);
export function legacyKind(source){
  requireValue(isObject(source),'PACKAGE_LEGACY_FORMAT_UNKNOWN');
  requireValue(LEGACY_FORMATS.has(source.format),'PACKAGE_LEGACY_FORMAT_UNKNOWN');
  if(source.kind==='creation')return {ambiguous:['module','object','scene','world']};
  requireValue(Object.prototype.hasOwnProperty.call(LEGACY_KINDS,source.kind),'PACKAGE_LEGACY_FORMAT_UNKNOWN');
  return {kind:LEGACY_KINDS[source.kind]};
}

// ---------------------------------------------------------------------------
// Shared field and reference helpers
// ---------------------------------------------------------------------------

const fields=(value,allowed)=>{
  requireValue(isObject(value),'OBJECT_REQUIRED');
  requireValue(Object.keys(value).every(key=>allowed.includes(key)),'UNKNOWN_FIELD');
};
const hashField=(value,key)=>{
  const text=value[key];
  requireValue(typeof text==='string','HASH_REQUIRED');
  requireValue(HASH.test(text),'INVALID_HASH');
  return text.toLowerCase();
};
const reference=value=>{
  requireValue(isObject(value),'OBJECT_REQUIRED');
  const id=value.id,version=value.version;
  requireValue(typeof id==='string'&&ASSET_ID.test(id),'INVALID_ASSET_ID');
  requireValue(Number.isInteger(version)&&version>=1&&version<=100000,'INVALID_VERSION');
  return {id,version};
};
const assetReference=value=>{
  fields(value,['id','version','sha256']);
  const {id,version}=reference(value);
  return {id,version,sha256:hashField(value,'sha256')};
};
const fileReference=value=>{
  fields(value,['path','bytes','sha256']);
  const path=validatePath(value.path);
  requireValue(Number.isInteger(value.bytes)&&value.bytes>=0,'BYTES_REQUIRED');
  return {path,bytes:value.bytes,sha256:hashField(value,'sha256')};
};

// ---------------------------------------------------------------------------
// Dependency lock
// ---------------------------------------------------------------------------

// The lock must contain exactly the reachable closure of the direct refs, with
// one version per assetId and no cycle.
export function validateLock(lock){
  requireValue(isObject(lock),'OBJECT_REQUIRED');
  const direct=lock.direct,closure=lock.closure,graph=lock.graph??{};
  requireValue(Array.isArray(direct),'LOCK_DIRECT_REQUIRED');
  requireValue(Array.isArray(closure),'LOCK_CLOSURE_REQUIRED');
  requireValue(isObject(graph),'LOCK_GRAPH_REQUIRED');
  const versions=new Map(),available=new Set();
  for(const item of closure){
    const {id,version}=reference(item),label=`${id}@${version}`;
    const existing=versions.get(id);
    if(existing===undefined)versions.set(id,version);
    else requireValue(existing===version,'PACKAGE_LOCK_VERSION_CONFLICT');
    available.add(label);
  }
  const roots=[];
  for(const item of direct){
    const {id,version}=reference(item),label=`${id}@${version}`;
    requireValue(available.has(label),'PACKAGE_LOCK_MISSING_DEPENDENCY');
    roots.push(label);
  }
  const reachable=new Set(),stack=roots.map(root=>[root,[]]);
  while(stack.length){
    const [node,path]=stack.pop();
    requireValue(!path.includes(node),'PACKAGE_DEPENDENCY_CYCLE');
    if(reachable.has(node))continue;
    reachable.add(node);
    const next=[...path,node],edges=Array.isArray(graph[node])?graph[node]:[];
    for(const edge of edges){
      requireValue(typeof edge==='string','LOCK_GRAPH_REQUIRED');
      requireValue(available.has(edge),'PACKAGE_LOCK_MISSING_DEPENDENCY');
      stack.push([edge,next]);
    }
  }
  requireValue(reachable.size===available.size,'PACKAGE_LOCK_UNREACHABLE_ENTRY');
  return {ok:true};
}

// ---------------------------------------------------------------------------
// Resource manifest and package.json
// ---------------------------------------------------------------------------

const CONTENT_KEYS=['assetId','version','kind','files','dependencies',...SECTIONS];

export function validateResourceManifest(manifest){
  fields(manifest,['format','content','contentHash']);
  requireValue(manifest.format===RESOURCE_FORMAT,'INVALID_RESOURCE_FORMAT');
  const content=manifest.content;
  fields(content,CONTENT_KEYS);
  const {id:assetId,version}=reference({id:content.assetId,version:content.version});
  const kind=validateKind(content.kind);
  requireValue(Array.isArray(content.files),'FILES_REQUIRED');
  const files=content.files.map(fileReference);
  validateEntries(files.map(file=>file.path));
  requireValue(Array.isArray(content.dependencies),'DEPENDENCIES_REQUIRED');
  const seen=new Set();
  const dependencies=content.dependencies.map(item=>{
    const dependency=assetReference(item);
    requireValue(dependency.id!==assetId,'PACKAGE_SELF_DEPENDENCY');
    const label=`${dependency.id}@${dependency.version}`;
    requireValue(!seen.has(label),'PACKAGE_DUPLICATE_DEPENDENCY');
    seen.add(label);
    return dependency;
  });
  for(const key of SECTIONS)requireValue(isObject(content[key]),'RESOURCE_SECTION_REQUIRED');
  const normalized={assetId,version,kind,files,dependencies,...Object.fromEntries(SECTIONS.map(key=>[key,content[key]]))};
  const expected=contentHash(normalized);
  requireValue(manifest.contentHash===expected,'RESOURCE_CONTENT_HASH_MISMATCH');
  return {format:RESOURCE_FORMAT,content:normalized,contentHash:expected};
}

// `entryPaths` is the archive's actual entry list, so an unlisted or missing
// file is refused instead of being silently accepted.
export function validatePackageJson(pkg,entryPaths){
  fields(pkg,['format','root','resources','files','archiveSha256','bytes']);
  requireValue(pkg.format===PACKAGE_FORMAT,'INVALID_PACKAGE_FORMAT');
  if(pkg.archiveSha256!==undefined)hashField(pkg,'archiveSha256');
  if(pkg.bytes!==undefined)requireValue(Number.isInteger(pkg.bytes)&&pkg.bytes>=0,'BYTES_REQUIRED');
  const root=assetReference(pkg.root);
  requireValue(Array.isArray(pkg.resources),'RESOURCES_REQUIRED');
  const declared=new Set(),manifests=new Set();
  const resources=pkg.resources.map(resource=>{
    fields(resource,['contentHash','manifest','files']);
    const contentHash=hashField(resource,'contentHash');
    const manifest=validateResourceManifest(resource.manifest);
    requireValue(manifest.contentHash===contentHash,'RESOURCE_CONTENT_HASH_MISMATCH');
    requireValue(Array.isArray(resource.files),'FILES_REQUIRED');
    const prefix=`resources/${contentHash}/`;
    const files=resource.files.map(item=>{
      const file=fileReference(item);
      requireValue(file.path.startsWith(prefix),'PACKAGE_RESOURCE_PATH_MISMATCH');
      requireValue(!declared.has(file.path),'PACKAGE_DUPLICATE_ENTRY');
      declared.add(file.path);
      return file;
    });
    const manifestPath=prefix+'manifest.json';
    declared.add(manifestPath);manifests.add(manifestPath);
    return {contentHash,manifest,files};
  });
  requireValue(Array.isArray(pkg.files),'FILES_REQUIRED');
  const listed=new Set();
  const files=pkg.files.map(item=>{
    const file=fileReference(item);
    requireValue(!listed.has(file.path),'PACKAGE_DUPLICATE_ENTRY');
    listed.add(file.path);
    requireValue(declared.has(file.path),'PACKAGE_FILE_NOT_IN_ENTRIES');
    return file;
  });
  requireValue(Array.isArray(entryPaths),'INVALID_PACKAGE_PATH');
  const entries=entryPaths.filter(path=>path!=='package.json');
  for(const path of entries){
    requireValue(listed.has(path)||manifests.has(path),'PACKAGE_ENTRY_NOT_LISTED');
    requireValue(declared.has(path),'PACKAGE_ENTRY_NOT_LISTED');
  }
  for(const path of listed)requireValue(entries.includes(path),'PACKAGE_FILE_NOT_IN_ENTRIES');
  for(const path of declared)requireValue(entries.includes(path),'PACKAGE_FILE_NOT_IN_ENTRIES');
  return {format:PACKAGE_FORMAT,root,resources,files,entryCount:entries.length};
}
