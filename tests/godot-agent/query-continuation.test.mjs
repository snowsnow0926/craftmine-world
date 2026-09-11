import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createProjectQuery}=require('../../plugins/craftmine-world/godot-query.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(entries,{alter=()=>{},readLimit}={}){
  const texts=new Map(entries),calls=[],manifestHash=hash('manifest');
  const core={async call(method,args){
    calls.push({method,args});
    const identity={worldId:'alpha',revision:4,manifestHash};
    let result;
    if(method==='godotProject.index'){
      const files=entries.map(([path,text])=>({path,sha256:hash(text),bytes:Buffer.byteLength(text)}));
      const offset=args.offset??0,limit=args.limit??32;
      result={...identity,baseId:'creation-sandbox',engineVersion:'4.7.2-stable',renderer:'gl_compatibility',target:'web',
        files:files.slice(offset,offset+limit),totalFiles:files.length,nextOffset:offset+limit<files.length?offset+limit:null};
    }else{
      const source=texts.get(args.path); if(source===undefined)throw Error('PROJECT_FILE_NOT_FOUND');
      const chars=Array.from(source),offset=args.offset??0,text=chars.slice(offset,offset+args.limit).join(''),end=offset+Array.from(text).length;
      result={...identity,path:args.path,sha256:hash(source),bytes:Buffer.byteLength(source),offset,text,totalCharacters:chars.length,nextOffset:end<chars.length?end:null};
    }
    alter(method,args,result); return result;
  }};
  return {query:createProjectQuery({core,context:{projectId:'p',sessionId:'s',turnId:'t'},worldId:'alpha',...(readLimit?{readLimit}:{})}),calls,manifestHash};
}

test('symbol search can continue beyond the first 24 scripts against its original revision',async()=>{
  const files=Array.from({length:30},(_,i)=>[`s${i}.gd`,i===29?'# Comment\n\nclass_name LastScript\nfunc target():\n pass\n':'extends Node\n']);
  const {query,calls,manifestHash}=fixture(files);
  const first=await query.find({name:'target'});
  assert.equal(first.complete,false);assert.equal(first.nextOffset,24);
  assert.equal(first.identity.revision,4);assert.equal(first.provenance,'static-source');
  const next=await query.find({name:'target',offset:first.nextOffset,revision:4,manifestHash});
  assert.equal(next.matches[0].path,'s29.gd');assert.equal(next.nextOffset,null);
  assert.equal(next.pageComplete,true);assert.equal(next.complete,false,'a later page is not a whole-project proof');
  assert.ok(calls.filter(x=>x.method==='godotProject.index').slice(-1).every(x=>x.args.revision===4));
  const named=await query.find({name:'LastScript',offset:24,revision:4,manifestHash});
  assert.equal(named.matches[0].line,3,'class line is actual source location');
});

test('continuations require a full source pin before any RPC',async()=>{
  for(const args of [{offset:1},{revision:4},{manifestHash:hash('m')},{offset:-1},{limit:25}]){
    const {query,calls}=fixture([['a.gd','extends Node']]);
    await assert.rejects(query.scripts(args),/PROJECT_QUERY/);assert.equal(calls.length,0);
  }
});

test('truncated resources never become a complete dependency result',async()=>{
  const {query}=fixture([['large.tres','[gd_resource type="Resource" format=3]\n'+' '.repeat(17000)+'\n[ext_resource type="Script" path="res://hidden.gd" id="1"]']]);
  const result=await query.resources();
  assert.equal(result.complete,false);assert.equal(result.resources.length,0);
  assert.equal(result.skipped[0].reason,'FILE_EXCEEDS_READ_CAP');
  assert.equal(result.identity.worldId,'alpha');
});

test('script pages disclose omitted files, and an exact missing path is not empty success',async()=>{
  const {query}=fixture([['a.gd','extends Node'],['b.gd','extends Node']]);
  const result=await query.scripts({limit:1});
  assert.equal(result.nextOffset,1);assert.equal(result.totalFiles,2);assert.equal(result.complete,false);
  await assert.rejects(query.scripts({path:'missing.gd'}),/PROJECT_FILE_NOT_FOUND/);
});

test('index and file responses from another revision or world are rejected',async()=>{
  for(const [target,field,value] of [['godotProject.index','worldId','other'],['godotProject.read','revision',9],['godotProject.read','path','other.gd']]){
    const {query}=fixture([['a.gd','extends Node']],{alter(method,args,result){if(method===target)result[field]=value;}});
    await assert.rejects(query.scripts(),/PROJECT_QUERY_IDENTITY_MISMATCH/);
  }
});

test('Unicode read cap counts characters, not UTF16 units, and returns continuation',async()=>{
  const {query}=fixture([['a.gd','😀😀😀😀x']],{readLimit:2});
  const result=await query.readText('a.gd',{cap:4});
  assert.equal(result.text,'😀😀😀😀');assert.equal(result.nextOffset,4);assert.equal(result.truncated,true);
});
