// Review observed model-authored gameplay, without changing or running a world.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const files=process.argv.slice(2).map(file=>path.resolve(file));assert.equal(files.length,2,'Pass the walk/open and aimed-close reports');
const [walk,close]=files.map(file=>JSON.parse(fs.readFileSync(file)));
for(const report of [walk,close]){
  assert.equal(report.format,'craftmine.fb02-generated-gameplay/1');assert.equal(report.passed,true);assert.equal(report.sourceEdits,0);assert.equal(report.noModelExecution.modelCallsAdded,0);
  for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(report.audit[key],[]);
}
assert.equal(walk.sourceFile,close.sourceFile);assert.equal(walk.before.worldId,close.before.worldId);assert.equal(walk.before.buildId,close.before.buildId);
const door=observation=>observation.payload.creation.entities.find(entity=>entity.id==='red-gate');
const actions=walk.exploration.actions,closed=actions[2].observation,opened=actions[3].observation,passed=actions[6].observation;
assert.equal(actions[1].op,'walk');assert.equal(actions[1].args.frames,60);assert.equal(door(closed).open,false);assert.equal(door(closed).solid,true);
const front=door(closed).collisionBounds.max[2],radius=closed.payload.creation.playerBounds.halfExtents[2],stoppedZ=closed.payload.player.position[2];
assert.ok(stoppedZ>=front+radius-.01&&stoppedZ<front+radius+.1,'real forward movement stops at the closed door collider');
assert.equal(actions[3].op,'play-action');assert.equal(actions[3].args.action,'interact');assert.equal(actions[3].before.payload.creation.target.entityId,'red-gate');
assert.equal(door(opened).open,true);assert.equal(door(opened).solid,false);assert.ok(passed.payload.player.position[2]<door(closed).collisionBounds.min[2]-radius,'real movement crosses to the far side when opened');
const closing=close.exploration.actions.find(action=>action.op==='play-action');assert.ok(closing);assert.equal(closing.before.payload.creation.target.entityId,'red-gate');
assert.equal(door(closing.before).open,true);assert.equal(door(closing.observation).open,false);assert.equal(door(closing.observation).solid,true);assert.equal(close.snapshot.state.body.doors['red-gate'],false);
const originalTrees=walk.before.payload.creation.entities.filter(entity=>entity.kind==='tree').map(entity=>entity.id).sort();assert.equal(originalTrees.length,3);assert.equal(door(walk.before).color,'#d62828');
for(const action of [...walk.exploration.actions,...close.exploration.actions])assert.deepEqual(action.observation.payload.creation.entities.filter(entity=>entity.kind==='tree').map(entity=>entity.id).sort(),originalTrees);
const report={format:'craftmine.fb02-generated-door-review/1',passed:true,sourceReports:files.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),worldId:walk.before.worldId,buildId:walk.before.buildId,
  observations:{trees:originalTrees,color:door(walk.before).color,closedColliderFront:front,playerRadius:radius,closedStopZ:stoppedZ,openCrossedZ:passed.payload.player.position[2],savedClosed:true},
  checks:['real closed-door collision','actual engine interact action opens','walking passes through opened door','aimed interact closes again','three trees retained','closed state saved with clean exit'],
  limits:['Engine play-action mapped to interact; no physical E key was sent','Images require visual review; this script validates actual runtime facts, not aesthetic quality']};
const output=path.join(path.dirname(files[1]),'semantic-review.json');fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(output);
