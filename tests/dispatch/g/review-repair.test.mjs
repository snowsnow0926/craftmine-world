import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {createReviewJobs}=require(fileURLToPath(new URL('../../../desktop/build/craftmine.world/review-jobs.cjs',import.meta.url)));
const valid={summary:'树已形成候选，等待玩家确认。',verdict:'ready',suggestions:[],limitations:['外观需玩家查看'],assertions:[{id:'no-errors',kind:'noErrors',why:'运行无错误',red:'运行出错时失败'},{id:'tree-added',kind:'newObjects',min:1,why:'树新增',red:'没有树时失败'}],steps:[]};
const scene={format:'craftmine.scene/3',title:'Fixture',night:false,objects:[],systems:[],behaviors:[]};
const job={id:'fixture-check',status:'passed',current:true,input:{binding:{sessionId:'fixture-session',turnId:'fixture-turn'},origin:{modelKey:'fixture/model',request:{text:'增加树'}},world:{build:{scene}}},output:{artifact:{build:{scene}},evidence:{}}};
// Host/render/provider fixtures isolate scheduling and real schema validation.
function fixture(alwaysInvalid=false){
  const records=new Map(),prompts=[];
  const core={call:async(method,args)=>{
    if(method==='verification.read')return job;
    if(method==='review.list')return [...records.values()].reverse();
    if(method==='review.start'){const record={id:args.id,inputHash:'fixture-hash',status:'running',current:true};records.set(record.id,record);return record;}
    if(method==='review.plan')return {hash:'fixture-plan-hash'};
    if(method==='review.finish'){const record=records.get(args.id);record.output=args.output;record.status=args.output.error?'failed':'completed';return record;}
    if(method==='review.cancel')return {};
    throw Error(method);
  }};
  const service={complete:async(id,prompt)=>{prompts.push({id,prompt});const body=structuredClone(valid);if(alwaysInvalid||prompts.length===1)body.assertions[0].redNote='Unsupported invented field';return {modelKey:'fixture/model',text:JSON.stringify(body),usage:{totalTokens:20}};},
    verify:async()=>({render:{version:'fixture-build'},observation:{},acceptance:{passed:true,assertions:valid.assertions.map(row=>({id:row.id,passed:true}))}}),cancelComplete:async()=>{},cancelVerification:async()=>{}};
  return {jobs:createReviewJobs(core,service),records,prompts};
}
async function settle(f){const deadline=Date.now()+3000;while(Date.now()<deadline){if(f.records.size===2&&[...f.records.values()].every(row=>row.status!=='running'))return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Repair scheduling did not settle');}
test('invalid review is retained before exactly one schema repair',async t=>{const f=fixture();t.after(()=>f.jobs.stop());await f.jobs.start(job.id);await settle(f);const [first,second]=[...f.records.values()];assert.equal(first.status,'failed');assert.match(first.output.text,/redNote/);assert.equal(first.output.schemaFailure,true);assert.equal(second.status,'completed');assert.equal(second.output.repairOf,first.id);assert.equal(f.prompts.length,2);assert.match(f.prompts[1].prompt.messages.at(-1).content,/previousReviewFailure/);});
test('a second malformed response stops without weakening the schema',async t=>{const f=fixture(true);t.after(()=>f.jobs.stop());await f.jobs.start(job.id);await settle(f);assert.equal(f.prompts.length,2);assert.ok([...f.records.values()].every(row=>row.status==='failed'));});
