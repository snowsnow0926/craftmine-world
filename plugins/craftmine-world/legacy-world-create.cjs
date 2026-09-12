'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
/** A durable creation receipt allows the same Web create to recover a lost reply. */
async function createLegacyWorld({directory,call,emptyWorld},input){
 const title=String(input.title??'').trim();
 if(!input.operationId)return call('world.create',{id:randomUUID(),title,world:emptyWorld(title)});
 if(typeof input.operationId!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(input.operationId))throw Error('INVALID_WORLD_OPERATION_ID');
 const request={operationId:input.operationId,title,baseId:'craftmine-web/5',starterId:'blank'};
 const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 const receiptFile=path.join(directory,'world-create-operations',createHash('sha256').update(input.operationId).digest('hex')+'.json');
 let receipt;
 if(fs.existsSync(receiptFile)){
  if(fs.statSync(receiptFile).size>8192)throw Error('WORLD_CREATE_RECEIPT_INVALID');
  receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  if(receipt.format!=='craftmine.web-world-create/1'||receipt.requestHash!==requestHash||typeof receipt.worldId!=='string'||!/^[a-f0-9-]{36}$/.test(receipt.worldId))throw Error('WORLD_CREATE_OPERATION_CONFLICT');
 }else{
  receipt={format:'craftmine.web-world-create/1',requestHash,worldId:randomUUID()};
  fs.mkdirSync(path.dirname(receiptFile),{recursive:true});fs.writeFileSync(receiptFile,JSON.stringify(receipt),{flag:'wx'});
 }
 const existing=async()=>{try{const record=await call('world.read',{id:receipt.worldId});
   if(record.runtimeKind!=='legacy')throw Error('WORLD_CREATE_OPERATION_CONFLICT');return record;
  }catch(error){if((error.code??error.errorCode)==='WORLD_NOT_FOUND'||/^(?:Error: )?WORLD_NOT_FOUND$/.test(String(error.message??error)))return null;throw error;}};
 const known=await existing();if(known)return known;
 try{return await call('world.create',{id:receipt.worldId,title,world:emptyWorld(title)});}
 catch(error){const committed=await existing();if(committed)return committed;throw error;}
}
module.exports={createLegacyWorld};
