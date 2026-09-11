import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftminePackageService}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-package-service.ts');
const bytes=Buffer.from('bounded fake export bytes'),sha=createHash('sha256').update(bytes).digest('hex');
const ref={assetId:'original-module',version:1,contentHash:'a'.repeat(64)};
test('native export projects declaration status/reference only and accepts old responses',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'parameter-projection-'));
 for(const parameterDeclaration of [undefined,{status:'unknown',reason:'ORIGINAL_RESOURCE_MANIFEST_MISSING'},{status:'source-declared',resourceRef:ref,parameters:{private:'not exposed'},sourceBinding:{path:'private'},context:{token:'private'}}]){
  const service=createCraftminePackageService({selection:()=> 'w',pickFile:async()=>path.join(directory,'out.zip'),domainCall:async()=>({archiveBase64:bytes.toString('base64'),archiveSha256:sha,files:1,requiredSourceFiles:0,...(parameterDeclaration?{parameterDeclaration}:{})})});
  const result=await service.request('package.request',{worldId:'w',method:'exportSource',params:{worldId:'w',assetId:'exported',version:1}});
  assert.equal(JSON.stringify(result).includes('private'),false);
  assert.deepEqual(result.parameterDeclaration,parameterDeclaration?.status==='source-declared'?{status:'source-declared',resourceRef:ref}:parameterDeclaration);
 }
});
test('path-shaped or malformed declaration references fail before file export',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'parameter-projection-reject-'));
 for(const parameterDeclaration of [null,{status:'/private'},{status:'unknown',reason:'D:/private'},{status:'source-declared'},{status:'source-declared',resourceRef:{...ref,contentHash:'bad'}},{status:'source-declared',resourceRef:{...ref,path:'private'}},{status:'source-declared',resourceRef:{...ref,assetId:'../private'}}]){
  const target=path.join(directory,'out.zip'),service=createCraftminePackageService({selection:()=> 'w',pickFile:async()=>target,domainCall:async()=>({archiveBase64:bytes.toString('base64'),archiveSha256:sha,parameterDeclaration})});
  await assert.rejects(service.request('package.request',{worldId:'w',method:'exportSource',params:{worldId:'w',assetId:'exported',version:1}}),/PACKAGE_PARAMETER_DECLARATION_INVALID/);assert.equal(fs.existsSync(target),false);
 }
});
