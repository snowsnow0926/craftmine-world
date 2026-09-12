import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const oldSource=execFileSync('git',['show','34556262:desktop/godot/shared/materialize.mjs'],{cwd:root,encoding:'utf8'})
 .replace('const here=path.dirname(fileURLToPath(import.meta.url));','const here='+JSON.stringify(path.join(root,'desktop/godot/shared'))+';');
const {materializeBase:baseline}=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'engine-materializer-'));
test('all five default materializers retain historical bytes except their own output-path metadata',()=>{
 for(const baseId of ['creation-sandbox','first-person','top-down','side-view','mining-sandbox']){
  const options={baseId,worldId:'probe-'+baseId};
  const old=baseline({...options,out:path.join(scratch,baseId+'-old')}),current=materializeBase({...options,out:path.join(scratch,baseId+'-default')});
  if(baseId==='side-view'){
   const previous=JSON.parse(fs.readFileSync(path.join(scratch,baseId+'-old/MATERIALIZED.json'))),next=JSON.parse(fs.readFileSync(path.join(scratch,baseId+'-default/MATERIALIZED.json')));
   assert.equal(previous.output,path.join(scratch,baseId+'-old'));assert.equal(next.output,path.join(scratch,baseId+'-default'));
   assert.deepEqual({...next,output:null},{...previous,output:null});
   old.files=old.files.filter(f=>f.path!=='MATERIALIZED.json');current.files=current.files.filter(f=>f.path!=='MATERIALIZED.json');
  }
  assert.deepEqual(current,old);assert.equal(current.enginePerformanceProfile,undefined);
 }
});
test('explicit engine profile adds only versioned bridge dependency and collector',()=>{
 const baseId='creation-sandbox',worldId='profile-world';
 const before=materializeBase({baseId,worldId,out:path.join(scratch,'plain')});
 const after=materializeBase({baseId,worldId,out:path.join(scratch,'engine'),enginePerformanceProfile:'engine-monitor/1'});
 assert.equal(after.enginePerformanceProfile,'engine-monitor/1');
 const changes=after.files.filter(file=>JSON.stringify(file)!==JSON.stringify(before.files.find(old=>old.path===file.path))).map(file=>file.path).sort();
 assert.deepEqual(changes,['craftmine_shared/engine_performance.gd','craftmine_shared/runtime_bridge.gd','craftmine_shared/runtime_bridge_base.gd']);
 const file=name=>fs.readFileSync(path.join(scratch,'engine/craftmine_shared',name));
 assert.deepEqual(file('runtime_bridge_base.gd'),fs.readFileSync(path.join(root,'desktop/godot/shared/runtime_bridge.gd')));
 assert.deepEqual(file('runtime_bridge.gd'),fs.readFileSync(path.join(root,'desktop/godot/shared/runtime_bridge_engine_v1.gd')));
});
test('unknown opt-in values fail before creating even the parent directory',()=>{
 for(const enginePerformanceProfile of [null,'',false,'engine-monitor/2',{}]){
  const parent=path.join(scratch,'invalid-'+Math.random());
  assert.throws(()=>materializeBase({baseId:'creation-sandbox',worldId:'profile-world',out:path.join(parent,'world'),enginePerformanceProfile}),/Unknown engine performance profile/);
  assert.equal(fs.existsSync(parent),false);
 }
});
