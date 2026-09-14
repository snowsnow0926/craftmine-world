import assert from 'node:assert/strict';
import test from 'node:test';
import {register,createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
register(pathToFileURL(fileURLToPath(new URL('./helpers/ts-import-hooks.mjs',import.meta.url))));
const {invokeCraftmineNavigation}=await import('../electron/main/craftmine-navigation-host.ts');
const {createCraftminePackageService}=await import('../electron/main/craftmine-package-service.ts');
const {validateCompositionRequest,parseCompositionPlan,compositionPrompt}=await import('../shared/world-composition-contract.ts');
const {validateCompositionRequest:domainValidate}=createRequire(import.meta.url)('../../../../../plugins/craftmine-world/world-composition.cjs');
const request={recipeId:'collect-unlock-flight',recipeVersion:1,choices:{scenery:'keep',companion:true,weather:'keep',collectionCount:3},wish:'Keep the city and its buildings.'};
const plan={format:'craftmine.world-composition-plan/1',worldId:'world-one',planHash:'e'.repeat(64),request,source:{revision:2,manifestHash:'a'.repeat(64)},components:[],checks:[{id:'physical-runway',status:'runtime-verification-required',detail:'Actual collider required'}],missingLogic:[{id:'collection-objective',detail:'Generate and play the quest'}],applied:false,compatibility:'not-runtime-verified'};
test('UI and domain agree on exact versions, choices, UTF-8 wish bounds and unknown-field refusals',()=>{
  assert.deepEqual(validateCompositionRequest(request),domainValidate(request));
  for(const recipeVersion of [1,2,3])assert.deepEqual(validateCompositionRequest({...request,recipeVersion}),domainValidate({...request,recipeVersion}));
  for(const invalid of [{...request,recipeVersion:'latest'},{...request,choices:{...request.choices,collectionCount:0}},{...request,worldId:'elsewhere'},{...request,wish:'城'.repeat(2001)}]){assert.throws(()=>validateCompositionRequest(invalid));assert.throws(()=>domainValidate(invalid));}
});
test('navigation exposes only bounded read-only composition requests',async()=>{
  const calls=[],deps={invoke:async(...args)=>calls.push(args),navigate:async()=>{throw Error('No navigation');}};
  const input=params=>({pluginId:'craftmine.world',channel:'package.request',payload:{worldId:'world-one',method:'compositionPlan',params}});
  await invokeCraftmineNavigation(input({worldId:'world-one',request}),deps);assert.deepEqual(calls[0][1].params,{worldId:'world-one',request});
  for(const args of [{worldId:'other',request},{worldId:'world-one',request,context:{forged:true}},{worldId:'world-one',request:{...request,apply:true}}])await assert.rejects(invokeCraftmineNavigation(input(args),deps));
  assert.equal(calls.length,1);
});
test('main service checks selected world before and after reads and rejects manufactured acceptance',async()=>{
  let selected='world-one',switchDuring=false,bad=false;
  const service=createCraftminePackageService({selection:()=>selected,pickFile:async()=>{throw Error('No file picker');},domainCall:async(method,args)=>{assert.equal(method,'package.request');assert.equal(args.method,'compositionPlan');if(switchDuring)selected='other';return {...plan,applied:bad};}});
  const input={worldId:'world-one',method:'compositionPlan',params:{worldId:'world-one',request}};
  assert.equal((await service.request('package.request',input)).planHash,plan.planHash);
  bad=true;await assert.rejects(service.request('package.request',input),/COMPOSITION_RECEIPT_INVALID/);
  bad=false;switchDuring=true;await assert.rejects(service.request('package.request',input),/WORLD_CHANGED/);
});
test('handoff preserves original wish and requests fresh planning rather than treating source checks as gameplay proof',()=>{
  assert.equal(parseCompositionPlan(plan,'world-one').applied,false);
  const text=compositionPrompt(plan,true);assert(text.includes(request.wish));assert(text.includes('compose'));assert(text.includes('collection-objective'));
  assert.throws(()=>parseCompositionPlan({...plan,applied:true},'world-one'),/RECEIPT_INVALID/);
  assert.throws(()=>parseCompositionPlan(plan,'other'),/RECEIPT_INVALID/);
});
