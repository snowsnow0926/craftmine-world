// Fresh managed authored sources -> fixed LPAC broker import/export -> actual
// Godot Web + production Electron verifier. No core/model/UI completion claim.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
import {addTargetFeedbackSiblingOverride} from './fixtures/target-feedback-sibling-override.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT;
const broker=process.env.CRAFTMINE_GODOT_BROKER_BIN,engineRoot=process.env.CRAFTMINE_GODOT_ENGINE_ROOT;
if(!dependencies||!broker||!engineRoot)throw Error('Explicit dependency, fixed broker and engine paths required');
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const electron=require('electron'),hash=value=>createHash('sha256').update(value).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results','target-feedback-verifier-'));
console.log('NATIVE_OUT '+out);
const setup={format:'craftmine.target-feedback-verifier-fixture/1',out,broker:{path:broker,sha256:hash(fs.readFileSync(broker))},electron:{path:electron,sha256:hash(fs.readFileSync(electron))},cases:[]};
const write=()=>fs.writeFileSync(path.join(out,'setup.json'),JSON.stringify(setup,null,2));write();
const list=directory=>fs.readdirSync(directory,{recursive:true}).filter(relative=>fs.lstatSync(path.join(directory,relative)).isFile()).map(relative=>{const bytes=fs.readFileSync(path.join(directory,relative));return {path:relative.replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)};}).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
async function runBroker(request,label){
 const child=spawn(broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>child.kill(),240000);
 child.stdin.write(JSON.stringify(request)+'\n');
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 fs.writeFileSync(path.join(out,label+'.stdout.log'),stdout);fs.writeFileSync(path.join(out,label+'.stderr.log'),stderr);
 const receipt=JSON.parse(stdout);fs.writeFileSync(path.join(out,label+'.receipt.json'),JSON.stringify(receipt,null,2));
 assert.equal(code,0);assert.equal(receipt.state,'succeeded',JSON.stringify(receipt));assert.equal(receipt.exitCode,0);
 assert.equal(receipt.cleanup?.verified,true);assert.equal(receipt.recoveryJournal?.cleared,true);
 assert.equal(receipt.processVerification?.verified,true);assert.equal(receipt.networkPreflight?.verified,true);
 assert.equal(receipt.sourceSnapshotDigest,request.sourceBinding.sourceDigest);assert.deepEqual(receipt.sourceBinding,request.sourceBinding);
 for(const log of receipt.logs??[]){const bytes=fs.readFileSync(path.join(receipt.logsRoot,log.path));assert.equal(hash(bytes),log.sha256);fs.writeFileSync(path.join(out,label+'-'+path.basename(log.path)),bytes);}
 return receipt;
}
const descriptors=[];
try{
 for(const name of ['positive','sibling-override']){
  const worldId='feedback-'+name,buildId='gbd-'+hash(name),jobId='gjob-'+hash('job-'+name),project=path.join(out,name,'source');
  materializeBase({baseId:'first-person',worldId,template:'training-range',out:project});
  const files=new Map(list(project).map(item=>[item.path,fs.readFileSync(path.join(project,item.path))]));
  const scenePath='scenes/training_range.tscn';
  if(name!=='positive'){
   const fixture=addTargetFeedbackSiblingOverride(files.get(scenePath).toString('utf8'));
   files.set(scenePath,Buffer.from(fixture.sceneText));for(const [file,bytes]of fixture.files){files.set(file,bytes);fs.mkdirSync(path.dirname(path.join(project,file)),{recursive:true});fs.writeFileSync(path.join(project,file),bytes);}
  }
  const args={scenePath,sceneText:files.get(scenePath).toString('utf8'),targetId:'target_a',files};
  const description=describeTargetFeedback(args),patch=patchTargetFeedback({...args,binding:description.binding,values:{hitFlashMilliseconds:500}});
  assert.equal(patch.changed,true);fs.writeFileSync(path.join(project,scenePath),patch.text);
  fs.writeFileSync(path.join(project,'shell.txt'),fs.readFileSync(path.join(root,'desktop/godot/web/shell.html')));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),'[preset.0]\nname="Web"\nplatform="Web"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n[preset.0.options]\ncustom_template/release=""\nvariant/thread_support=true\nvariant/extensions_support=false\nhtml/custom_html_shell="res://shell.txt"\nhtml/focus_canvas_on_start=false\nhtml/canvas_resize_policy=2\nprogressive_web_app/enabled=false\n');
  const sourceFiles=list(project),sourceDigest=hash(JSON.stringify(sourceFiles)),inputHash=hash(name+sourceDigest),tasksRoot=path.join(out,name,'tasks');fs.mkdirSync(tasksRoot);
  const binding={worldId,buildId,sourceRevision:0,sourceDigest};
  const record={name,sourceFiles,sourceDigest,sourceBinding:binding,sourceDeclarationMilliseconds:500,receipts:[]};setup.cases.push(record);write();
  let receipt;
  for(const operation of ['import','exportWeb']){
   const id='tf-'+randomBytes(8).toString('hex');
   receipt=await runBroker({schemaVersion:1,requestId:id,taskId:id,operation,projectRoot:project,tasksRoot,engineRoot,sourceBinding:binding,inputHash},name+'-'+operation);
   assert.deepEqual(receipt.sourceFiles,sourceFiles);record.receipts.push({operation,sourceSnapshotDigest:receipt.sourceSnapshotDigest,cleanup:receipt.cleanup});write();
  }
  const artifactsRoot=path.join(out,name,'artifacts'),web=path.join(artifactsRoot,'web');fs.mkdirSync(web,{recursive:true});
  for(const artifact of receipt.artifacts){
   assert.ok(!artifact.path.includes('..')&&!path.isAbsolute(artifact.path));const bytes=fs.readFileSync(path.join(receipt.artifactsRoot,artifact.path));assert.equal(hash(bytes),artifact.sha256);assert.equal(bytes.length,artifact.bytes);
   const dest=path.join(web,artifact.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
  }
  fs.copyFileSync(path.join(root,'desktop/godot/web/bridge.js'),path.join(web,'bridge.js'));
  const requirements={format:'craftmine.godot-check-requirements/1',targetFeedback:{targetId:'target_a',hitFlashMilliseconds:500}};
  descriptors.push({name,descriptor:{format:'craftmine.godot-check-descriptor/1',phase:'check',jobId,inputHash,worldId,buildId,baseId:'first-person',root:artifactsRoot,entry:'web/index.html',threads:true,artifacts:list(artifactsRoot),snapshot:null,checkRequirements:requirements,checkRequirementsHash:hash('craftmine.godot-check-requirements/1\ntarget_a\n500\n')}});
 }
 fs.writeFileSync(path.join(out,'descriptors.json'),JSON.stringify(descriptors,null,2));
 const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'finite-feedback-check',main:'main/index.cjs'}));
 for(const [entry,destination]of [['tests/player-product/target-feedback-verifier-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
 const log=fs.createWriteStream(path.join(out,'electron.log'));
 const child=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'profile')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_FEEDBACK_CHECK_OUT:out}});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),420000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);log.end();
 fs.writeFileSync(path.join(out,'electron-exit.json'),JSON.stringify({code}));
 const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));console.log(JSON.stringify({out,code,passed:report.passed,failure:report.failure??null}));assert.equal(code,0);assert.equal(report.passed,true);
 setup.passed=true;write();
}catch(error){setup.passed=false;setup.failure=String(error?.stack??error);write();throw error;}
