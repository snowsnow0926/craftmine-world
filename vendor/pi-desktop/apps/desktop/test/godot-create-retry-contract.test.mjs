import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';import {register}from'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldFactory}=await import('../electron/main/godot-world-creation.ts');
const root=path.resolve(import.meta.dirname,'../../../../..');
test('registered failed create is idempotent and only explicit retry recovers its original identity',async()=>{
 const directory=fs.mkdtempSync(path.join(root,'test-results/godot-create-contract-'));
 const starts=[],domainCalls=[];let builds=0;
 const failed={status:'blocked',reason:'GODOT_CHECK_FAILED',playable:false,initId:'host-init-id'};
 const factory=createGodotWorldFactory({worldsRoot:directory,catalogFile:path.join(root,'desktop/godot/bases/base-catalog.json'),basesRoot:path.join(root,'desktop/godot/bases'),
  materialize:({out})=>{builds++;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'world.json'),JSON.stringify({initialProgress:{coins:0}}));},
  domain:async(method,args)=>{domainCalls.push(method);if(method==='godotWorld.initialize')return{init:{...failed,worldId:args.worldId}};if(method==='godotWorld.initStatus')return{...failed,worldId:args.worldId};throw Error(method);},
  initialization:{start:async(worldId,options)=>{starts.push({worldId,options});},running:()=>false,error:()=>null},
 });
 const request={title:'Preserve original attributes',baseId:'top-down',operationId:'retry-form-contract-20260913'};
 const initial=await factory.create(request),again=await factory.create({...request});
 assert.equal(initial.id,again.id);assert.equal(initial.state,'failed');assert.equal(again.state,'failed');assert.equal(builds,1);assert.equal(starts.length,0);
 await assert.rejects(factory.create({...request,title:'Pretend edit'}),/WORLD_EXISTS/);
 assert.equal(builds,1);assert.equal(starts.length,0);
 await factory.retry(initial.id);assert.deepEqual(starts,[{worldId:initial.id,options:{recover:true}}]);
 assert.deepEqual(domainCalls,['godotWorld.initialize','godotWorld.initStatus']);
});
