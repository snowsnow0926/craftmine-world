import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {describePreview,canRetry,importRequestFor,mediaKindForType}=await import('../../vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/asset-library-model.ts');

test('scanned source ZIP uses the package kind in the actual import request',()=>{
 const item={path:'building.zip',mediaType:'application/zip',known:false};
 const request=importRequestFor(item,{assetId:'building',kind:'object',mediaKind:mediaKindForType(item.mediaType),displayName:'Building',sourceRoot:'D:/assets',source:{origin:'local',author:'author',license:'unknown',licenseStatus:'unverified'},tags:[]});
 assert.equal(request.mediaType,'application/zip');assert.equal(request.mediaKind,'package');assert.equal(request.sourcePath,'D:/assets/building.zip');
});

test('source archive preview directs the user to the real package checker without a success badge',()=>{
 const preview={status:'failed',detail:'ARCHIVE_REQUIRES_PACKAGE_CHECK',facts:{archiveValidated:false,executed:false}};
 assert.equal(canRetry(preview),false);
 for(const lang of ['zh','en']){
  const result=describePreview(preview,lang);assert.equal(result.tone,'neutral');assert.equal(result.picture,false);assert.equal(result.playable,false);assert.equal(result.canRetry,false);
  assert.ok(result.detail.includes('ZIP'));assert.ok(!result.label.includes('ARCHIVE_'));
 }
 assert.equal(canRetry({status:'failed',detail:'CORRUPT_ASSET_BODY'}),true);
});
