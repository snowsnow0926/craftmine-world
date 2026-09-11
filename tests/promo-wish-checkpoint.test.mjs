import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseCheckpointArgs,inspectCheckpointSource,assertProofs,archiveProof,checkpointWorld,compareCheckpoint} from './helpers/promo-checkpoint-contract.mjs';
import {validateCheckpointCall,checkpointEnvironment} from './helpers/checkpoint-native-controller.mjs';

function fixture(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-contract-')),out=path.join(base,'test-results','desktop-native-fixture'),profile=path.join(out,'profile'),legacySource=path.join(out,'legacy');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(legacySource);
 const put=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
 put(path.join(profile,'headless-profile.json'),{format:'craftmine.headless-profile/1',token:'fixture-only',legacySource});
 put(path.join(profile,'creation-evaluation-budget.json'),{format:'craftmine.creation-evaluation-budget/1',limit:10,requests:Array.from({length:10},(_,i)=>'request-'+i)});
 const pilot=path.join(out,'report.json'),adoption=path.join(out,'adoption.json');
 put(pilot,{format:'craftmine.promo-pilot/1',worldId:'dog-world',maxRequests:10,budget:{remaining:0},packageIdentity:{inventorySha256:'inventory'}});
 put(adoption,{format:'craftmine.promo-adoption/1',ok:true,originalReport:pilot,worldId:'dog-world',after:{worldId:'dog-world',buildId:'adopted'}});
 return {out,profile,adoption,pilot,put};
}
test('stages and explicit package selection reject ambiguous arguments',()=>{
 const file=path.resolve('adoption.json'),pack=path.resolve('package');
 assert.equal(parseCheckpointArgs(['export',file]).phase,'export');
 assert.equal(parseCheckpointArgs(['restore',file,'--packaged-root',pack]).packagedRoot,pack);
 for(const args of [['continue',file],['restore',file],['export','relative'],['export',file,'--reset-budget','10'],['export',file,'--packaged-root',pack,'--packaged-root',pack]])assert.throws(()=>parseCheckpointArgs(args));
});
test('source requires successful adoption, valid isolated marker and exact exhausted ledger',()=>{
 const f=fixture(),source=inspectCheckpointSource(f.adoption);assert.equal(source.proofs.length,4);assertProofs(source.proofs);
 const before=fs.readFileSync(path.join(f.profile,'creation-evaluation-budget.json'));
 assert.deepEqual(fs.readFileSync(path.join(f.profile,'creation-evaluation-budget.json')),before);
 f.put(path.join(f.profile,'creation-evaluation-budget.json'),{format:'craftmine.creation-evaluation-budget/1',limit:10,requests:[]});
 assert.throws(()=>inspectCheckpointSource(f.adoption),/EXHAUSTED_LEDGER/);assert.throws(()=>assertProofs(source.proofs),/SOURCE_CHANGED/);
});
test('failed adoption and foreign profile marker are refused',()=>{
 const f=fixture(),record=JSON.parse(fs.readFileSync(f.adoption));f.put(f.adoption,{...record,ok:false});assert.throws(()=>inspectCheckpointSource(f.adoption),/ADOPTION_REQUIRED/);
 f.put(f.adoption,record);f.put(path.join(f.profile,'headless-profile.json'),{format:'craftmine.headless-profile/1',token:'fixture-only',legacySource:path.dirname(f.out)});assert.throws(()=>inspectCheckpointSource(f.adoption),/same isolated test/);
});
test('controller cannot send model, adoption, arbitrary RPC or envelope overrides',()=>{
 for(const [method,fields] of [['initialize',{}],['worldPanel',{channel:'godot.candidateApply'}],['worldNavigation',{channel:'task.resume'}],['worldNavigation',{channel:'world.read'}],['status',{type:'craftmine-creation-evaluation',method:'initialize'}]])assert.throws(()=>validateCheckpointCall(method,fields));
 validateCheckpointCall('worldPanel',{channel:'backup.restore',payload:{worldId:'current',operationId:'restore-1',grantId:'grant',expectedCurrentHash:'a'.repeat(64)}});
 validateCheckpointCall('worldNavigation',{channel:'godot.historyLoad',payload:{worldId:'world'}});
});
test('model evaluator environment is never enabled or given a key',()=>{
 const result=checkpointEnvironment({environment:()=>({CRAFTMINE_CREATION_EVAL:'1',CRAFTMINE_EVAL_KEY:'not-a-real-secret',CRAFTMINE_LIVE_CONFIG:'private',DEEPSEEK_API_KEY:'not-a-real-secret',CRAFTMINE_HEADLESS_TOKEN:'test-authority',CRAFTMINE_DATA_DIR:'isolated'})},{});
 assert.deepEqual(result,{CRAFTMINE_HEADLESS_TOKEN:'test-authority',CRAFTMINE_DATA_DIR:'isolated'});
});
test('archive proof uses actual bytes and detects subsequent changes',async()=>{
 const f=fixture(),file=path.join(f.out,'archive.craftmine');fs.writeFileSync(file,'fixture archive bytes, not a valid backup');const before=await archiveProof(file);fs.appendFileSync(file,'changed');const after=await archiveProof(file);assert.notEqual(before.sha256,after.sha256);assert.ok(after.bytes>before.bytes);
});
test('comparison preserves identity and reports changed build/source/progress without claiming acceptance',()=>{
 const before=checkpointWorld({observation:{worldId:'world',buildId:'old',instanceId:'one'},snapshot:{state:{worldId:'world',body:{progress:1}}},history:{worldId:'world',appliedOid:'formal',headOid:'draft',branchId:'main',index:{revision:2,manifestHash:'before'}}});
 const after={...before,buildId:'new',source:{...before.source,manifestHash:'after'},progressSha256:'new-progress'};
 const comparison=compareCheckpoint(before,after);assert.equal(comparison.worldIdPreserved,true);assert.equal(comparison.buildChanged,true);assert.equal(comparison.sourceManifestPreserved,false);assert.equal(comparison.progressBytesPreserved,false);
 assert.throws(()=>compareCheckpoint(before,{...after,worldId:'other'}),/WORLD_ID_CHANGED/);
});
