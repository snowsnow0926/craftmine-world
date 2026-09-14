// Synthetic values below exercise assertion logic only, not product acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pointerValue,validateTemplateExpectations,inspectTemplateState,requirePackagedResources} from './helpers/template-import-expectations.mjs';

const packet=()=>({format:'craftmine.template-import-expectations/1',archiveSha256:'a'.repeat(64),title:'logic fixture',checks:[{id:'inventory',source:'snapshot',pointer:'/state/body/inventory',value:{chart:1}}]});
test('JSON pointers require own properties, decode escapes and distinguish missing from null',()=>{
 assert.deepEqual(pointerValue({'a/b':{'~':null}},'/a~1b/~0'),{found:true,value:null});
 assert.deepEqual(pointerValue({},'/toString'),{found:false});
 assert.deepEqual(pointerValue({items:[7]},'/items/0'),{found:true,value:7});
 assert.throws(()=>pointerValue({},'/missing/~2'),/INVALID_JSON_POINTER_ESCAPE/);
});
test('expectations cannot omit archive identity, values, or duplicate a check',()=>{
 for(const value of ['', 'ANY', 'A'.repeat(64)])assert.throws(()=>validateTemplateExpectations({...packet(),archiveSha256:value}));
 const missing=packet();delete missing.checks[0].value;assert.throws(()=>validateTemplateExpectations(missing));
 const duplicate=packet();duplicate.checks.push({...duplicate.checks[0]});assert.throws(()=>validateTemplateExpectations(duplicate));
});
test('actual mismatches and missing state fail without modifying receipts or expectations',()=>{
 const expected=packet(),receipts={snapshot:{state:{body:{inventory:{chart:1}}}}},before=structuredClone({expected,receipts});
 assert(inspectTemplateState(expected,receipts).passed);
 assert(!inspectTemplateState(expected,{snapshot:{state:{body:{inventory:{chart:0}}}}}).passed);
 assert(!inspectTemplateState(expected,{}).passed);
 assert.deepEqual({expected,receipts},before);
});
test('numeric tolerance is explicit and never coerces strings',()=>{
 const expected=packet();expected.checks=[{id:'position',source:'snapshot',pointer:'/x',value:1,tolerance:.01}];
 assert(inspectTemplateState(expected,{snapshot:{x:1.005}}).passed);
 assert(!inspectTemplateState(expected,{snapshot:{x:'1'}}).passed);
 assert(!inspectTemplateState(expected,{snapshot:{x:1.1}}).passed);
});
function city(collected){
 const expected=packet();expected.city={districts:6,authoredBuildings:22};expected.quest={items:['org-flight-chart','org-flight-clearance','org-flight-compass'],collected};
 expected.flight={entityId:'actual-aircraft',format:'craftmine.reusable-j20-state/1'};expected.pet={entityId:'actual-pet',format:'craftmine.pet-companion-state/1'};
 const components={'actual-aircraft':{...expected.flight,hasFlown:collected===3,landings:collected===3?1:0,piloted:false,crashed:false,grounded:true},'actual-pet':{...expected.pet,interactionCount:collected===3?1:0,settings:{following:false,name:'小麦'}}};
 const inventory=Object.fromEntries(collected?expected.quest.items.map(id=>[id,1]):[]);
 expected.checks=[{id:'inventory',source:'snapshot',pointer:'/state/body/inventory',value:inventory}];
 for(const [key,fields]of [['flight',['hasFlown','landings','piloted','crashed','grounded']],['pet',['interactionCount','settings/following','settings/name']]])for(const field of fields){let value=components[expected[key].entityId];for(const part of field.split('/'))value=value[part];expected.checks.push({id:key+field,source:'snapshot',pointer:'/state/body/components/'+expected[key].entityId+'/'+field,value});}
 return {expected,receipts:{snapshot:{state:{body:{inventory,components}}},observation:{payload:{city:expected.city,creation:{entities:[]},flightPreparation:{aircraftId:expected.flight.entityId,companionId:expected.pet.entityId,collected,required:3,objectiveComplete:collected===3}}}}};
}
test('city acceptance distinguishes declared default 0/3 from checkpoint 3/3',()=>{
 const zero=city(0),completed=city(3);
 assert(inspectTemplateState(zero.expected,zero.receipts).passed);
 assert(inspectTemplateState(completed.expected,completed.receipts).passed);
 assert(!inspectTemplateState(zero.expected,completed.receipts).passed);
 assert(!inspectTemplateState(completed.expected,zero.receipts).passed);
});
test('city, inventory, actual component identity and flight outcome each fail independently',()=>{
 for(const mutate of [r=>{r.observation.payload.city={districts:5,authoredBuildings:22};},r=>{r.snapshot.state.body.inventory=null;},r=>{r.snapshot.state.body.components['actual-aircraft'].landings=0;},r=>{r.observation.payload.flightPreparation.aircraftId='wrong';},r=>{r.snapshot.state.body.components['actual-pet'].entityId='wrong';}]){
  const {expected,receipts}=city(3);mutate(receipts);assert(!inspectTemplateState(expected,receipts).passed);
 }
 const {expected}=city(3);expected.checks=expected.checks.filter(c=>!c.pointer.endsWith('/landings'));assert.throws(()=>validateTemplateExpectations(expected),/DECLARE_COMPONENT_FIELD/);
});
test('packaged verification rejects a checkout resource override',()=>{
 requirePackagedResources('D:/Final/win-unpacked','D:/Final/win-unpacked/resources');
 requirePackagedResources('D:\\Final\\win-unpacked','d:/final/win-unpacked/resources');
 assert.throws(()=>requirePackagedResources('D:/Final/win-unpacked','D:/Checkout/desktop/build/runtime-resources'),/PACKAGED_RUNTIME_RESOURCES_REQUIRED/);
 requirePackagedResources(null,'D:/Checkout/desktop/build/runtime-resources');
});
