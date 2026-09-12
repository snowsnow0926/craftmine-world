// Actual package installer + isolated Rust worlds + LPAC/Web semantics. No model
// calls, input simulation, formal world application or player-save claim.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {createManagedPackageInstaller,createManagedPackageSourceService} from '../../plugins/craftmine-world/reuse-service.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {buildKenneyCityPackage} from '../../scripts/lib/kenney-city-package.mjs';
import {validateExternalReceipt} from '../../scripts/lib/godot-external-receipt.mjs';
import {playwright,browserOptions} from '../../app/browser-tools.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sourceRoot='D:/cm-agent-godot-0912/test-results/external-resources-20260912/kenney-city';
const coreBinary=process.env.CRAFTMINE_CORE_BIN||'D:/Craftmine-World-preview.11/win-unpacked/resources/bin/craftmine-core.exe';
const brokerDirectory='D:/Craftmine-World-preview.11/win-unpacked/resources/godot/broker';
const engineRoot='D:/Craftmine World/desktop/build/godot/4.7.2-stable';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>fs.readFileSync(file);const json=file=>JSON.parse(read(file));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results','kenney-module-'));
const report={format:'craftmine.kenney-module-reuse/1',out,coreSha256:hash(read(coreBinary)),packages:[],installs:[],checks:[],worlds:[]};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const check=(value,name)=>{report.checks.push({name,passed:!!value});assert.ok(value,name);save();};
console.log('EVIDENCE_DIRECTORY='+out);
const core=new CoreClient(coreBinary,path.join(out,'core-data'));
const contexts=Object.fromEntries(['city-a','city-b'].map(worldId=>[worldId,{projectId:'module-'+worldId,sessionId:'session-'+worldId,turnId:'module-reuse'}]));
const call=(method,args)=>core.call(method,args,120000);
function listFiles(directory){return fs.readdirSync(directory,{recursive:true}).map(relative=>relative.replaceAll('\\','/')).filter(relative=>fs.statSync(path.join(directory,relative)).isFile()).sort().map(relative=>({path:relative,bytes:read(path.join(directory,relative)).length,sha256:hash(read(path.join(directory,relative)))}));}
async function materializeManaged(worldId,directory){
  fs.mkdirSync(directory);let offset=0,pin;
  do{const page=await call('godotProject.index',{context:contexts[worldId],worldId,...pin,offset,limit:32});pin??={revision:page.revision,manifestHash:page.manifestHash};
    for(const entry of page.files){const chunks=[];let next=0;do{const part=await call('godotProject.read',{context:contexts[worldId],worldId,...pin,path:entry.path,offset:next,limit:16000});assert.equal(part.sha256,entry.sha256);chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));next=part.nextOffset;}while(next!=null);
      const bytes=Buffer.concat(chunks);assert.equal(hash(bytes),entry.sha256);fs.mkdirSync(path.dirname(path.join(directory,entry.path)),{recursive:true});fs.writeFileSync(path.join(directory,entry.path),bytes);}
    offset=page.nextOffset;
  }while(offset!=null);return pin;
}
async function restricted(project,worldId){
  const broker=path.join(brokerDirectory,'godot-host-broker.exe'),identity=json(path.join(brokerDirectory,'broker-identity.json'));assert.equal(hash(read(broker)),identity.sha256);
  const tasksRoot=path.join(out,'tasks');fs.mkdirSync(tasksRoot,{recursive:true});const sourceFiles=listFiles(project),sourceDigest=hash(JSON.stringify(sourceFiles));
  const taskId='km-'+worldId+'-'+Date.now(),request={schemaVersion:1,requestId:taskId,taskId,operation:'exportWeb',projectRoot:project,tasksRoot,engineRoot,
    sourceBinding:{worldId,buildId:taskId,sourceRevision:1,sourceDigest},inputHash:hash(taskId)};
  fs.writeFileSync(path.join(out,taskId+'-request.json'),JSON.stringify(request,null,2));
  const child=spawn(broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',timer;
  const cancel=()=>{if(!child.stdin.destroyed)child.stdin.write('{"cancel":true}\n');};process.once('SIGINT',cancel);
  const code=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',resolve);child.stdin.write(JSON.stringify(request)+'\n');timer=setTimeout(cancel,180000);}).finally(()=>{clearTimeout(timer);process.removeListener('SIGINT',cancel);});
  fs.writeFileSync(path.join(out,taskId+'-stderr.log'),stderr);fs.writeFileSync(path.join(out,taskId+'-stdout.log'),stdout);
  const receipt=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));fs.writeFileSync(path.join(out,taskId+'-receipt.json'),JSON.stringify(receipt,null,2));
  const validation=validateExternalReceipt(request,receipt,{brokerSha256:identity.sha256,transportExitCode:code,expectedSourceFiles:sourceFiles});
  const execution={taskId,receipt:path.join(out,taskId+'-receipt.json'),validation,artifactsRoot:receipt.artifactsRoot,error:receipt.error};report.worlds.push({worldId,execution});save();assert.equal(validation.valid,true,JSON.stringify({validation,error:receipt.error}));
  return {receipt,record:report.worlds.at(-1)};
}
async function browserProbe(receipt,record){
  for(const artifact of receipt.artifacts)assert.equal(hash(read(path.join(receipt.artifactsRoot,artifact.path))),artifact.sha256);
  const server=http.createServer((req,res)=>{const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html',file=path.resolve(receipt.artifactsRoot,relative);if(!file.startsWith(path.resolve(receipt.artifactsRoot)+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
  record.browser={console:[],pageErrors:[]};save();
  try{
    browser=await playwright().chromium.launchPersistentContext(path.join(out,record.worldId+'-browser'),{...browserOptions(),headless:true,viewport:{width:1280,height:720},args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
    await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await browser.addInitScript(()=>{globalThis.__guard={pointerLock:0,focus:0};Element.prototype.requestPointerLock=()=>{__guard.pointerLock++;throw Error('Pointer Lock disabled');};HTMLElement.prototype.focus=()=>{__guard.focus++;};window.focus=()=>{__guard.focus++;};
      globalThis.__bridgePending=new Map();globalThis.CraftmineGame={register:callback=>{globalThis.__bridgeCallback=callback;},complete:text=>{const result=JSON.parse(text);__bridgePending.get(result.id)?.(result);__bridgePending.delete(result.id);}};
    });
    const page=await browser.newPage();page.on('console',message=>record.browser.console.push({type:message.type(),text:message.text()}));page.on('pageerror',error=>record.browser.pageErrors.push(error.message));
    await page.goto(origin,{timeout:60000});await page.waitForFunction(()=>typeof globalThis.__bridgeCallback==='function',{},{timeout:60000});
    record.browser.bridge=await page.evaluate(async scope=>{const call=op=>new Promise(resolve=>{const id='fixture-'+op;__bridgePending.set(id,resolve);__bridgeCallback(JSON.stringify({id,op,...scope,args:{}}));});return {load:await call('load'),resume:await call('resume')};},{worldId:record.worldId,buildId:record.execution.taskId,instanceId:'fixture-'+record.worldId});
    await page.waitForFunction(()=>globalThis.__KENNEY_REUSE!==undefined,{},{timeout:60000});
    record.browser.probe=await page.evaluate(()=>globalThis.__KENNEY_REUSE);record.browser.guard=await page.evaluate(()=>__guard);
    await page.screenshot({path:path.join(out,record.worldId+'.png')});record.browser.screenshot=path.join(out,record.worldId+'.png');save();
    assert.equal(record.browser.probe.passed,true,JSON.stringify(record.browser.probe));assert.deepEqual(record.browser.guard,{pointerLock:0,focus:0});assert.equal(record.browser.pageErrors.length,0);
    assert.equal(record.browser.console.filter(row=>/SCRIPT ERROR|ERROR:|Parse Error/.test(row.text)).length,0,JSON.stringify(record.browser.console));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));save();}
}
try{
  await core.start();
  const packages={};for(const kind of ['building','road']){const entry=buildKenneyCityPackage({sourceRoot,kind});packages[kind]=entry;fs.writeFileSync(path.join(out,kind+'.zip'),entry.archive);report.packages.push({kind,assetId:entry.assetId,archiveSha256:entry.archiveSha256,bytes:entry.archive.length,manifest:entry.manifest});}save();
  for(const worldId of ['city-a','city-b']){
    const project=path.join(out,worldId+'-base');materializeBase({baseId:'creation-sandbox',worldId,out:project});
    const files=listFiles(project).filter(file=>file.path!=='managed-base.json').map(file=>({path:file.path,text:read(path.join(project,file.path)).toString('utf8')}));
    await call('world.create',{id:worldId,title:worldId,world:{build:{id:'base-'+worldId,scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',baseVersion:'1.0.0',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
    await call('workspace.open',{context:contexts[worldId],selectedWorld:worldId});
    const first=[files.find(file=>file.path==='project.godot'),...files.filter(file=>file.path!=='project.godot').slice(0,15)];
    let created=await call('godotProject.create',{context:contexts[worldId],worldId,toolCallId:'create',baseBuild:'base-'+worldId,baseId:'creation-sandbox',files:first});
    const remaining=files.filter(file=>!first.some(initial=>initial.path===file.path));
    if(remaining.length)created=await call('godotProject.patch',{context:contexts[worldId],worldId,toolCallId:'complete-base',revision:created.revision,manifestHash:created.manifestHash,operations:remaining.map(file=>({op:'put',...file,expectedHash:null}))});
    await call('content.migrate.apply',{worldId});
  }
  const installer=createManagedPackageInstaller({call,stagingRoot:path.join(out,'installer'),bind:async(worldId,operationId)=>{const status=await call('content.status',{worldId}),worldRecord=await call('world.read',{id:worldId});return {context:contexts[worldId],worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:'main',expectedHeadOid:status.headOid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};},enqueue:async()=>{throw Error('No executor registered in isolated core; external probe remains LPAC');}});
  const install=async(worldId,name,archive)=>{const result=await installer({worldId,operationId:worldId+'-'+name,archiveBase64:archive.toString('base64')});assert.equal(result.status,'source-saved-check-blocked');report.installs.push({worldId,name,...result});save();return result;};
  const a1=await install('city-a','building-one',packages.building.archive),a2=await install('city-a','building-two',packages.building.archive);await install('city-a','road',packages.road.archive);
  check(a1.instanceIds[0]!==a2.instanceIds[0],'same package installs twice with different stable instance IDs');
  const source=createManagedPackageSourceService({call,bind:async worldId=>({context:contexts[worldId],worldRecord:await call('world.read',{id:worldId})})});
  const listing=await source.listSource({worldId:'city-a'});const selected=listing.items.find(item=>item.entityId===a1.instanceIds[0]+'-e0')||listing.items.find(item=>item.nodePath.includes(a1.instanceIds[0]));assert.ok(selected,JSON.stringify(listing));
  const extracted=await source.exportSource({worldId:'city-a',revision:listing.revision,manifestHash:listing.manifestHash,nodePath:selected.nodePath,assetId:'kenney-building-roundtrip',version:1});
  const unpacked=unpackStaticPackage(Buffer.from(extracted.archiveBase64,'base64'));const roundtrip=unpacked.resources[0];
  check([...roundtrip.files.keys()].some(name=>name.endsWith('models/Textures/colormap.png')),'managed source extraction retains external GLB texture');
  check([...roundtrip.files.keys()].some(name=>name.endsWith('licenses/README.md')),'managed source extraction preserves referenced CC0 declaration');
  for(const name of ['LICENSE.md','README.md']){const actual=roundtrip.files.get([...roundtrip.files.keys()].find(file=>file.endsWith('licenses/'+name)));check(actual&&hash(actual)===hash(read(path.join(sourceRoot,name))),'roundtrip license bytes unchanged: '+name);}
  check(roundtrip.manifest.content.licenses.sourceDeclarations?.length===1,'roundtrip preserves explicit machine-readable attribution reference');
  for(const declaration of roundtrip.manifest.content.licenses.sourceDeclarations)check(hash(roundtrip.files.get(declaration.path))===declaration.sha256,'roundtrip attribution reference hash matches packaged bytes');
  report.roundtrip={...extracted,archiveBase64:undefined,files:[...roundtrip.files.keys()]};fs.writeFileSync(path.join(out,'building-roundtrip.zip'),Buffer.from(extracted.archiveBase64,'base64'));save();
  await install('city-b','roundtrip-building',Buffer.from(extracted.archiveBase64,'base64'));await install('city-b','road',packages.road.archive);
  for(const worldId of ['city-a','city-b']){
    check((await call('world.read',{id:worldId})).world.build.id==='base-'+worldId,'formal world remains unapplied: '+worldId);
    const project=path.join(out,worldId+'-probe');const pin=await materializeManaged(worldId,project);const map=json(path.join(project,'craftmine.instances.json'));check(map.instances.length===(worldId==='city-a'?3:2),'existing instance registry count: '+worldId);
    const probe=fs.readFileSync(path.join(root,'tests/fixtures/kenney-reuse-probe.gd'),'utf8').replace('__EXPECTED_COUNT__',String(map.instances.length));fs.writeFileSync(path.join(project,'trial_probe.gd'),probe);
    const projectFile=path.join(project,'project.godot');fs.writeFileSync(projectFile,fs.readFileSync(projectFile,'utf8').replace('[autoload]','[autoload]\nKenneyTrial="*res://trial_probe.gd"'));
    fs.writeFileSync(path.join(project,'export_presets.cfg'),fs.readFileSync(path.join(root,'desktop/godot/sandbox/fixtures/web-sample/export_presets.cfg'),'utf8').replace('html/focus_canvas_on_start=true','html/focus_canvas_on_start=false'));
    const {receipt,record}=await restricted(project,worldId);record.sourcePin=pin;record.instances=map.instances;await browserProbe(receipt,record);
    console.log(JSON.stringify({worldId,physicsChecks:record.browser.probe.checks.length,passed:record.browser.probe.passed}));
  }
  report.passed=true;
}catch(error){report.passed=false;report.failure=String(error.stack);process.exitCode=1;console.error(error.stack);}
finally{await core.stop();save();}
