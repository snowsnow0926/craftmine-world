// Explicit isolated native integration test. No Codex/model, browser or input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {main} from '../scripts/codex-world-author.mjs';
import {readState} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i+=2)values[args[i]]=args[i+1];
for(const key of ['--runtime','--plugin','--data'])assert(path.isAbsolute(values[key]??''),key+' must be an absolute path');
const data=values['--data'];assert(!fs.existsSync(data),'Use a new independent data directory');
await main(['init','--data',data,'--runtime',values['--runtime'],'--plugin',values['--plugin'],'--world','codex-native-'+randomUUID().slice(0,8)]);
const state=readState(data),host=new CodexWorldHost({data,state});
let context;
const next=()=>({projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()});
const tool=(name,args={})=>host.tools.find(t=>t.name===name).execute(args,{...context,toolCallId:randomUUID(),executionId:'native-test'});
try {
  await host.start({engines:false});context=next();await host.begin(context,'First native source transaction');
  const first=await tool('godot_project_index');
  assert(first.files.some(file=>file.path==='project.godot'));
  const put=(index,text,expectedHash=null)=>tool('godot_project_patch',{revision:index.revision,manifestHash:index.manifestHash,
    operations:[{op:'put',path:'native-continuation.txt',text,expectedHash}]});
  await put(first,'first');await host.end(context,'completed');
  const ended={...context};context=next();await host.begin(context,'Continue the same native draft');
  const second=await tool('godot_project_index');assert(second.revision>first.revision);
  const file=await tool('godot_file_read',{revision:second.revision,manifestHash:second.manifestHash,path:'native-continuation.txt'});assert(JSON.stringify(file).includes('first'));
  await host.end(context,'aborted');
  await assert.rejects(put(second,'late'),/TURN_ENDED/);
  await assert.rejects(host.core.call('godotProject.patch',{context,worldId:state.worldId,toolCallId:'late-direct',revision:second.revision,manifestHash:second.manifestHash,
    operations:[{op:'put',path:'late.txt',text:'must not land',expectedHash:null}]}),/TURN_ENDED|TASK_NOT_ACTIVE|TASK_INACTIVE/);
  await host.stop();
  const resumedHost=new CodexWorldHost({data,state});await resumedHost.start({engines:false});
  try {
    const recovered=await resumedHost.begin(next(),'Resume interrupted native work');
    assert.equal(recovered.world.id,state.worldId);assert.equal(recovered.binding.sessionId,state.sessionId);
    await resumedHost.end({projectId:state.projectId,sessionId:state.sessionId,turnId:recovered.binding.turnId},'completed');
    const foreignHost=new CodexWorldHost({data,state:{...state,worldId:'foreign-world'},core:resumedHost.core});
    const foreign={...ended,turnId:randomUUID()};
    await assert.rejects(foreignHost.begin(foreign,'Wrong world'),/WORLD_BINDING_MISMATCH/);
  } finally {await resumedHost.stop();}
  console.log(JSON.stringify({status:'passed',data,worldId:state.worldId,realRust:true,modelInvocation:false,checks:['source transaction','completed continuation','cancel fence','restart recovery','foreign world refusal']}));
} finally {await host.stop();}
