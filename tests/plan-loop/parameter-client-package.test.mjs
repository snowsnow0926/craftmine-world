// Small real ASAR/filesystem fixtures only; never launches Electron or a game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';
import {resourceInventory} from '../../desktop/prepare-runtime-resources.mjs';
import {parameterClientArguments,inspectParameterPackage,isolatedParameterEnvironment} from './parameter-client-package.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),commit='a'.repeat(40),manifestHash='b'.repeat(64);
const absolute=path.resolve('fixture');
test('explicit packaged mode requires frozen identity and rejects ambiguous or development overrides',()=>{
 const common=['--source-root',absolute,'--deps-app',absolute],valid=[...common,'--packaged-root',absolute,'--expected-commit',commit,'--expected-build-manifest-sha256',manifestHash];
 assert.equal(parameterClientArguments(valid).runtime,null);assert.equal(parameterClientArguments([...common,'--runtime-source',absolute]).packaged,null);
 for(const args of [[...common,'--packaged-root',absolute],[...valid,'--runtime-source',absolute],[...valid,'--packaged-root',absolute],[...valid,'--unknown','x'],[...valid,'--source-root'],['--source-root','relative','--deps-app',absolute,'--runtime-source',absolute],[...common,'--runtime-source',absolute,'--expected-commit',commit]])assert.throws(()=>parameterClientArguments(args));
});
test('package environment removes inherited development, model and Electron switches',()=>{
 const paths={out:'out',profile:'profile',token:'token',core:'package/core',host:'package/host',bases:'package/godot'};
 const env=isolatedParameterEnvironment({PATH:'system',SystemRoot:'windows',CRAFTMINE_GODOT_ENGINE_ROOT:'foreign',CRAFTMINE_TEST_LIVE_REVIEW:'1',CRAFTMINE_CORE_BIN:'foreign',PI_DESKTOP_DEV:'1',ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:'--require foreign'},paths);
 assert.equal(env.PATH,'system');assert.equal(env.CRAFTMINE_CORE_BIN,paths.core);assert.equal(env.CRAFTMINE_GODOT_BASES,paths.bases);assert.equal(env.CRAFTMINE_HEADLESS_TEST,'1');for(const key of ['CRAFTMINE_GODOT_ENGINE_ROOT','CRAFTMINE_TEST_LIVE_REVIEW','PI_DESKTOP_DEV','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'])assert.equal(env[key],undefined);
});
const deps=process.env.CRAFTMINE_TEST_DESKTOP_DIRECTORY;
if(!deps)throw Error('CRAFTMINE_TEST_DESKTOP_DIRECTORY must explicitly name ASAR inspection tooling');
const asar=loadPackageAsar(deps);
async function fixture({wrongMain=false,missingGuard=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parameter-package-')),packaged=path.join(dir,'package'),resources=path.join(packaged,'resources'),input=path.join(dir,'asar-input');
 const write=(file,body)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);};
 write(path.join(packaged,'Craftmine World.exe'),'fixture exe, never launched');
 write(path.join(input,'package.json'),JSON.stringify({main:wrongMain?'other.js':'./out/main/index.js',version:'fixture'}));
 write(path.join(input,'out/main/index.js'),'configureHeadlessAcceptance(); focusable: !headlessAcceptance; offscreen: !!headlessAcceptance; '+(missingGuard?'':'targetFeedback.describe'));
 write(path.join(input,'out/preload/craftmine-headless.cjs'),'requestPointerLock');
 fs.mkdirSync(resources,{recursive:true});await asar.createPackage(input,path.join(resources,'app.asar'));
 const mappings=[['vendor/pi-desktop/target/release/craftmine-core.exe','bin/craftmine-core.exe'],['vendor/pi-desktop/target/release/pi-desktop-host-core.exe','bin/pi-desktop-host-core.exe'],['vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js','agent-runtime/sidecar.js'],['vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json','plugins/craftmine.world/manifest.json'],['desktop/build/CraftmineWorld-source.zip','source/CraftmineWorld-source.zip']];
 const artifacts=mappings.map(([p,relative])=>{const body=Buffer.from(relative);write(path.join(resources,relative),body);return {path:p,bytes:body.length,sha256:sha(body)};});
 write(path.join(resources,'plugins/craftmine.world/views/view.js'),'fixture plugin');
 for(const name of ['git','godot','licenses/godot','licenses/gpl'])fs.mkdirSync(path.join(resources,name),{recursive:true});
 const runtime={format:'craftmine.runtime-resources/1',sourceCommit:commit,files:[],filesDigest:sha('[]')};const runtimeBytes=Buffer.from(JSON.stringify(runtime));write(path.join(resources,'runtime-resources.json'),runtimeBytes);
 const manifest={format:'craftmine.build/1',commit,clientFiles:await resourceInventory(path.join(input,'out')),pluginFiles:await resourceInventory(path.join(resources,'plugins/craftmine.world')),artifacts,sourceArchiveHash:artifacts.at(-1).sha256,runtime:{filesDigest:runtime.filesDigest,manifestSha256:sha(runtimeBytes)}};
 const manifestFile=path.join(resources,'source/build-manifest.json');write(manifestFile,JSON.stringify(manifest));
 return {dir,packaged,resources,manifest,manifestFile,options:{packaged,expectedCommit:commit,expectedManifestHash:sha(fs.readFileSync(manifestFile)),asar}};
}
test('real fixture ASAR and package bytes resolve only bundled launch/runtime paths',async()=>{
 const f=await fixture(),result=await inspectParameterPackage(f.options);assert.equal(result.executable,path.join(f.packaged,'Craftmine World.exe'));assert.deepEqual(result.arguments,[]);assert.equal(result.cwd,f.packaged);assert.equal(result.core,path.join(f.resources,'bin/craftmine-core.exe'));assert.equal(result.bases,path.join(f.resources,'godot'));assert.equal(result.identity.commit,commit);
});
test('missing package never falls back to the supplied source/dependency tree',async()=>{await assert.rejects(inspectParameterPackage({packaged:path.join(absolute,'missing'),expectedCommit:commit,expectedManifestHash:manifestHash,asar}),/ENOENT/);});
test('wrong expected commit/hash and invalid entry or absent feature reject before launch',async()=>{
 const f=await fixture();await assert.rejects(inspectParameterPackage({...f.options,expectedCommit:'c'.repeat(40)}),/PACKAGE_SOURCE_COMMIT_MISMATCH/);await assert.rejects(inspectParameterPackage({...f.options,expectedManifestHash:manifestHash}),/PACKAGE_BUILD_MANIFEST_HASH_MISMATCH/);
 for(const variant of [{wrongMain:true},{missingGuard:true}]){const x=await fixture(variant);await assert.rejects(inspectParameterPackage(x.options),/PACKAGE_MAIN_ENTRY_MISMATCH|PACKAGE_ISOLATION_OR_FEATURE_MISSING/);}
});
test('missing/tampered native, plugin and runtime files are not substituted',async()=>{
 for(const [relative,remove,pattern]of [['bin/craftmine-core.exe',true,/ENOENT/],['bin/pi-desktop-host-core.exe',false,/PACKAGE_BINARY_OR_SOURCE_HASH_MISMATCH/],['plugins/craftmine.world/views/view.js',false,/PACKAGE_PLUGIN_HASH_MISMATCH/],['godot/extra.gd',false,/RUNTIME_RESOURCE_HASH_MISMATCH/]]){
  const f=await fixture(),file=path.join(f.resources,relative);if(remove)fs.unlinkSync(file);else fs.writeFileSync(file,'tampered');await assert.rejects(inspectParameterPackage(f.options),pattern);
 }
});
test('frozen manifest cannot nominate traversal or unbound guard bytes',async()=>{
 for(const change of [m=>m.clientFiles[0].path='../main.js',m=>m.clientFiles=m.clientFiles.filter(f=>f.path!=='preload/craftmine-headless.cjs')]){const f=await fixture();change(f.manifest);fs.writeFileSync(f.manifestFile,JSON.stringify(f.manifest));await assert.rejects(inspectParameterPackage({...f.options,expectedManifestHash:sha(fs.readFileSync(f.manifestFile))}),/RUNTIME_RESOURCE_PATH_INVALID|PACKAGE_CLIENT_GUARD_UNBOUND/);}
});
