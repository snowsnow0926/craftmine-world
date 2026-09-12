import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {completeEnvironment} from '../godot-final/complete-contract.mjs';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function installedCreationElectron(directory){
  const marker=path.join(directory,'path.txt');
  if(!fs.existsSync(marker))throw Error('ELECTRON_BINARY_NOT_INSTALLED');
  const relative=fs.readFileSync(marker,'utf8').trim(),dist=path.resolve(directory,'dist'),executable=path.resolve(dist,relative),inside=path.relative(dist,executable);
  if(!relative||path.isAbsolute(relative)||!inside||inside==='..'||inside.startsWith('..'+path.sep)||!fs.existsSync(executable)||!fs.statSync(executable).isFile())throw Error('ELECTRON_BINARY_NOT_INSTALLED');
  return executable;
}
function sourceElectron(require,inherited){
  if(inherited.CRAFTMINE_ELECTRON_BIN!==undefined){const file=inherited.CRAFTMINE_ELECTRON_BIN;if(!path.isAbsolute(file)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error('ELECTRON_EXPLICIT_BINARY_INVALID');return file;}
  // Resolving package metadata does not execute Electron's install-on-require entry.
  return installedCreationElectron(path.dirname(require.resolve('electron/package.json')));
}
export function creationPackagedRoot(args=process.argv.slice(2),env=process.env){
  const indices=args.flatMap((arg,index)=>arg==='--packaged-root'?[index]:[]);
  if(indices.length>1)throw Error('PACKAGED_ROOT_DUPLICATE');
  const value=indices.length?args[indices[0]+1]:env.CRAFTMINE_PACKAGED_ROOT;
  if(indices.length&&(!value||value.startsWith('--')))throw Error('PACKAGED_ROOT_REQUIRED');
  if(value!==undefined&&(typeof value!=='string'||!value.trim()))throw Error('PACKAGED_ROOT_REQUIRED');
  if(indices.length&&env.CRAFTMINE_PACKAGED_ROOT&&path.resolve(value)!==path.resolve(env.CRAFTMINE_PACKAGED_ROOT))throw Error('PACKAGED_ROOT_CONFLICT');
  return value?path.resolve(value):null;
}

/** Hash actual package bytes; linked payloads cannot masquerade as shipped files. */
export function creationPackageInventory(directory){
  const root=path.resolve(directory),records=[];
  if(fs.realpathSync(root).toLowerCase()!==root.toLowerCase()||fs.lstatSync(root).isSymbolicLink())throw Error('PACKAGED_LINK_DENIED');
  function walk(relative=''){
    for(const name of fs.readdirSync(path.join(root,relative)).sort()){
      const item=path.join(relative,name),file=path.join(root,item),stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())throw Error('PACKAGED_LINK_DENIED: '+item);
      if(stat.isDirectory())walk(item);
      else if(stat.isFile()){const bytes=fs.readFileSync(file);records.push({path:item.replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}
      else throw Error('PACKAGED_FILE_REQUIRED: '+item);
    }
  }
  walk();return records;
}

export function resolveCreationNativeLaunch({root,packagedRoot=creationPackagedRoot(),inherited=process.env,requiredGuards=[]}){
  root=path.resolve(root);const desktop=path.join(root,'vendor/pi-desktop/apps/desktop'),require=createRequire(path.join(desktop,'package.json'));
  const packaged=packagedRoot?path.resolve(packagedRoot):null,resources=packaged?path.join(packaged,'resources'):null;
  let main,preload,identity=null;
  if(packaged){
    const files=creationPackageInventory(packaged),names=new Set(files.map(item=>item.path.toLowerCase()));
    for(const name of ['Craftmine World.exe','resources/app.asar','resources/bin/craftmine-core.exe','resources/bin/pi-desktop-host-core.exe','resources/godot/bases/base-catalog.json','resources/godot/shared/runtime_bridge.gd','resources/godot/toolchain.lock.json','resources/godot/broker/godot-host-broker.exe','resources/runtime-resources.json'])assert.ok(names.has(name.toLowerCase()),'PACKAGED_PAYLOAD_MISSING: '+name);
    assert.ok(files.some(item=>item.path.startsWith('resources/plugins/craftmine.world/')),'PACKAGED_PLUGIN_REQUIRED');
    assert.ok(files.some(item=>item.path.startsWith('resources/godot/engine/')),'PACKAGED_ENGINE_REQUIRED');
    const asar=loadPackageAsar(desktop),archive=path.join(resources,'app.asar');
    main=asar.extractFile(archive,path.normalize('out/main/index.js')).toString('utf8');preload=asar.extractFile(archive,path.normalize('out/preload/craftmine-headless.cjs')).toString('utf8');
    const metadata=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
    identity={format:'craftmine.creation-package-identity/1',packaged,version:metadata.version,mainSha256:sha(main),preloadSha256:sha(preload),files,inventorySha256:sha(JSON.stringify(files))};
  }else{main=fs.readFileSync(path.join(desktop,'out/main/index.js'),'utf8');preload=fs.readFileSync(path.join(desktop,'out/preload/craftmine-headless.cjs'),'utf8');}
  assert.ok(main.includes('offscreen: !!headlessAcceptance')||main.includes('offscreen: isOffscreenAcceptance()'),'HEADLESS_BUILD_REQUIRED: offscreen guard');
  for(const guard of ['configureHeadlessAcceptance()','focusable: !headlessAcceptance',...requiredGuards])assert.ok(main.includes(guard),'HEADLESS_BUILD_REQUIRED: '+guard);
  assert.ok(preload.includes('requestPointerLock'),'HEADLESS_POINTER_LOCK_GUARD_REQUIRED');
  return {
    packaged,main,identity,executable:packaged?path.join(packaged,'Craftmine World.exe'):sourceElectron(require,inherited),args:packaged?[]:[desktop],cwd:packaged??root,
    environment({out,profile,token}){
      const env=completeEnvironment(inherited,{out,profile,token,core:packaged?path.join(resources,'bin/craftmine-core.exe'):inherited.CRAFTMINE_EVAL_CORE??path.join(root,'vendor/pi-desktop/target/release/craftmine-core.exe'),host:packaged?path.join(resources,'bin/pi-desktop-host-core.exe'):inherited.CRAFTMINE_EVAL_HOST??path.join(root,'vendor/pi-desktop/target/release/pi-desktop-host-core.exe'),bases:packaged?undefined:inherited.CRAFTMINE_EVAL_BASES??path.join(root,'desktop/godot')});
      if(packaged)delete env.CRAFTMINE_GODOT_BASES;
      return env;
    },
    assertUnchanged(){if(packaged)assert.equal(sha(JSON.stringify(creationPackageInventory(packaged))),identity.inventorySha256,'PACKAGED_PAYLOAD_CHANGED');},
  };
}
