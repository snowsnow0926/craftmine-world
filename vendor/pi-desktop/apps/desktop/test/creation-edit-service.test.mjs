import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCreationEditService,validateCreationEdit} from "../electron/main/creation-edit-service.ts";

const input={sessionId:"session-a",captureId:"capture-a",operationId:"edit-a",action:"modify",changes:{scale:[2,2,2],color:"#123456"}};
function fixture(overrides={}){
 const calls=[],updates=[],capture={worldId:"world-a",buildId:"formal-a",instanceId:"instance-a",snapshotId:"capture-a",target:{entityId:"tree-a"}},context={projectId:"project-a",sessionId:"session-a",turnId:"turn-a"};
 const service=createCreationEditService({begin:async()=>({capture,context}),execute:async(bound,name,args)=>{calls.push({name,args});if(name==="godot_project_index")return {revision:4,manifestHash:"a".repeat(64)};if(name==="creation_operation")return {source:{revision:5,manifestHash:"b".repeat(64)},receipt:{operationId:input.operationId}};return {jobId:"job-a",execution:{enqueued:true}};},readJob:async()=>({jobId:"job-a",status:"passed",candidateId:"candidate-a"}),apply:async()=>{calls.push({name:"apply"});return {status:"applied"};},finish:async()=>{calls.push({name:"finish"});},changed:(_,status)=>updates.push(status),...overrides});
 return {service,calls,updates};
}
async function terminal(service){for(let i=0;i<50;i++){await new Promise(resolve=>setImmediate(resolve));const status=service.status(1,"edit-a");if(["applied","failed","interrupted"].includes(status.phase))return status;}throw Error("test timeout");}
test("direct edit derives identity from host, checks current revision and applies only after passed job",async()=>{
 const {service,calls,updates}=fixture();service.start(1,input);assert.equal((await terminal(service)).phase,"applied");
 assert.deepEqual(calls.map(c=>c.name),["godot_project_index","creation_operation","godot_build_start","apply","finish"]);
 assert.equal(calls[1].args.request.targetId,"tree-a");assert.equal(calls[1].args.request.expected.revision,4);assert.equal(calls[2].args.revision,5);
 assert.deepEqual(updates.map(s=>s.phase),["editing","checking","checking","applying","applied"]);
});
test("replay does not start a second task and another owner cannot inspect status",async()=>{
 const {service,calls}=fixture();service.start(1,input);service.start(1,input);await terminal(service);assert.equal(calls.filter(c=>c.name==="creation_operation").length,1);
 assert.throws(()=>service.status(2,"edit-a"),/NOT_FOUND/);assert.throws(()=>service.start(1,{...input,changes:{color:"#ffffff"}}),/REPLAY_CONFLICT/);
});
test("failed check keeps candidate unadopted and closes the editing turn",async()=>{
 const {service,calls}=fixture({readJob:async()=>({status:"failed",errorCode:"REQUIREMENT_SIZE_MISMATCH"})});service.start(1,input);const status=await terminal(service);assert.equal(status.phase,"failed");assert.match(status.error,/SIZE_MISMATCH/);assert.ok(!calls.some(c=>c.name==="apply"));assert.equal(calls.at(-1).name,"finish");
});
test("unavailable execution never applies unchecked edits",async()=>{
 const {service,calls}=fixture({execute:async(_,name)=>name==="godot_project_index"?{revision:4,manifestHash:"a".repeat(64)}:name==="creation_operation"?{source:{revision:5,manifestHash:"b".repeat(64)}}:{execution:{enqueued:false,reason:"EXECUTOR_UNAVAILABLE"}}});service.start(1,input);assert.match((await terminal(service)).error,/EXECUTOR_UNAVAILABLE/);assert.ok(!calls.some(c=>c.name==="apply"));
});
test("renderer cannot inject identity, arbitrary operations or invalid dimensions",()=>{
 for(const patch of [{worldId:"other"},{targetId:"other"},{expected:{}},{action:"place"},{changes:{position:[1,2,3]}},{changes:{scale:[0,1,1]}},{action:"undo",changes:undefined,undoOperationId:""}])assert.throws(()=>validateCreationEdit({...input,...patch}),/INVALID/);
 assert.equal(validateCreationEdit({...input,action:"delete",changes:undefined}).action,"delete");
});

function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'creation-edit-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('completed durable operation survives service restart and owner rebind without new writes',async t=>{
 const root=directory(t),first=fixture({directory:root});first.service.start(1,input);await terminal(first.service);
 const restarted=fixture({directory:root});assert.throws(()=>restarted.service.status(2,'edit-a'),/NOT_FOUND/);
 assert.throws(()=>restarted.service.status(2,'edit-a',{sessionId:'other',worldId:'world-a'}),/CONTEXT_CHANGED/);
 assert.throws(()=>restarted.service.status(2,'edit-a',{sessionId:'session-a',worldId:'other'}),/CONTEXT_CHANGED/);
 assert.equal(restarted.service.status(2,'edit-a',{sessionId:'session-a',worldId:'world-a'}).phase,'applied');
 assert.equal(restarted.service.start(2,input).phase,'applied');assert.equal(restarted.calls.length,0);
});
test('restart marks unfinished operation interrupted and never automatically repeats a patch',t=>{
 const root=directory(t),first=fixture({directory:root,begin:()=>new Promise(()=>{})});first.service.start(1,input);
 const restarted=fixture({directory:root});const status=restarted.service.status(2,'edit-a',{sessionId:'session-a',worldId:'world-a'});assert.equal(status.phase,'interrupted');assert.match(status.error,/REVIEW_DRAFT/);
 assert.equal(restarted.service.start(2,input).phase,'interrupted');assert.equal(restarted.calls.length,0);
});
test('state persistence failure before a turn refuses work; after application it reports uncertainty',async t=>{
 const root=directory(t),blocked=path.join(root,'blocked');fs.writeFileSync(blocked,'file');const first=fixture({directory:blocked});assert.throws(()=>first.service.start(1,input),/PERSIST_FAILED/);assert.equal(first.calls.length,0);
 const active=path.join(root,'active');const second=fixture({directory:active,apply:async()=>{fs.renameSync(active,path.join(root,'saved'));fs.writeFileSync(active,'file');return {status:'applied'};}});second.service.start(1,input);const status=await terminal(second.service);assert.equal(status.phase,'interrupted');assert.match(status.error,/PERSIST_FAILED/);
});
