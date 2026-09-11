import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
const bundle=await build({entryPoints:[new URL('../electron/main/creation-edit-guards.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,format:'esm',platform:'node'});
const {readFormalCreationJournal,assertDirectCreationCandidate}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const hash=value=>createHash('sha256').update(value).digest('hex');
const entity={id:'tree-a',kind:'tree',position:[1,0,2],scale:[1,1,1],color:'#88bb44'};
const journal={format:'craftmine.creation-operations/1',operations:[{operationId:'placed-tree',receipt:{undoSupported:true},inverse:{format:'craftmine.creation-inverse/1',before:[],after:[entity]}}]};
const capture={worldId:'world-a',buildId:'formal-a',sourceRevision:4,manifestHash:'a'.repeat(64),entities:[entity]};
function fixture(){const calls=[],text=JSON.stringify(journal),name='world/creation-operations.json';const data={
 'godotRuntime.exportSource':{worldId:'world-a',buildId:'formal-a',baseId:'creation-sandbox',contentOid:'formal-oid',files:[{path:name,bytes:Buffer.byteLength(text),sha256:hash(text)}]},
 'content.readFile':{worldId:'world-a',rev:'formal-oid',path:name,text,bytes:Buffer.byteLength(text),sha256:hash(text)},
 'godotRuntime.describe':{...capture,baseId:'creation-sandbox'},
 };return{data,calls,domain:async(method,args)=>{calls.push({method,args});return structuredClone(data[method]);}};}
test('undo reads immutable formal contentOid and returns last actually reversible operation',async()=>{
 const f=fixture(),result=await readFormalCreationJournal(f.domain,capture);assert.equal(result.latestUndoOperationId,'placed-tree');assert.equal(f.calls[1].args.rev,'formal-oid');assert.equal(f.calls.at(-1).method,'godotRuntime.describe');
});
test('changed journal bytes metadata or formal build rejects undo history',async()=>{
 for(const mutate of [f=>f.data['content.readFile'].text+=' ',f=>f.data['content.readFile'].rev='working-oid',f=>f.data['godotRuntime.describe'].buildId='new-formal',f=>f.data['godotRuntime.exportSource'].files[0].bytes=5000000]){
  const f=fixture();mutate(f);await assert.rejects(readFormalCreationJournal(f.domain,capture));
 }
});
test('changed live objects cannot make an older inverse look applicable',async()=>{
 const f=fixture(),result=await readFormalCreationJournal(f.domain,{...capture,entities:[{...entity,scale:[2,2,2]}]});assert.equal(result.latestUndoOperationId,null);
});
test('a formal build without a journal has no invented undo entry',async()=>{
 const f=fixture();f.data['godotRuntime.exportSource'].files=[];const result=await readFormalCreationJournal(f.domain,capture);assert.equal(result.journal,null);assert.equal(result.latestUndoOperationId,null);assert.equal(f.calls.length,2);
});
test('direct adoption rejects unfrozen requirements before reading a candidate',async()=>{
 const f=fixture();f.data['godotBuild.read']={worldId:'world-a',jobId:'job-a',kind:'check',status:'passed',baseId:'creation-sandbox',candidateId:'candidate-a'};
 await assert.rejects(assertDirectCreationCandidate(f.domain,{projectId:'p',sessionId:'s',turnId:'t'},capture,'job-a','candidate-a'),/REQUIREMENTS_NEED_REVIEW/);
 assert.ok(!f.calls.some(call=>call.method==='godotCandidate.read'));
});

test('observer-only adoption requires the exact migration source, passed check and unchanged current branch',async()=>{
 const upgraded={...capture,observerUpgradeOnly:true,autoApply:false,target:{surface:'none'},sourceMigration:{formalBuildId:capture.buildId,formalSourceRevision:capture.sourceRevision,formalManifestHash:capture.manifestHash,revision:5,manifestHash:'b'.repeat(64)}};
 function ready(){const f=fixture();f.data['godotBuild.read']={worldId:'world-a',jobId:'job-a',kind:'check',status:'passed',baseId:'creation-sandbox',candidateId:'candidate-a',sourceRevision:5,manifestHash:'b'.repeat(64),sourceStale:false,buildId:'build-new',outputHash:'out',taskId:'task-a'};f.data['godotCandidate.read']={checkStatus:'passed',candidate:{status:'ready',worldId:'world-a',checkJobId:'job-a',buildId:'build-new',sourceRevision:5,manifestHash:'b'.repeat(64),checkOutputHash:'out'}};f.data['godotProject.index']={currentTaskId:'task-a',worldId:'world-a',baseId:'creation-sandbox',revision:5,manifestHash:'b'.repeat(64)};return f;}
 await assertDirectCreationCandidate(ready().domain,{projectId:'p',sessionId:'s',turnId:'t'},upgraded,'job-a','candidate-a');
 for(const mutate of [f=>f.data['godotBuild.read'].sourceStale=true,f=>f.data['godotBuild.read'].manifestHash='c'.repeat(64),f=>f.data['godotCandidate.read'].candidate.checkOutputHash='other',f=>f.data['godotProject.index'].revision=6]){const f=ready();mutate(f);await assert.rejects(assertDirectCreationCandidate(f.domain,{projectId:'p',sessionId:'s',turnId:'t'},upgraded,'job-a','candidate-a'));}
 await assert.rejects(assertDirectCreationCandidate(ready().domain,{projectId:'p',sessionId:'s',turnId:'t'},{...upgraded,sceneObjectTarget:{objectId:'old'}},'job-a','candidate-a'),/UPGRADE_SOURCE_REQUIRED/);
});
