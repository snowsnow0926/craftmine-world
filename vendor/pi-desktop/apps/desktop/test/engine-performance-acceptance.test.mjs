import test from 'node:test';import assert from 'node:assert/strict';import{register}from'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {validateEnginePerformanceAcceptance:validate}=await import('../electron/main/craftmine-performance-acceptance.ts');
test('engine performance parent controller accepts only the exact bound identity',()=>{
 const value={type:'craftmine-headless',id:'request-1',method:'godotEnginePerformance',payload:{worldId:'world-1',buildId:'build-1',instanceId:'instance-1'}};
 assert.deepEqual(validate(value,true),value.payload);assert.throws(()=>validate(value,false));
 for(const patch of [{script:'arbitrary'},{path:'C:/private'},{nonce:'chosen'},{worldId:'../other'}])assert.throws(()=>validate({...value,payload:{...value.payload,...patch}},true));
 assert.throws(()=>validate({...value,extra:true},true));assert.throws(()=>validate({...value,method:'arbitrary'},true));
});
