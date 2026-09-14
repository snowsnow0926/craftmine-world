import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorBlankGodot} from './helpers/operator-blank-world.mjs';
function fixture(overrides={}){
  const state={formPresent:true,basePresent:true,baseDisabled:false,blankPresent:true,baseSelected:false,blankSelected:false,title:'',submitReady:true,error:null,...overrides},calls=[];
  const api={read:async()=>({...state}),field:async(selector,value)=>{calls.push({selector,value});if(selector.includes('base-option'))state.baseSelected=value;else if(selector.includes('starter-option'))state.blankSelected=value;else state.title=value;},submit:async selector=>{assert(state.baseSelected&&state.blankSelected&&state.title);calls.push({submit:selector});},until:async(read,accept)=>{const value=await read();assert(accept(value),'fixture must become ready through actual requested state transitions');return value;}};
  return {state,calls,api};
}
test('blank world selects delivered Godot base and blank starter before submitting ordinary form',async()=>{
  const f=fixture(),result=await createOperatorBlankGodot(f.api,'空白世界 · 新创意');
  assert.equal(result.baseId,'creation-sandbox');assert.equal(result.starter,'blank');assert.equal(result.sentModelPrompt,false);assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).submit,'[data-world-create="form"]');assert(!JSON.stringify(f.calls).includes('promo-'));
});
test('missing Godot option, undelivered base or UI errors fail without creating a substitute world',async()=>{
  for(const overrides of [{basePresent:false},{baseDisabled:true},{blankPresent:false},{formPresent:false},{error:'WORLD_CREATION_REJECTED'}]){const f=fixture(overrides);await assert.rejects(()=>createOperatorBlankGodot(f.api,'Blank'));assert.equal(f.calls.length,0);}
});
