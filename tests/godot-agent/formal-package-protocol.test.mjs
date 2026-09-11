import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';
const root=path.resolve(import.meta.dirname,'../..'),main=path.join(root,'vendor/pi-desktop/apps/desktop/electron/main');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(main,'craftmine-package-service.ts'),'utf8'),{mode:'transform'})
  .replace("'./craftmine-backup-service'",JSON.stringify(pathToFileURL(path.join(main,'craftmine-backup-service.ts')).href));
const {createCraftminePackageService}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/desktop-native-package-protocol-'));
  const profile=path.join(out,'profile'),legacySource=path.join(out,'legacy'),token=randomUUID();fs.mkdirSync(profile);fs.mkdirSync(legacySource);
  fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
  const env={CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
  const protection=readHeadlessProfile(env);const selected=path.join(protection.root,'component.zip');const state={worldId:'world-fixture',calls:[],picks:0};
  const service=createCraftminePackageService({selection:()=>state.worldId,pickFile:async()=>{state.picks++;return selected;},domainCall:async(channel,input)=>{
    assert.equal(channel,'package.request');assert.equal(input.method,'installSource');state.calls.push(input.args);
    return {worldId:input.args.worldId,applied:false,status:'check-queued',archiveSha256:hash(Buffer.from(input.args.archiveBase64,'base64')),instanceIds:['fixture-instance'],source:{revision:1,manifestHash:'a'.repeat(64)},job:{jobId:'gjob-'+'b'.repeat(64),status:'queued'}};
  }});
  const call=(method,params={})=>service.request('package.request',{worldId:state.worldId,method,params:{worldId:state.worldId,...params}});
  return {out,profile,env,selected,state,service,call};
}
test('ordinary service uses the protected fixed path and fresh grants for sequential different packages',async()=>{
  const f=fixture();fs.writeFileSync(f.selected,'first opaque ZIP bytes');const first=await f.call('importSource',{operationId:randomUUID()});
  fs.writeFileSync(f.selected,'second opaque ZIP bytes');const second=await f.call('importSource',{operationId:randomUUID()});
  assert.notEqual(first.grantId,second.grantId);assert.notEqual(first.archiveSha256,second.archiveSha256);assert.equal(f.state.calls.length,2);assert.equal(f.state.picks,2);
  for(const call of f.state.calls)assert.deepEqual(Object.keys(call).sort(),['archiveBase64','operationId','worldId']);
  assert.equal(JSON.stringify([first,second]).includes(f.out),false);f.service.dispose();
});
test('replacing the selected file cannot reuse a prior file grant',async()=>{
  const f=fixture();fs.writeFileSync(f.selected,'first');const first=await f.call('importSource',{operationId:randomUUID()});fs.writeFileSync(f.selected,'changed');
  await assert.rejects(f.call('repeatImportSource',{operationId:randomUUID(),grantId:first.grantId}),/PACKAGE_FILE_CHANGED/);assert.equal(f.state.calls.length,1);f.service.dispose();
});
test('model/page paths, contexts and foreign-world grants cannot widen the normal import contract',async()=>{
  const f=fixture();fs.writeFileSync(f.selected,'first');
  for(const extra of [{path:f.selected},{archivePath:f.selected},{context:{projectId:'forged'}}])await assert.rejects(f.call('importSource',{operationId:randomUUID(),...extra}),/INVALID_PARAMS/);
  assert.equal(f.state.calls.length,0);const first=await f.call('importSource',{operationId:randomUUID()});f.state.worldId='other-world';
  await assert.rejects(f.call('repeatImportSource',{operationId:randomUUID(),grantId:first.grantId}),/PACKAGE_GRANT_WORLD_MISMATCH/);f.service.dispose();
});
test('headless profile validation rejects wrong tokens and an unprotected root',()=>{
  const f=fixture();assert.equal(readHeadlessProfile({...f.env,CRAFTMINE_HEADLESS_TEST:'0'}),null);
  assert.throws(()=>readHeadlessProfile({...f.env,CRAFTMINE_HEADLESS_TOKEN:'incorrect'}),/marker/);
  assert.throws(()=>readHeadlessProfile({...f.env,CRAFTMINE_HEADLESS_ROOT:root}),/dedicated/);f.service.dispose();
});
