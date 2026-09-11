import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment,godotLock} from '../desktop/godot/toolchain.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const serialize=value=>JSON.stringify(canonical(value))+'\n';
const order=(a,b)=>a.name<b.name?-1:a.name>b.name?1:0;
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(arg=>arg!=='--check'))throw Error('Only --check is supported; project/script paths are fixed.');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results','godot-engine-api-'));
const project=path.join(out,'trusted-reflection');fs.mkdirSync(project);
const script=fs.readFileSync(path.join(root,'scripts/godot-engine-api-dump.gd'),'utf8').replace(/\r\n/g,'\n');
fs.writeFileSync(path.join(project,'project.godot'),'config_version=5\n[application]\nconfig/name="Craftmine trusted API reflection"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.writeFileSync(path.join(project,'dump.gd'),script);
const probe=await createGodotProbeEnvironment(out);
await probe.run('classdb-dump',['--path',project,'--script','res://dump.gd']);
const raw=JSON.parse(fs.readFileSync(path.join(project,'classdb-raw.json'),'utf8'));
if(raw.headless!==true||!raw.classes?.length)throw Error('EMPTY_ENGINE_API_DUMP');
for(const entry of raw.classes){
  for(const key of ['methods','properties','signals','enums','constants'])entry[key].sort(order);
  for(const entryEnum of entry.enums)entryEnum.constants.sort();
}
raw.classes.sort(order);
const coverage={classes:raw.classes.length};
for(const key of ['methods','properties','signals','enums','constants'])coverage[key]=raw.classes.reduce((total,entry)=>total+entry[key].length,0);
const metadata={format:'craftmine.godot-engine-api-data/1',engineVersion:godotLock.version,
  actualVersion:probe.actualVersion,engineSha256:godotLock.editor.executableSha256,
  extractorSha256:hash(script),source:'pinned-engine-classdb',environment:'trusted-empty-project/editor-binary-runtime/headless',
  coverage,classes:raw.classes};
const dataBytes=serialize(metadata);
const index={format:'craftmine.godot-engine-api-index/1',engineVersion:metadata.engineVersion,
  actualVersion:metadata.actualVersion,engineSha256:metadata.engineSha256,extractorSha256:metadata.extractorSha256,
  dataFile:'classdb.json',dataSha256:hash(dataBytes),dataBytes:Buffer.byteLength(dataBytes),coverage,
  classes:Object.fromEntries(metadata.classes.map((entry,offset)=>[entry.name,{offset,sha256:hash(serialize(entry)),inherits:entry.inherits}]))};
const directory=path.join(root,'plugins/craftmine-world/engine-api',godotLock.version);
const outputs={'classdb.json':dataBytes,'index.json':serialize(index)};
for(const [file,bytes] of Object.entries(outputs)){
  if(check){if(fs.readFileSync(path.join(directory,file),'utf8')!==bytes)throw Error('ENGINE_API_NOT_REPRODUCIBLE: '+file);}
  else {fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,file),bytes);}
}
const report={passed:true,reproducibilityCheck:check,engineVersion:metadata.actualVersion,engineSha256:metadata.engineSha256,
  dataSha256:index.dataSha256,dataBytes:index.dataBytes,indexBytes:Buffer.byteLength(outputs['index.json']),coverage,runs:probe.runs,
  limitations:['ClassDB metadata registered in headless script context only; no manual text or tutorials','Additional editor-session classes and builtin Variant types are outside this dump','Editor binary inventory does not establish Web runtime support','No user project or extension loaded','Not a player-model creation acceptance']};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,evidenceDirectory:out},null,2));
