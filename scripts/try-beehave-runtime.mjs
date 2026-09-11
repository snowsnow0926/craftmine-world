// Audited external starter kits: copy first, execute only through measured LPAC
// broker, then load exported Web code in a private headless browser profile.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {playwright,browserOptions} from '../app/browser-tools.mjs';
import {validateBeehaveTrace} from './lib/beehave-trial-evidence.mjs';
import {validateExternalReceipt} from './lib/godot-external-receipt.mjs';
const require=createRequire(import.meta.url);
let PNG;try{({PNG}=require('pngjs'));}catch{({PNG}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs')));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot='D:/cm-agent-godot-0912/test-results/external-resources-20260912';
const brokerDirectory='D:/Craftmine-World-preview.11/win-unpacked/resources/godot/broker';
const broker=path.join(brokerDirectory,'godot-host-broker.exe');
const engineRoot='D:/Craftmine World/desktop/build/godot/4.7.2-stable';
const kits=[{id:'beehave',commit:'58a0df12330114e330f47fc1469132f016c056bc',repo:'https://github.com/bitbrain/beehave',version:'2.9.4-dev'}];
if(process.argv.length!==2)throw Error('No arguments supported; fixed audited Beehave source only');
const args=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileHash=file=>sha(fs.readFileSync(file));
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results','gu6-beehave-'));
const tasksRoot=path.join(out,'tasks');fs.mkdirSync(tasksRoot);
const identity=JSON.parse(fs.readFileSync(path.join(brokerDirectory,'broker-identity.json'),'utf8'));
if(identity.sha256!==fileHash(broker)||identity.policyVersion!=='craftmine.windows.lpac-registry.v1')throw Error('BROKER_IDENTITY_MISMATCH');
const report={format:'craftmine.external-godot-trial/1',startedAt:new Date().toISOString(),out,
  broker:{sha256:identity.sha256,sourceCommit:identity.sourceCommit,policyVersion:identity.policyVersion},engineVersion:'4.7.2-stable',kits:[],
  scope:'Fixed Beehave runtime subset, developer-authored physical follow/stop fixture; real LPAC import/export and isolated Web execution',
  notVerified:['Ordinary player-model authoring','Combat/build controls and full gameplay','Craftmine world/application/save contracts','Formal-world installation','Licenses beyond retained upstream declarations']};
const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));save();
let stopRequested=false,activeCancel=null;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopRequested=true;activeCancel?.();});
console.log('EVIDENCE_DIRECTORY='+out);
function filesAt(directory){
  const result=[];
  const visit=(current,relative='')=>{for(const item of fs.readdirSync(current,{withFileTypes:true})){
    if(item.name==='.git'||item.name==='.godot')continue;
    if(item.isSymbolicLink())throw Error('SOURCE_SYMLINK_REJECTED');
    const rel=relative?relative+'/'+item.name:item.name,absolute=path.join(current,item.name);
    if(item.isDirectory())visit(absolute,rel);else result.push({path:rel,bytes:fs.statSync(absolute).size,sha256:fileHash(absolute)});
  }};visit(directory);return result.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function stage(kit){
  const source=path.join(sourceRoot,kit.sourceId||kit.id);
  const observed=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  if(observed!==kit.commit)throw Error('UPSTREAM_COMMIT_CHANGED');
  if(execFileSync('git',['-C',source,'status','--porcelain'],{encoding:'utf8',windowsHide:true}).trim())throw Error('UPSTREAM_WORKTREE_CHANGED');
  const files=filesAt(source),project=path.join(out,kit.id);fs.mkdirSync(project);
  const selected=['nodes/beehave_node.gd','nodes/beehave_tree.gd','blackboard.gd','nodes/composites/composite.gd','nodes/composites/sequence_reactive.gd','nodes/composites/selector_reactive.gd','nodes/leaves/leaf.gd','nodes/leaves/action.gd','nodes/leaves/condition.gd','debug/debugger_messages.gd','debug/global_debugger.gd','metrics/beehave_global_metrics.gd','LICENSE'];
  const prefix='addons/beehave/';
  for(const rel of [...selected])if(rel.endsWith('.gd')){
    const text=fs.readFileSync(path.join(source,prefix,rel),'utf8');
    if(/OS\.(?:execute|create_process|shell_open)|HTTPRequest|HTTPClient|TCPServer|StreamPeerTCP|JavaScriptBridge|extends\s+EditorPlugin/.test(text))throw Error('UNREVIEWED_SURFACE:'+rel);
    const icon=text.match(/@icon\("([^"]+)"\)/)?.[1];if(icon)selected.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel),icon)));
  }
  for(const rel of new Set(selected)){const target=path.join(project,prefix,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,prefix,rel),target);}
  const projectText='config_version=5\n[application]\nconfig/name="Beehave isolated follow trial"\nrun/main_scene="res://trial.tscn"\n[autoload]\nBeehaveGlobalDebugger="*res://addons/beehave/debug/global_debugger.gd"\nBeehaveGlobalMetrics="*res://addons/beehave/metrics/beehave_global_metrics.gd"\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\n';
  fs.writeFileSync(path.join(project,'project.godot'),projectText);
  fs.writeFileSync(path.join(project,'trial.tscn'),'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://trial.gd" id="1"]\n[node name="Trial" type="Node3D"]\nscript = ExtResource("1")\n');
  fs.copyFileSync(path.join(root,'scripts/fixtures/beehave-follow-trial.gd'),path.join(project,'trial.gd'));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),fs.readFileSync(path.join(root,'desktop/godot/sandbox/fixtures/web-sample/export_presets.cfg'),'utf8').replace('html/focus_canvas_on_start=true','html/focus_canvas_on_start=false'));
  const modified=filesAt(project),licenseDirectory=path.join(out,'licenses');fs.mkdirSync(licenseDirectory);fs.copyFileSync(path.join(source,prefix,'LICENSE'),path.join(licenseDirectory,'Beehave-MIT.txt'));
  const entry={...kit,project,sourceDigest:sha(JSON.stringify(files)),modifiedDigest:sha(JSON.stringify(modified)),upstreamFiles:files.length,selectedUpstreamFiles:modified.filter(f=>f.path.startsWith(prefix)),licenseDirectory,operations:[],adaptation:'Selected runtime GDScripts and required icons copied unchanged; new project/autoloads and host-authored movement fixture. No editor plugin/GUT/examples. @tool remains and executes only inside LPAC during import.',audit:{processOrNetworkCalls:false,engineDebuggerApi:true,editorPlugin:false,nativeExtensions:false}};
  fs.writeFileSync(path.join(out,kit.id+'-source-files.json'),JSON.stringify({upstream:files,modified},null,2));return entry;
}

