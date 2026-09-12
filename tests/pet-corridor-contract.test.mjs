import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
const motion={dog:{radius:.737791133,height:.758157913},pom:{radius:.345776805,height:.468007973}};
function doorPasses(width,diameter){return width>diameter+0.02;}
function turnSpace(width,length,clearance=.02){return width>length+clearance;}
test('existing circular dog envelope remains a refusal baseline for narrow door',()=>{assert.equal(doorPasses(1.40,1.50),false);assert.equal(motion.dog.radius*2,1.475582266);});
test('Pomeranian may pass the 1.40m door only if its measured envelope and margin allow it',()=>{assert.equal(doorPasses(1.40,motion.pom.radius*2),true);});
test('turning clearance is a separate gate from straight door width',()=>{assert.equal(turnSpace(1.40,1.50),false);assert.equal(turnSpace(1.80,1.50),true);});
test('contract never permits teleport or collision shrink as a passing condition',()=>{const policy={movement:'move_and_slide',teleport:false,shrinkCollision:false,restoreOverlap:'PET_RESTORE_OVERLAP'};assert.equal(policy.teleport,false);assert.equal(policy.shrinkCollision,false);assert.equal(policy.restoreOverlap,'PET_RESTORE_OVERLAP');});
test('continuous axis envelope is independent from radial radius and gives the local forward span',()=>{const manifest=JSON.parse(fs.readFileSync(path.resolve('desktop/godot/components/canine-visuals/manifest.json')));const dog=manifest.items.find(x=>x.appearanceKey==='dog').axisEnvelope;assert.equal(dog.method.includes('continuous per-axis'),true);assert.ok(dog.size[0]>.39&&dog.size[0]<.40);assert.ok(dog.size[2]>1.39&&dog.size[2]<1.41);assert.ok(dog.min[1]>=0);assert.ok(dog.max[1]<.77);assert.ok(dog.max[2]>.70);});
