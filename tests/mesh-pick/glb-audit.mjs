// Materialize the exact CLOSED formal source commit read-only, then use LPAC
// for the derivative forensic observer. Never executes external code trusted.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
import {validateExternalReceipt} from '../../scripts/lib/godot-external-receipt.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const v2=process.argv.includes('--v2');
const cohort=process.env.GODOT_PICKER_COHORT_DIR;
assert.ok(!cohort||v2,'controller cohort requires --v2');
const sourceReport='D:/cm-gu6-formal-0912/test-results/desktop-native-complete-QaRnRb/report.json';
const formal=JSON.parse(fs.readFileSync(sourceReport)),pin=formal.packages.at(-1).imported.source;
const repo='D:/cm-gu6-formal-0912/test-results/desktop-native-complete-QaRnRb/profile/plugins/data/craftmine.world/content-history/repos/3dade57f54fd63015f4ee21103d4b2e1/repo.git';
const brokerRoot='D:/Craftmine-World-preview.11/win-unpacked/resources/godot/broker',broker=path.join(brokerRoot,'godot-host-broker.exe');
const engineRoot='D:/Craftmine World/desktop/build/godot/4.7.2-stable';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=args=>execFileSync('git',['--git-dir='+repo,...args],{windowsHide:true,maxBuffer:16*1024*1024});
assert.equal(git(['rev-parse','refs/heads/main']).toString().trim(),pin.commitOid);
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/glb-pick-audit-')),project=path.join(out,'project'),tasksRoot=path.join(out,'tasks');fs.mkdirSync(project);fs.mkdirSync(tasksRoot);
const names=git(['ls-tree','-r','-z','--name-only',pin.commitOid]).toString().split('\0').filter(Boolean),original=[];
for(const name of names){assert.ok(!name.includes('..')&&!path.isAbsolute(name));const bytes=git(['show',pin.commitOid+':'+name]);fs.mkdirSync(path.dirname(path.join(project,name)),{recursive:true});fs.writeFileSync(path.join(project,name),bytes);original.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
fs.copyFileSync(path.join(root,'tests/mesh-pick/glb-audit.gd'),path.join(project,'glb_audit.gd'));
if(v2){
 fs.copyFileSync(path.join(root,'tests/mesh-pick/glb-v2.gd'),path.join(project,'glb_v2.gd'));
 fs.copyFileSync(path.join(root,'desktop/godot/shared/scene_mesh_picker_v2.gd'),path.join(project,'craftmine_shared/scene_mesh_picker_v2.gd'));
}
if(cohort){
 fs.copyFileSync(path.join(project,'craftmine_shared/base_adapter.gd'),path.join(project,'craftmine_shared/base_adapter_legacy.gd'));
 fs.copyFileSync(path.join(cohort,'adapters/creation-sandbox-controller-v1.gd'),path.join(project,'craftmine_shared/base_adapter.gd'));
 fs.copyFileSync(path.join(cohort,'controller_evidence.gd'),path.join(project,'craftmine_shared/controller_evidence.gd'));
}
const projectFile=path.join(project,'project.godot');fs.writeFileSync(projectFile,fs.readFileSync(projectFile,'utf8').replace('[autoload]','[autoload]\nGlbAudit="*res://glb_audit.gd"'));
if(v2)fs.writeFileSync(projectFile,fs.readFileSync(projectFile,'utf8').replace('GlbAudit="*res://glb_audit.gd"','GlbAudit="*res://glb_v2.gd"'));
fs.writeFileSync(path.join(project,'export_presets.cfg'),fs.readFileSync(path.join(root,'desktop/godot/sandbox/fixtures/web-sample/export_presets.cfg'),'utf8').replace('html/focus_canvas_on_start=true','html/focus_canvas_on_start=false'));
const sourceFiles=fs.readdirSync(project,{recursive:true}).map(p=>p.replaceAll('\\','/')).filter(p=>fs.statSync(path.join(project,p)).isFile()).sort().map(p=>{const b=fs.readFileSync(path.join(project,p));return {path:p,bytes:b.length,sha256:hash(b)};});
const sourceDigest=hash(JSON.stringify(sourceFiles)),identity=JSON.parse(fs.readFileSync(path.join(brokerRoot,'broker-identity.json')));assert.equal(hash(fs.readFileSync(broker)),identity.sha256);
const id='gpa-'+Date.now(),request={schemaVersion:1,requestId:id,taskId:id,operation:'exportWeb',projectRoot:project,tasksRoot,engineRoot,sourceBinding:{worldId:formal.worldId,buildId:id,sourceRevision:1,sourceDigest},inputHash:hash(id)};
const report={format:'craftmine.glb-picker-audit/1',out,sourceReport,formalSourcePin:pin,originalFiles:original,request,originalPickerSha256:hash(fs.readFileSync(path.join(project,'craftmine_shared/scene_mesh_picker.gd')))};
report.mode=v2?'v2-base-surface-triangles':'legacy-negative';
report.cohort=cohort?'controller-v1-plus-picker-v2':'legacy-adapter';
if(v2)report.v2PickerSha256=hash(fs.readFileSync(path.join(project,'craftmine_shared/scene_mesh_picker_v2.gd')));
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();console.log('EVIDENCE_DIRECTORY='+out);
const child=spawn(broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',timer;
const code=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',resolve);child.stdin.write(JSON.stringify(request)+'\n');timer=setTimeout(()=>child.stdin.write('{"cancel":true}\n'),180000);}).finally(()=>clearTimeout(timer));
report.transportExitCode=code;
fs.writeFileSync(path.join(out,'broker.stdout'),stdout);fs.writeFileSync(path.join(out,'broker.stderr'),stderr);report.receipt=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));report.validation=validateExternalReceipt(request,report.receipt,{brokerSha256:identity.sha256,transportExitCode:code,expectedSourceFiles:sourceFiles});save();assert.equal(report.validation.valid,true,JSON.stringify(report.validation));
const artifacts=report.receipt.artifactsRoot;for(const file of report.receipt.artifacts)assert.equal(hash(fs.readFileSync(path.join(artifacts,file.path))),file.sha256);
const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html',file=path.resolve(artifacts,rel);if(!file.startsWith(path.resolve(artifacts)+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await playwright().chromium.launchPersistentContext(path.join(out,'browser'),{...browserOptions(),headless:true,viewport:{width:1280,height:720},args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await browser.addInitScript(()=>{globalThis.__guard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{__guard.pointerLock++;throw Error('Pointer Lock disabled');};HTMLElement.prototype.focus=()=>{__guard.focus++;};window.focus=()=>{__guard.focus++;};globalThis.__pending=new Map();globalThis.CraftmineGame={register:cb=>{globalThis.__receiver=cb;},complete:text=>{const result=JSON.parse(text);__pending.get(result.id)?.(result);__pending.delete(result.id);}};});
 const page=await browser.newPage();report.console=[];report.pageErrors=[];page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>report.pageErrors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>typeof __receiver==='function',{},{timeout:60000});
 report.bridge=await page.evaluate(async scope=>{const call=op=>new Promise(resolve=>{__pending.set(op,resolve);__receiver(JSON.stringify({id:op,op,...scope,args:{}}));});return {load:await call('load'),resume:await call('resume')};},{worldId:formal.worldId,buildId:id,instanceId:'glb-forensic'});
 await page.waitForFunction(()=>globalThis.__GLB_PICK_AUDIT!==undefined,{},{timeout:60000});report.result=await page.evaluate(()=>__GLB_PICK_AUDIT);report.guard=await page.evaluate(()=>__guard);
 if(v2){
  report.bridge.observe=await page.evaluate(scope=>new Promise(resolve=>{__pending.set('observe',resolve);__receiver(JSON.stringify({id:'observe',op:'observe',...scope,args:{}}));}),{worldId:formal.worldId,buildId:id,instanceId:'glb-forensic'});
  const expected=report.result.cases.adapterBuildingObservation.sceneObjectTarget,creation=report.bridge.observe.result.creation;
  assert.equal(creation.sceneObjectTarget.objectId,expected.objectId);assert.equal(creation.sceneObjectTarget.nodePath,expected.nodePath);
  assert.ok(creation.sceneObjectRefs.some(ref=>ref.objectId===expected.objectId));
  if(cohort){assert.equal(creation.sceneObjectSelection.geometryBasis,'base-surface-arrays');assert.equal(creation.sceneObjectSelection.renderLodVerified,false);assert.equal(creation.sceneObjectSelection.pixelAccurate,false);}
 }
 await page.screenshot({path:path.join(out,'building-alone.png')});save();assert.equal(report.result.passed,true,JSON.stringify(report.result));assert.deepEqual(report.guard,{pointerLock:0,focus:0});assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.console.filter(item=>item.type==='error'||/SCRIPT ERROR|Parse Error|ERROR:/.test(item.text)),[]);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));assert.equal(git(['rev-parse','refs/heads/main']).toString().trim(),pin.commitOid);report.originalSourceUnchanged=true;save();}
console.log(JSON.stringify({out,result:report.result,guard:report.guard},null,2));