async function execute(entry,operation){
  if(stopRequested)throw Error('TRIAL_CANCELLED');
  const taskId='bee-'+(operation==='import'?'imp':'web')+'-'+Date.now();
  const request={schemaVersion:1,requestId:taskId,taskId,operation,projectRoot:entry.project,tasksRoot,engineRoot,
    sourceBinding:{worldId:'isolated-external-starter-trial',buildId:taskId,sourceRevision:1,sourceDigest:entry.modifiedDigest},inputHash:sha(taskId)};
  fs.writeFileSync(path.join(out,taskId+'-request.json'),JSON.stringify(request,null,2));
  const child=spawn(broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',timer,killTimer;
  const cancel=()=>{if(!child.killed&&!child.stdin.destroyed)child.stdin.write('{"cancel":true}\n');clearTimeout(killTimer);killTimer=setTimeout(()=>child.kill(),5000);};
  activeCancel=cancel;
  const code=await new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);child.on('close',resolve);child.stdin.write(JSON.stringify(request)+'\n');
    timer=setTimeout(cancel,180000);
  }).finally(()=>{clearTimeout(timer);clearTimeout(killTimer);activeCancel=null;});
  fs.writeFileSync(path.join(out,taskId+'-stdout.log'),stdout);fs.writeFileSync(path.join(out,taskId+'-stderr.log'),stderr);
  const result=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  fs.writeFileSync(path.join(out,taskId+'-receipt.json'),JSON.stringify(result,null,2));
  const logPath=result.logsRoot?path.join(result.logsRoot,'task.log'):null;
  const log=logPath&&fs.existsSync(logPath)?fs.readFileSync(logPath,'utf8'):'';
  const errors=log.split(/\r?\n/).filter(line=>/SCRIPT ERROR|ERROR:|Parse Error/.test(line));
  const expectedSourceFiles=JSON.parse(fs.readFileSync(path.join(out,entry.id+'-source-files.json'),'utf8')).modified;
  const receiptValidation=validateExternalReceipt(request,result,{brokerSha256:identity.sha256,transportExitCode:code,expectedSourceFiles});
  const verified=receiptValidation.valid;
  const summary={operation,taskId,transportExitCode:code,state:result.state,error:result.error,verified,receiptValidation,errors,
    receipt:path.join(out,taskId+'-receipt.json'),logPath,artifactsRoot:result.artifactsRoot,artifacts:result.artifacts};
  entry.operations.push(summary);save();console.log(JSON.stringify({kit:entry.id,operation,verified,state:result.state,errors:errors.length,error:result.error}));
  if(!verified)throw Error(operation+' failed: '+(result.error||result.state));
  return result;
}
async function view(entry,exported){
  if(stopRequested)throw Error('TRIAL_CANCELLED');
  for(const file of exported.artifacts)if(fileHash(path.join(exported.artifactsRoot,file.path))!==file.sha256)throw Error('EXPORTED_ARTIFACT_HASH_MISMATCH');
  const server=http.createServer((req,res)=>{
    const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/+/,''),file=path.resolve(exported.artifactsRoot,relative||'index.html');
    if(!file.startsWith(path.resolve(exported.artifactsRoot)+path.sep)){res.writeHead(403);return res.end();}
    const types={'.html':'text/html','.js':'application/javascript','.wasm':'application/wasm','.pck':'application/octet-stream','.png':'image/png','.svg':'image/svg+xml'};
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  const result={console:[],pageErrors:[],blockedRequests:[],input:{},screenshot:path.join(out,entry.id+'-startup.png')};
  try{
    browser=await playwright().chromium.launchPersistentContext(path.join(out,entry.id+'-browser-profile'),{...browserOptions(),headless:true,viewport:{width:1280,height:720},args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required']});
    activeCancel=()=>{void browser.close();};
    await browser.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){result.blockedRequests.push(route.request().url());return route.abort();}return route.continue();});
    await browser.addInitScript(()=>{
      globalThis.__inputGuard={pointerLock:0,focus:0};
      Element.prototype.requestPointerLock=function(){__inputGuard.pointerLock++;throw Error('Pointer Lock disabled by independent test');};
      HTMLElement.prototype.focus=function(){__inputGuard.focus++;};window.focus=()=>{__inputGuard.focus++;};
    });
    const page=await browser.newPage();page.on('console',message=>result.console.push({type:message.type(),text:message.text()}));page.on('pageerror',error=>result.pageErrors.push(error.message));
    await page.goto(origin,{waitUntil:'load',timeout:60000});
    await page.waitForFunction(()=>{const canvas=document.querySelector('canvas'),status=document.querySelector('#status');return canvas?.width>0&&canvas?.height>0&&(!status||getComputedStyle(status).display==='none'||getComputedStyle(status).visibility==='hidden');},{},{timeout:60000});
    await new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(result.console.some(item=>item.text.startsWith('BEEHAVE_TRIAL='))){clearInterval(timer);resolve();}else if(stopRequested||Date.now()-started>30000){clearInterval(timer);reject(Error('TRACE_MISSING_OR_CANCELLED'));}},100);});
    const lines=result.console.filter(item=>item.text.startsWith('BEEHAVE_TRIAL='));
    if(lines.length!==1)throw Error('AMBIGUOUS_TRACE');
    const trace=JSON.parse(lines[0].text.slice('BEEHAVE_TRIAL='.length));
    result.traceValidation=validateBeehaveTrace(trace);
    fs.writeFileSync(path.join(out,'beehave-trace.json'),JSON.stringify(trace,null,2));
    result.traceSha256=fileHash(path.join(out,'beehave-trace.json'));
    result.console=result.console.filter(item=>!item.text.startsWith('BEEHAVE_TRIAL='));
    result.input=await page.evaluate(()=>({...__inputGuard,pointerLocked:!!document.pointerLockElement}));
    const pixels=PNG.sync.read(await page.screenshot({path:result.screenshot}));
    const colors=new Set();let bright=0;
    for(let i=0;i<pixels.data.length;i+=64){colors.add([pixels.data[i]>>4,pixels.data[i+1]>>4,pixels.data[i+2]>>4].join(','));if(pixels.data[i]+pixels.data[i+1]+pixels.data[i+2]>90)bright++;}
    result.pixels={width:pixels.width,height:pixels.height,quantizedColors:colors.size,brightSamples:bright};
    result.runtimeErrors=result.console.filter(item=>/SCRIPT ERROR|ERROR:|Parse Error/.test(item.text));
    // Geometry has few flat colors. Startup is proven by engine + complete
    // physics trace; pixel variety is descriptive only, never behavior proof.
    result.started=result.console.some(item=>/Godot Engine v4\.7\.2/.test(item.text))&&trace.samples?.length===391;
    result.passed=result.traceValidation.valid&&result.started&&result.pageErrors.length===0&&result.runtimeErrors.length===0&&result.input.pointerLock===0&&result.input.focus===0&&!result.input.pointerLocked;
    result.acceptanceScope='Developer fixture physics displacement, reactive stop/disable and blocked-path counterexample; not ordinary-player gameplay';
  }catch(error){result.failure=String(error.stack);result.passed=false;}
  finally{activeCancel=null;if(browser){await browser.close();result.browserClosed=true;}await new Promise(resolve=>server.close(resolve));result.httpServerClosed=true;}
  entry.browser=result;save();console.log(JSON.stringify({kit:entry.id,browserPassed:result.passed,pixels:result.pixels,input:result.input,failure:result.failure}));
}
for(const kit of kits.filter(kit=>args.length?kit.id===args[0]:!kit.loadSample)){
  if(stopRequested)break;
  let entry;
  try{entry=stage(kit);report.kits.push(entry);save();await execute(entry,'import');const exported=await execute(entry,'exportWeb');await view(entry,exported);}
  catch(error){if(!entry){entry={...kit};report.kits.push(entry);}entry.failure=String(error.stack);save();console.error(kit.id+': '+error.message);}
}
report.completedAt=new Date().toISOString();report.cancelled=stopRequested;report.passed=!stopRequested&&report.kits.every(kit=>kit.browser?.passed===true);save();
if(!report.passed)process.exitCode=1;
