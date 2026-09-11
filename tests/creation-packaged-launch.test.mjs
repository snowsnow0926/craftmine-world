import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {creationPackagedRoot,creationPackageInventory,resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {loadPackageAsar} from '../desktop/package-asar.mjs';
const root=path.resolve(import.meta.dirname,'..'),desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
async function fixture(t,{pointer=true}={}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'creation-package-boundary-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const packaged=path.join(temporary,'package'),source=path.join(temporary,'asar-input');fs.mkdirSync(packaged);fs.mkdirSync(source);
 const write=(directory,name,text)=>{const target=path.join(directory,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 for(const file of ['Craftmine World.exe','resources/bin/craftmine-core.exe','resources/bin/pi-desktop-host-core.exe','resources/godot/bases/base-catalog.json','resources/godot/shared/runtime_bridge.gd','resources/godot/toolchain.lock.json','resources/godot/broker/godot-host-broker.exe','resources/runtime-resources.json','resources/plugins/craftmine.world/plugin.json','resources/godot/engine/test-engine.exe'])write(packaged,file,'synthetic boundary fixture, never executed');
 write(source,'package.json',JSON.stringify({version:'0.0.0-boundary-test'}));write(source,'out/main/index.js','configureHeadlessAcceptance(); focusable: !headlessAcceptance; offscreen: !!headlessAcceptance; craftmine-edit-acceptance');write(source,'out/preload/craftmine-headless.cjs',pointer?'requestPointerLock':'missing');
 await loadPackageAsar(desktop).createPackage(source,path.join(packaged,'resources/app.asar'));
 return {packaged,temporary};
}
test('packaged selection is explicit, rejects missing/duplicate/conflicting roots, and allows env',()=>{
 assert.equal(creationPackagedRoot([],{}),null);assert.equal(creationPackagedRoot([],{CRAFTMINE_PACKAGED_ROOT:root}),root);
 assert.equal(creationPackagedRoot(['--packaged-root',root],{}),root);
 for(const args of [['--packaged-root'],['--packaged-root','--other'],['--packaged-root',root,'--packaged-root',root]])assert.throws(()=>creationPackagedRoot(args,{}),/PACKAGED_ROOT/);
 assert.throws(()=>creationPackagedRoot(['--packaged-root',root],{CRAFTMINE_PACKAGED_ROOT:path.dirname(root)}),/CONFLICT/);
});
test('packaged launch uses its EXE with no source argument, ASAR guards and exact payload identity',async t=>{
 const {packaged}=await fixture(t),client=resolveCreationNativeLaunch({root,packagedRoot:packaged,inherited:{CRAFTMINE_ELECTRON_BIN:'wrong-source-electron',CRAFTMINE_EVAL_CORE:'wrong-core',CRAFTMINE_EVAL_HOST:'wrong-host',CRAFTMINE_EVAL_BASES:'wrong-bases'},requiredGuards:['craftmine-edit-acceptance']});
 assert.equal(client.executable,path.join(packaged,'Craftmine World.exe'));assert.deepEqual(client.args,[]);assert.equal(client.cwd,packaged);assert.equal(client.identity.version,'0.0.0-boundary-test');assert.match(client.identity.inventorySha256,/^[a-f0-9]{64}$/);
 for(const file of ['Craftmine World.exe','resources/app.asar','resources/bin/craftmine-core.exe','resources/godot/shared/runtime_bridge.gd'])assert.ok(client.identity.files.find(item=>item.path===file&&item.bytes>0&&/^[a-f0-9]{64}$/.test(item.sha256)));
 const env=client.environment({out:'/independent/out',profile:'/independent/profile',token:'private-token'});assert.equal(env.CRAFTMINE_CORE_BIN,path.join(packaged,'resources/bin/craftmine-core.exe'));assert.equal(env.PI_DESKTOP_HOST_BIN,path.join(packaged,'resources/bin/pi-desktop-host-core.exe'));assert.equal(env.CRAFTMINE_GODOT_BASES,undefined);assert.equal(env.CRAFTMINE_EVAL_BASES,undefined);assert.equal(env.CRAFTMINE_HEADLESS_TEST,'1');assert.equal(env.CRAFTMINE_DATA_DIR,'/independent/profile');client.assertUnchanged();
});
test('packaged preflight requires the actual preload Pointer Lock guard before any launch',async t=>{
 const {packaged}=await fixture(t,{pointer:false});assert.throws(()=>resolveCreationNativeLaunch({root,packagedRoot:packaged}),/POINTER_LOCK_GUARD/);
});
test('missing core does not fall back to a source override; changed payload fails its frozen identity',async t=>{
 const {packaged}=await fixture(t),client=resolveCreationNativeLaunch({root,packagedRoot:packaged});
 fs.writeFileSync(path.join(packaged,'resources/godot/shared/runtime_bridge.gd'),'changed');assert.throws(()=>client.assertUnchanged(),/PAYLOAD_CHANGED/);
 fs.unlinkSync(path.join(packaged,'resources/bin/craftmine-core.exe'));assert.throws(()=>resolveCreationNativeLaunch({root,packagedRoot:packaged,inherited:{CRAFTMINE_EVAL_CORE:'some-existing-source-core'}}),/PAYLOAD_MISSING/);
});
test('linked package contents are rejected without traversing or launching their target',async t=>{
 const {packaged,temporary}=await fixture(t),outside=path.join(temporary,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sentinel'),'untouched');
 fs.symlinkSync(outside,path.join(packaged,'linked'),'junction');assert.throws(()=>creationPackageInventory(packaged),/LINK_DENIED/);assert.equal(fs.readFileSync(path.join(outside,'sentinel'),'utf8'),'untouched');
});
