import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {validateCreationScene} from '../../../shared/creation-scene.mjs';
import {materializeBase} from '../../../shared/materialize.mjs';
import {validateBaseContract, normalizeBaseManifest, baseContentHash} from '../../../shared/base_contract.mjs';
const require=createRequire(import.meta.url);
const {generateSequenceDoorRule}=require('../../../../../plugins/craftmine-world/creation-sequence-rule.cjs');
const base=path.resolve(import.meta.dirname,'..');
const blank=()=>JSON.parse(fs.readFileSync(path.join(base,'world/creation.json')));
const entity=(id,kind)=>({id,kind,position:[0,0,0],rotationY:0,scale:[1,1,1],color:'#86aa66',parameters:{}});
test('空白底座、完整源哈希和真实引擎初始快照可实例化',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));
 assert.equal(validateBaseContract(manifest,{baseDir:base}).ok,true);
 assert.match(baseContentHash(base,normalizeBaseManifest(manifest)).hash,/^[a-f0-9]{64}$/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'creation-contract-'));
 try {const out=path.join(dir,'world');const managed=materializeBase({baseId:'creation-sandbox',worldId:'contract-world',out});
 assert.equal(managed.baseId,'creation-sandbox');
 const initial=JSON.parse(fs.readFileSync(path.join(out,'craftmine_initial_state.json')));
 assert.equal(initial.initialProgress.worldId,'contract-world');
 assert.equal(initial.initialProgress.sourceTimeOfDay,12);
 assert.equal(initial.initialProgress.inventory && Object.keys(initial.initialProgress.inventory).length,0);
 assert.ok(fs.existsSync(path.join(out,'craftmine_shared/base_adapter.gd')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('五种实体和源码生成机关均使用同一合同',()=>{
 const scene=blank();scene.entities=['tree','rock','chest','door','marker'].map(kind=>entity(kind,kind));
 scene.entities.push(entity('second','marker'));
 scene.rules=[generateSequenceDoorRule({id:'new_rule',doorId:'door',sequence:['marker','second']}).declaration];
 assert.equal(validateCreationScene(scene).ok,true);
 for(const alter of [s=>s.entities.push({...s.entities[0]}),s=>s.entities[0].scale=[0,1,1],s=>s.entities[0].position=[0,-1,0],s=>s.entities[0].parameters={rewardCount:1},s=>s.rules[0].sequence=['marker','tree'],s=>s.rules[0].script='scripts/other.gd',s=>s.extra=true]){
  const invalid=structuredClone(scene);alter(invalid);assert.equal(validateCreationScene(invalid).ok,false);
 }
});
