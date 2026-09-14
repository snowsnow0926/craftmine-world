import {createGameplayController,validateInputSegment,type GameplayControllerAccess,type InputSegment} from './headless-gameplay-controller';
import type {PlayIdentity} from './headless-play-action';

export type HeadlessInputAccess=GameplayControllerAccess & {
  enabled:()=>boolean;
  owner:()=>{visible:boolean;focused:boolean;focusable:boolean;offscreen:boolean}|null;
  unavailable:()=>boolean;
};
function identity(input:unknown):PlayIdentity {
  const value=input as Record<string,unknown>;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='buildId,instanceId,worldId'
    ||Object.values(value).some(value=>typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)))throw Error('HEADLESS_INPUT_IDENTITY');
  return {...value} as PlayIdentity;
}
export function validateHeadlessInputEnvelope(input:unknown,enabled:boolean) {
  const request=input as Record<string,any>;
  if(!enabled)throw Error('HEADLESS_INPUT_PRIVATE_ONLY');
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!=='id,method,payload,type'
    ||request.type!=='craftmine-headless'||typeof request.id!=='string'||!/^[a-zA-Z0-9._:-]{1,160}$/.test(request.id)
    ||!['inputSegment','cancelInputs'].includes(request.method))throw Error('HEADLESS_INPUT_ENVELOPE');
  const payload=request.payload;
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).sort().join(',')!==(request.method==='inputSegment'?'identity,segment':'identity'))throw Error('HEADLESS_INPUT_FIELDS');
  const selected=identity(payload.identity);
  if(request.method==='inputSegment')validateInputSegment(payload.segment);
  return {method:request.method as 'inputSegment'|'cancelInputs',identity:selected,...(request.method==='inputSegment'?{segment:structuredClone(payload.segment) as InputSegment}:{})};
}
/** Parent-process IPC only. No renderer, model, arbitrary script or source route. */
export function createHeadlessInputControl(access:HeadlessInputAccess) {
  const assertOwner=()=>{
    if(!access.enabled())throw Error('HEADLESS_INPUT_PRIVATE_ONLY');
    const owner=access.owner();
    if(!owner||owner.visible||owner.focused||owner.focusable||!owner.offscreen)throw Error('HEADLESS_INPUT_OWNER_UNSAFE');
  };
  const gameplay=createGameplayController({...access,assertReady:()=>{
    assertOwner();
    if(access.unavailable())throw Error('HEADLESS_INPUT_WORLD_BUSY');
  }});
  return {
    get busy(){return gameplay.busy;},
    drain:()=>gameplay.drain(),
    async handle(input:unknown){
      const request=validateHeadlessInputEnvelope(input,access.enabled());
      assertOwner();
      if(request.method==='cancelInputs')return gameplay.cancel(request.identity);
      if(access.unavailable())throw Error('HEADLESS_INPUT_WORLD_BUSY');
      try{return await gameplay.segment(request.identity,request.segment!);}
      catch(error){
        // Retain partial native evidence and release outcome on failures without
        // letting an errored segment masquerade as completed gameplay.
        const evidence=(error as {gameplayEvidence?:unknown})?.gameplayEvidence;
        if(!evidence)throw error;
        return {format:'craftmine.gameplay-segment/1',status:'failed',identity:request.identity,requested:request.segment,
          semanticSuccess:null,error:String(error),partialEvidence:evidence};
      }
    },
  };
}
