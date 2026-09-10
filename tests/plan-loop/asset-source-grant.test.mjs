// Exact production methods with real filesystem/policy helpers; no plugin process or native picker.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {register,stripTypeScriptTypes} from 'node:module';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const policy=await import('../../vendor/pi-desktop/packages/plugin-sdk/src/fs-policy.ts');
const panel=await import('../../vendor/pi-desktop/apps/desktop/electron/main/fs-panel.ts');
const source=fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts',import.meta.url),'utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>0&&b>a);return source.slice(a,b);};
const methods=part('  async authorizeCraftmineAssetSource(', '  /** Private orchestrator-to-domain bridge;')
 +part('  private async resolveFsRequest(', '  /**\n   * Ask the user,').replaceAll('\r\n','\n');
const dependencies={lstatSync:fs.lstatSync,opendirSync:fs.opendirSync,existsSync:fs.existsSync,
 resolve:path.resolve,isAbsolute:path.isAbsolute,join:path.join,relative:path.relative,sep:path.sep,
 normalizeFsPath:policy.normalizeFsPath,isDeniedFsPath:policy.isDeniedFsPath,isFsPathInScope:policy.isFsPathInScope,
 resolveRealPathWithinRoot:panel.resolveRealPathWithinRoot,resolveWithinRoot:panel.resolveWithinRoot,
 realpathOrSelf:p=>fs.realpathSync(path.resolve(p)),apiError:(code,message)=>Object.assign(Error(message),{code})};
const Class=Function(...Object.keys(dependencies),stripTypeScriptTypes(`class Grant {${methods}}`)+ ';return Grant;')(...Object.values(dependencies));
const parent=new URL('../../test-results/asset-source-grants/',import.meta.url);fs.mkdirSync(parent,{recursive:true});
function fixture(){
 const root=fs.mkdtempSync(new URL('case-',parent)),f=new Class(),loaded={child:{},userRoot:root,manifest:{id:'craftmine.world'},permissions:new Set(['fs.read']),fsPolicy:{read:{root:'userSelected'}}};
 f.loaded=new Map([['craftmine.world',loaded]]);f.services={protectedPaths:()=>[]};f.auditFs=()=>{};f.assertPermission=(l,p)=>{if(!l.permissions.has(p))throw Error('PERMISSION_DENIED');};
 return{root,f,loaded};
}
test('real finite directory grant accepts ordinary files and rejects roots or files outside the pick',async()=>{
 const {root,f}=fixture();fs.writeFileSync(path.join(root,'pixel.png'),'fixed fixture');
 await f.authorizeCraftmineAssetSource(root,path.join(root,'pixel.png'));
 await assert.rejects(f.authorizeCraftmineAssetSource(path.dirname(root)),/Choose the asset directory again/);
 await assert.rejects(f.authorizeCraftmineAssetSource(root,path.join(path.dirname(root),'missing-outside.png')),/escapes/);
});
test('read permission and explicit userSelected policy remain required',async()=>{
 for(const change of [l=>l.permissions.clear(),l=>l.fsPolicy.read.root='workspace',l=>delete l.userRoot]){
  const {root,f,loaded}=fixture();change(loaded);await assert.rejects(f.authorizeCraftmineAssetSource(root));
 }
});
test('protected or denied descendants are rejected before any core scan',async()=>{
 for(const name of ['.env','.git', 'protected']){
  const {root,f}=fixture(),item=path.join(root,name);fs.mkdirSync(item);fs.writeFileSync(path.join(item,'fixture.png'),'synthetic nonsecret fixture');
  if(name==='protected')f.services.protectedPaths=()=>[item];
  await assert.rejects(f.authorizeCraftmineAssetSource(root),/reserved|never readable/);
 }
});
test('linked ordinary files are rejected without reading their content',async()=>{
 const {root,f}=fixture(),file=path.join(root,'a.png');fs.writeFileSync(file,'synthetic fixture');fs.linkSync(file,path.join(root,'b.png'));
 await assert.rejects(f.authorizeCraftmineAssetSource(root),/NOT_ORDINARY/);
});
test('scan preflight rejects excessive depth and entry count instead of scanning partially',async()=>{
 const deep=fixture();let directory=deep.root;for(let n=0;n<17;n++){directory=path.join(directory,'d');fs.mkdirSync(directory);}
 await assert.rejects(deep.f.authorizeCraftmineAssetSource(deep.root),/DIRECTORY_LIMIT/);
 const wide=fixture();for(let n=0;n<1024;n++)fs.writeFileSync(path.join(wide.root,`${n}.png`),'');
 await assert.rejects(wide.f.authorizeCraftmineAssetSource(wide.root),/DIRECTORY_LIMIT/);
});
test('changing the picker grant during real authorization is rejected',async()=>{
 const {root,f,loaded}=fixture(),original=f.resolveFsRequest.bind(f);f.resolveFsRequest=async(...args)=>{const r=await original(...args);loaded.userRoot=path.dirname(root);return r;};
 await assert.rejects(f.authorizeCraftmineAssetSource(root),/grant changed/);
});
