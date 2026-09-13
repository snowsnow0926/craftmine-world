/** Bounded product protocol shared by the PI renderer and native main. */
export type DirectAssetRef = {assetId:string;version:number;contentHash:string};
export type DirectPosition = {x:number;y:number;z:number};
export type DirectLibraryRequest =
  | {action:'inspect';worldId:string;ref:DirectAssetRef}
  | {action:'start';worldId:string;ref:DirectAssetRef;operationId:string;position?:DirectPosition}
  | {action:'status'|'cancel'|'apply';worldId:string;operationId:string};
export type DirectLibraryInspection = {eligible:boolean;reason?:string;displayName?:string;compatibility:'unchecked';positionSupported:boolean};
export type DirectLibraryOperation = {
  operationId:string;worldId:string;ref:DirectAssetRef;position?:DirectPosition;
  status:'preparing'|'checking'|'ready'|'applying'|'applied'|'cancelled'|'failed'|'interrupted';
  stage:string;instanceIds:string[];jobId?:string;candidateId?:string;
  error?:{code:string;message:string};draftRetained:boolean;modelCalls:0;createdAt:number;updatedAt:number;
};
export type DirectLibraryResponse = DirectLibraryInspection | DirectLibraryOperation;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>{if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('DIRECT_LIBRARY_INVALID_REQUEST');};
export function validateDirectLibraryRequest(value:unknown):DirectLibraryRequest {
  if(!object(value)||!['inspect','start','status','cancel','apply'].includes(value.action))throw Error('DIRECT_LIBRARY_INVALID_REQUEST');
  exact(value,value.action==='inspect'?['action','worldId','ref']:value.action==='start'?['action','worldId','ref','operationId','position']:['action','worldId','operationId']);
  if(typeof value.worldId!=='string'||!value.worldId.trim()||value.worldId.length>128)throw Error('DIRECT_LIBRARY_INVALID_WORLD');
  if(value.action!=='inspect'&&(typeof value.operationId!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(value.operationId)))throw Error('DIRECT_LIBRARY_INVALID_OPERATION');
  if(value.action==='inspect'||value.action==='start'){
    exact(value.ref,['assetId','version','contentHash']);const r=value.ref;
    if(typeof r.assetId!=='string'||!r.assetId.trim()||r.assetId.length>128||['latest','*'].includes(r.assetId)||!Number.isSafeInteger(r.version)||r.version<1||! /^[a-f0-9]{64}$/.test(r.contentHash))throw Error('DIRECT_LIBRARY_INVALID_REFERENCE');
  }
  if(value.position!==undefined){exact(value.position,['x','y','z']);if(!['x','y','z'].every(k=>Number.isFinite(value.position[k])&&Math.abs(value.position[k])<=80))throw Error('DIRECT_LIBRARY_INVALID_POSITION');}
  return structuredClone(value) as DirectLibraryRequest;
}
