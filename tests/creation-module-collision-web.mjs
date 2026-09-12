// Fixed authored projects through actual Web exports, verifier and candidate staging.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json')),{build}=require('esbuild'),electron=require('electron');
const {COLLISION_PROTECTED_FILES,verifyCreationPack}=require(path.join(root,'plugins/craftmine-world/godot-creation-pack.cjs'));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/creation-module-collision-web-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function files(directory,relative=''){return fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).flatMap(e=>{const name=relative?relative+'/'+e.name:e.name;return e.isDirectory()?files(directory,name):[{path:name,bytes:fs.statSync(path.join(directory,name)).size,sha256:hash(fs.readFileSync(path.join(directory,name)))}];});}
const report={out,passed:false,scope:'trusted authored source, actual pinned exports and production runtime classes; no core-issued application or external asset execution',projects:[]};
try{
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});report.engine=env.actualVersion;report.runs=env.runs;
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8'),preset=JSON.parse(host.match(/const EXPORT_PRESET: &str = ("(?:\\.|[^"\\])*");/)[1]);
 let snapshot;
 for(const variant of ['formal','candidate','blocked']){
  const project=path.join(out,variant),artifactsRoot=path.join(out,variant+'-artifacts'),web=path.join(artifactsRoot,'web');fs.mkdirSync(web,{recursive:true});materializeBase({baseId:'creation-sandbox',worldId:'collision-web-world',out:project});
  snapshot??={format:'craftmine.godot-progress/1',worldId:'collision-web-world',baseId:'creation-sandbox',baseVersion:'1.0.0',stateVersion:1,body:JSON.parse(fs.readFileSync(path.join(project,'craftmine_initial_state.json'))).initialProgress};
  // Actual packaged play produced this resting height. Verify its exact
  // restoration in Web, not only an idealized y=0.9 initial pose.
  snapshot.body.player.position[1]=0.898971319198608;
  if(variant!=='formal'){
   const scene=path.join(project,'scenes/creation.tscn');let text=fs.readFileSync(scene,'utf8');
   // The negative candidate has a different authored initial spawn. Its saved
   // pose remains z=6: the guard must query that requested pose after restore.
   if(variant==='blocked')text=text.replace('position = Vector3(0, 0.9, 6)','position = Vector3(0, 0.9, 12)');
   fs.writeFileSync(scene,text.replace('load_steps=5','load_steps=6').replace('[node name="CreationWorld"','[sub_resource type="BoxShape3D" id="ModuleBody"]\nsize = Vector3(4, 3, 8)\n\n[node name="CreationWorld"')+'\n[node name="ImportedBuilding" type="StaticBody3D" parent="."]\nposition = Vector3(0, 1.5, '+(variant==='blocked'?'6':'0')+')\ncollision_layer = 2\ncollision_mask = 8\n\n[node name="CollisionShape3D" type="CollisionShape3D" parent="ImportedBuilding"]\nshape = SubResource("ModuleBody")\n');
  }
  const pins=COLLISION_PROTECTED_FILES.map(relative=>{const bytes=fs.readFileSync(path.join(project,relative));return {path:relative,bytes:bytes.length,sha256:hash(bytes)};});
  fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));fs.writeFileSync(path.join(project,'export_presets.cfg'),preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/'))));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);await env.run(variant+'-export',['--path',project,'--export-release','Web',path.join(web,'index.html')],{timeout:120000});fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(web,'bridge.js'));
  const artifacts=files(artifactsRoot),buildId='gbd-'+hash(JSON.stringify(artifacts));report.projects.push({variant,packProof:verifyCreationPack(fs.readFileSync(path.join(web,'index.pck')),pins),descriptor:{worldId:'collision-web-world',baseId:'creation-sandbox',buildId,root:artifactsRoot,entry:'web/index.html',threads:true,artifacts,snapshot,revision:0}});
 }
 const appRoot=path.join(out,'electron');fs.mkdirSync(path.join(appRoot,'main'),{recursive:true});fs.mkdirSync(path.join(appRoot,'preload'));fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({name:'collision-guard-check',main:'main/index.cjs'}));fs.writeFileSync(path.join(appRoot,'main/owner.html'),'<!doctype html><title>Isolated collision check</title>');
 fs.writeFileSync(path.join(out,'cases.json'),JSON.stringify(report.projects));
 for(const [entry,target]of [['tests/fixtures/creation-module-collision-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/craftmine-headless.ts','preload/craftmine-headless.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appRoot,target),bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22',logLevel:'warning'});
 const log=fs.createWriteStream(path.join(out,'electron.log')),child=spawn(electron,[appRoot,'--user-data-dir='+path.join(out,'profile')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_COLLISION_OUT:out}});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),360000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));log.end();report.electron=JSON.parse(fs.readFileSync(path.join(out,'electron-report.json')));assert.equal(code,0,JSON.stringify(report.electron));assert.equal(report.electron.passed,true);report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.electron?.error}));}
