import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {versionDiffClientArguments,versionDiffLaunchPlan} from './version-diff-client-package.mjs';
const base=['--source-root',path.resolve('source'),'--deps-app',path.resolve('deps'),'--source-core',path.resolve('archive/craftmine.world'),'--world','world-a','--output-parent',path.resolve('test-results')];
const packaged=[...base,'--packaged-root',path.resolve('package'),'--expected-commit','a'.repeat(40),'--expected-build-manifest-sha256','b'.repeat(64)];
test('VM2 accepts explicit development and requires full independently supplied package identity',()=>{
 assert.equal(versionDiffClientArguments(base)['--packaged-root'],undefined);
 assert.equal(versionDiffClientArguments(packaged)['--expected-commit'],'a'.repeat(40));
 for(const args of [[...base,'--packaged-root',path.resolve('package')],[...base,'--expected-commit','a'.repeat(40)],[...packaged,'--runtime-source',path.resolve('other')],[...packaged,'--expected-commit','c'.repeat(40)]])assert.throws(()=>versionDiffClientArguments(args));
});
test('package launch and fixture core never fall back to development binaries',()=>{
 const packageInfo={executable:'package/app.exe',core:'package/core.exe',host:'package/host.exe',bases:'package/godot',cwd:'package'};
 const plan=versionDiffLaunchPlan({packaged:'package',packageInfo,root:'development',app:'development/app',electron:'development/electron'});
 assert.deepEqual(plan,{executable:packageInfo.executable,args:[],cwd:packageInfo.cwd,core:packageInfo.core,host:packageInfo.host,bases:packageInfo.bases});
 for(const field of ['executable','core','host','bases','cwd'])assert.throws(()=>versionDiffLaunchPlan({packaged:'package',packageInfo:{...packageInfo,[field]:null},root:'development',app:'app',electron:'electron'}),/VERIFIED_PACKAGE_REQUIRED/);
 const development=versionDiffLaunchPlan({packaged:null,packageInfo:null,root:'development',app:'app',electron:'electron'});assert.deepEqual(development.args,['app']);assert.equal(development.executable,'electron');
});
