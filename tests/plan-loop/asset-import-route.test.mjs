import assert from 'node:assert/strict';
import test from 'node:test';
import {register} from 'node:module';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {requestAssetPanel}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-asset-panel.ts');
test('native PNG positive fixture has valid chunk checksums and one decoded pixel',()=>{
 const source=readFileSync(new URL('./asset-client-native.mjs',import.meta.url),'utf8');
 const encoded=source.match(/Buffer\.from\('(iVBOR[^']+)'\s*,\s*'base64'\)/)?.[1];assert.ok(encoded);
 const bytes=Buffer.from(encoded,'base64');let pixels;
 for(let offset=8;offset<bytes.length;){const size=bytes.readUInt32BE(offset),end=offset+8+size;assert.ok(end+4<=bytes.length);let crc=0xffffffff;
  for(const byte of bytes.subarray(offset+4,end)){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  assert.equal((crc^0xffffffff)>>>0,bytes.readUInt32BE(end),'PNG chunk CRC');
  if(bytes.toString('ascii',offset+4,offset+8)==='IDAT')pixels=inflateSync(bytes.subarray(offset+8,end));offset=end+4;
 }
 assert.deepEqual(pixels,Buffer.from([1,255,255]));
});
const imported={ownerWorldId:'world-a',operationId:'import-fixture',assetId:'fixture',version:1,sourceRoot:'D:/owned-fixture',sourcePath:'D:/owned-fixture/pixel.png',kind:'raw',mediaKind:'image',path:'pixel.png',mediaType:'image/png',displayName:'Pixel',source:{origin:'fixture',author:'fixture',license:'unknown',licenseStatus:'unknown'}};
function fixture(){
 const f={calls:[],grants:[],selected:'world-a',session:'session-a',grantValid:true};
 f.options={viewingSession:()=>f.session,authorizeAssetSource:async(...args)=>{f.grants.push(args);if(!f.grantValid)throw Error('GRANT_CHANGED');},domain:async(method,args)=>{if(method==='selection.read')return{worldId:f.selected};f.calls.push({method,args});return{status:'completed',assetId:args.args.assetId};}};
 return f;
}
test('import consumes the real selected directory grant before dispatch and before returning',async()=>{
 const f=fixture();await requestAssetPanel('asset.import',imported,f.options);
 assert.deepEqual(f.calls,[{method:'asset.request',args:{method:'importAsset',args:Object.fromEntries(Object.entries(imported).filter(([k])=>k!=='ownerWorldId'))}}]);
 assert.deepEqual(f.grants,[[imported.sourceRoot,imported.sourcePath],[imported.sourceRoot,imported.sourcePath]]);
});
test('scan authorizes the directory; preview uses only a managed identity',async()=>{
 const f=fixture();await requestAssetPanel('asset.scan',{ownerWorldId:'world-a',sourceRoot:imported.sourceRoot},f.options);
 assert.deepEqual(f.grants,[[imported.sourceRoot,undefined],[imported.sourceRoot,undefined]]);
 await requestAssetPanel('asset.preview',{ownerWorldId:'world-a',assetId:'fixture',version:1},f.options);
 assert.equal(f.grants.length,2);assert.equal(f.calls.at(-1).args.method,'preview');
});
test('missing or revoked grants, stale owners and unknown path fields dispatch nothing',async()=>{
 for(const mutation of [f=>delete f.options.authorizeAssetSource,f=>f.grantValid=false,f=>f.selected='world-b']){
  const f=fixture();mutation(f);await assert.rejects(requestAssetPanel('asset.import',imported,f.options));assert.deepEqual(f.calls,[]);
 }
 const f=fixture();await assert.rejects(requestAssetPanel('asset.preview',{ownerWorldId:'world-a',assetId:'fixture',version:1,sourcePath:imported.sourcePath},f.options),/INVALID_ASSET_PANEL_REQUEST/);assert.deepEqual(f.calls,[]);
});
test('a world switch during authorization cannot dispatch into the old world',async()=>{
 const f=fixture();f.options.authorizeAssetSource=async()=>{f.selected='world-b';};
 await assert.rejects(requestAssetPanel('asset.import',imported,f.options),/OWNER_CHANGED/);assert.deepEqual(f.calls,[]);
});
test('late durable import response is rejected after grant revocation; retry rechecks grant',async()=>{
 const f=fixture(),base=f.options.domain;f.options.domain=async(method,args)=>{const value=await base(method,args);if(method==='asset.request')f.grantValid=false;return value;};
 await assert.rejects(requestAssetPanel('asset.import',imported,f.options),/GRANT_CHANGED/);assert.equal(f.calls.length,1);
 await assert.rejects(requestAssetPanel('asset.import',imported,f.options),/GRANT_CHANGED/);assert.equal(f.calls.length,1);
});
test('late preview response cannot paint another owner or viewing session',async()=>{
 for(const mutate of [f=>f.selected='world-b',f=>f.session='session-b']){
  const f=fixture(),base=f.options.domain;f.options.domain=async(method,args)=>{const value=await base(method,args);if(method==='asset.request')mutate(f);return value;};
  await assert.rejects(requestAssetPanel('asset.preview',{ownerWorldId:'world-a',assetId:'fixture',version:1},f.options),/OWNER_CHANGED/);
 }
});
