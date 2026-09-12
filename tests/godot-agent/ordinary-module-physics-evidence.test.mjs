import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const directory=new URL('../../docs/evidence/gu3-player-parameters-20260912/',import.meta.url),read=name=>JSON.parse(fs.readFileSync(new URL(name,directory)));
const summary=read('summary.json'),adoption=read('adoption.json'),player=read('parameter-continued.json');
const owner=target=>target?.nodePath===summary.leftEntityId||target?.ancestors?.some(a=>a.nodePath===summary.leftEntityId);
function through(r,reverse=false){
 assert.equal(r.ok,true);const e=r.exploration,start=reverse?e.before:e.actions[4].observation,end=e.after;
 const target=reverse?e.captures[0].observation.payload.creation.sceneObjectTarget:start.payload.creation.sceneObjectTarget;
 assert.ok(owner(target));assert.equal(target.nodeClass,'MeshInstance3D');
 const a=start.payload.player.position,b=end.payload.player.position;
 assert.ok(a[0]>-5.5&&a[0]<-3.5&&b[0]>-5.5&&b[0]<-3.5);
 assert.ok(reverse?a[2]<-3&&b[2]>3:a[2]>3&&b[2]<-3);
 assert.equal(start.buildId,summary.buildId);assert.equal(end.buildId,summary.buildId);
}
test('original reports retain bytes and source edits affect only the existing left instance parameters',()=>{
 for(const [name,pin]of Object.entries(summary.records)){const bytes=fs.readFileSync(new URL(name,directory));assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);}
 const scene=n=>fs.readFileSync(new URL('scene-r'+n+'.tscn',directory),'utf8');
 assert.equal(scene(5).replace('model_scale_percent = 250','model_scale_percent = 100').replace('quarter_turns = 1','quarter_turns = 0').replace('solid = false','solid = true'),scene(4));
 const right=text=>text.slice(text.indexOf('[node name="'+summary.rightEntityId+'"'));
 assert.equal(right(scene(5)),right(scene(4)));assert.equal(summary.typedQueryUsed,false);
 assert.equal(player.latest.job.status,'passed');assert.equal(player.latest.job.buildId,summary.buildId);assert.equal(player.latest.job.manifestHash,summary.manifestHash);
 assert.equal(adoption.ok,true);assert.deepEqual(adoption.before.payload.player,adoption.after.payload.player);assert.deepEqual(adoption.after.payload.player,adoption.reopened.payload.player);
 assert.ok(owner(adoption.reopened.payload.creation.sceneObjectTarget));assert.equal(adoption.reopened.payload.creation.sceneObjectSelection.status,'hit');
});
test('cold right house remains a real physical obstacle while left house is traversable in both directions',()=>{
 const right=read('right-blocked.json'),a=right.exploration.before.payload.player.position,b=right.exploration.after.payload.player.position;
 assert.equal(right.ok,true);assert.equal(right.exploration.actions[1].op,'walk');assert.equal(right.exploration.actions[1].args.frames,30);
 for(const capture of right.exploration.captures){assert.equal(capture.observation.payload.creation.sceneObjectTarget.nodePath,summary.rightEntityId);assert.equal(capture.observation.payload.creation.sceneObjectTarget.nodeClass,'StaticBody3D');}
 assert.ok(Math.hypot(a[0]-b[0],a[2]-b[2])<0.01);assert.ok(b[2]>0.7);
 const left=read('left-through.json'),cold=read('left-cold-return.json');through(left);through(cold,true);
 assert.notEqual(left.exploration.identity.instanceId,cold.exploration.identity.instanceId);assert.deepEqual(left.exploration.after.payload.player,cold.exploration.before.payload.player);
 for(const r of [right,left,cold]){assert.equal(r.exit.code,0);assert.equal(r.sourceEdits,0);assert.equal(r.modelCallsAdded,0);for(const k of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(r.audit[k],[]);}
});
test('a missed target or a player stopping inside the left wall cannot certify traversal',()=>{
 const r=read('left-through.json'),noTarget=structuredClone(r);noTarget.exploration.actions[4].observation.payload.creation.sceneObjectTarget=null;assert.throws(()=>through(noTarget));
 const blocked=structuredClone(r);blocked.exploration.after.payload.player.position[2]=1;assert.throws(()=>through(blocked));
});
