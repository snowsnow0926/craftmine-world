// Fixed fresh-source acceptance; no history cleanup, input, models or personal profiles.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {materializeBase} from 'file:///D:/cm-fb-20260910/desktop/godot/shared/materialize.mjs';
const root="D:/cm-fb-20260910";
assert.equal(root[0].toUpperCase(),'D');
const deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT;
assert.ok(deps&&path.isAbsolute(deps),'Explicit read-only dependency root required');
const require=createRequire(path.join(deps,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(deps,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=require('electron'),hash=x=>createHash('sha256').update(x).digest('hex');
const sourceCommit=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim();
const {inspectParameterPackage}=await import('file:///D:/cm-fb-20260910/tests/plan-loop/parameter-client-package.mjs');
const {loadPackageAsar}=await import('file:///D:/cm-fb-20260910/desktop/package-asar.mjs');
const packageInfo=await inspectParameterPackage({packaged:"D:/cm-fb-20260910/desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked",expectedCommit:'b9c0c0d5bdf371280d1a9814773d614e02920e16',expectedManifestHash:'82ff45ab47e683c35bba3a6f76b545cea27a1968b0c9381eae7d5f5f02c34284',asar:loadPackageAsar(path.join(root,'vendor/pi-desktop/apps/desktop'))});
if(sourceCommit!==packageInfo.identity.commit)throw Error('Frozen source mismatch');
const out=fs.mkdtempSync(path.join(root,'test-results/p7-native-'));
const core="D:/cm-fb-20260910/desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked/resources/bin/craftmine-core.exe";
const broker="D:/cm-fb-20260910/desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked/resources/godot/broker/godot-host-broker.exe";
const engineRoot="D:/cm-fb-20260910/desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked/resources/godot/engine/4.7.2-stable";
const identity="D:/cm-fb-20260910/desktop/build/releases/b9c0c0d5bdf3-1b22d534-54c2-4a0f-80a6-1028eb4b0df6/output/win-unpacked/resources/godot/broker/broker-identity.json";
const config={root,out,core,broker,engineRoot,identity,sourceCommit,deps,cases:[],identities:{
 core:{path:core,sha256:hash(fs.readFileSync(core))},broker:JSON.parse(fs.readFileSync(identity)),
 electron:{path:electron,sha256:hash(fs.readFileSync(electron))}},createdAt:new Date().toISOString()};
config.identities.package=packageInfo.identity;config.identities.externalDriver={path:import.meta.url,sha256:hash(fs.readFileSync(new URL(import.meta.url)))};
config.sourceFiles=['desktop/godot/sandbox/src/launch.rs','desktop/godot/sandbox/src/preflight.rs','desktop/godot/sandbox/src/task.rs','desktop/godot/sandbox/src/broker.rs','plugins/craftmine-world/godot-executor.cjs','plugins/craftmine-world/godot-task-bin-retirement.cjs','vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier.ts','tests/player-feedback/P7/retirement-native.mjs','tests/player-feedback/P7/retirement-electron.mjs'].map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))}));
config.workingTree=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout;
const sourceExtensions=new Set(['.godot','.gd','.tscn','.tres','.gdshader','.gdshaderinc','.json','.cfg','.txt','.md','.csv','.svg','.obj','.mtl','.uid','.png','.jpg','.jpeg','.webp','.glb','.ogg','.wav']);
for(const name of ['success-one','success-two','syntax-failure']){
 const worldId='retire-'+name,source=path.join(out,'source',name);
 const materialized=materializeBase({baseId:'first-person',worldId,template:'blank',out:source});
 if(name==='syntax-failure'){
  const project=path.join(source,'project.godot');fs.writeFileSync(project,fs.readFileSync(project,'utf8').replace('[autoload]','[autoload]\nP7Failure="*res://p7_failure.gd"'));
  fs.writeFileSync(path.join(source,'p7_failure.gd'),'extends Node\nfunc broken(:\n');
 }
 const files=fs.readdirSync(source,{recursive:true}).filter(relative=>fs.lstatSync(path.join(source,relative)).isFile())
  .filter(relative=>sourceExtensions.has(path.extname(relative).toLowerCase())&&!['managed-base.json','export_presets.cfg','shell.txt','bridge.js'].includes(relative)).map(relative=>{
    const bytes=fs.readFileSync(path.join(source,relative));return {path:relative.replaceAll('\\','/'),bytesBase64:bytes.toString('base64'),sha256:hash(bytes)};
  });
 const original=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/shared/initial-states/first-person-blank.json'))).snapshot;
 original.worldId=worldId;original.body.worldId=worldId;
 config.cases.push({name,worldId,files,snapshot:original,source,materialized});
}
fs.writeFileSync(path.join(out,'config.json'),JSON.stringify(config));
const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));
fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'p7-native-retirement',main:'main/index.cjs'}));
for(const [entry,target]of [['tests/player-feedback/P7/retirement-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,target),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_P7_CONFIG:path.join(out,'config.json'),TEMP:path.join(root,'test-results/temp'),TMP:path.join(root,'test-results/temp')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
const child=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'profile')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,'electron-'+stream+'.log'),bytes));
let forced=false;const timer=setTimeout(()=>{forced=true;child.kill();},900000);
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,forced}));});clearTimeout(timer);
fs.writeFileSync(path.join(out,'electron-exit.json'),JSON.stringify(exit));
console.log(JSON.stringify({out,exit}));assert.equal(exit.code,0);assert.equal(forced,false);
assert.equal(JSON.parse(fs.readFileSync(path.join(out,'report.json'))).passed,true);
