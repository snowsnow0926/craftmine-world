// Fixed authored first-person project only. Never execute arbitrary exported native code here.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {CoreClient} from '../../plugins/craftmine-world/core-client.cjs';
import {prepareWindowsToolchain,windowsPreset,WINDOWS_TEMPLATE} from '../../desktop/godot/sandbox/windows-toolchain.mjs';
import {sha256} from '../../desktop/godot/toolchain.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'windows-user-game-'));
const report={format:'craftmine.windows-user-game-acceptance/1',root,passed:false,checks:[],limitations:['Authored base, not a real model run.','Headless native gameplay and persistence, not visible CP4 play acceptance.','Standalone executable is unsigned; module rights and distributable packaging require delivery review.']};
console.log('WINDOWS_USER_GAME_ROOT='+root);
const core=new CoreClient(process.env.CRAFTMINE_CORE_BIN,path.join(root,'core-data'));
const call=(method,args)=>core.call(method,args,120000),context={projectId:'windows-project',sessionId:'windows-session',turnId:'create'},worldId='standalone-world';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function broker(operation,projectRoot,engineRoot,source){
 const executable=process.env.CRAFTMINE_BROKER_BIN;if(!executable)throw Error('CRAFTMINE_BROKER_BIN is required');
 const taskId=operation.toLowerCase()+'-'+Date.now();
 const request={schemaVersion:1,requestId:taskId,taskId,operation,projectRoot,tasksRoot:path.join(root,'tasks'),engineRoot,sourceBinding:{worldId,buildId:'authored-windows-check',sourceRevision:source.revision,sourceDigest:source.manifestHash},inputHash:source.manifestHash};
 await fs.writeFile(path.join(root,operation+'-request.json'),JSON.stringify(request,null,2));
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.stdin.end('cancel\n');},610000),killTimer=setTimeout(()=>child.kill(),640000);
  child.on('error',error=>{clearTimeout(timer);clearTimeout(killTimer);reject(error);});
  child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>4*1024*1024)child.kill();});child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>1024*1024)child.kill();});
  child.on('close',async code=>{clearTimeout(timer);clearTimeout(killTimer);try{await fs.writeFile(path.join(root,operation+'-broker.log'),stdout+'\n'+stderr);const response=JSON.parse(stdout.trim());await fs.writeFile(path.join(root,operation+'-response.json'),JSON.stringify(response,null,2));assert.equal(code,0);assert.equal(response.state,'succeeded',response.error);assert.equal(response.cleanup.verified,true);assert.equal(response.recoveryJournal.cleared,true);assert.equal(response.sourceBinding.sourceDigest,source.manifestHash);resolve(response);}catch(error){reject(error);}});
  child.stdin.write(JSON.stringify(request)+'\n');
 });
}
try{
 await fs.mkdir(path.join(root,'tasks'));
 const toolchain=await prepareWindowsToolchain(path.join(root,'toolchain'));report.toolchain=toolchain;report.brokerSha256=await sha256(process.env.CRAFTMINE_BROKER_BIN);report.coreSha256=await sha256(process.env.CRAFTMINE_CORE_BIN);
 await core.start();await call('world.create',{id:worldId,title:'Standalone author-controlled training range',world:{build:{id:'base-windows',scene:{format:'craftmine.scene/3',objects:[]}},snapshot:{format:'craftmine.progress/1',player:{x:0.5,y:7.6,z:0.5,yaw:0,pitch:0}},extensions:[]}});
 await call('workspace.open',{context,selectedWorld:worldId});
 const base=path.join(repo,'desktop/godot/bases/first-person'),sourceFiles=[];
 for(const entry of await fs.readdir(base,{recursive:true})){const relative=entry.replaceAll('\\','/');if(relative.split('/').some(p=>['tests','docs','tools','.godot'].includes(p))||!/(?:\.godot|\.gd|\.tscn|\.tres|\.json|\.svg|\.uid)$/.test(relative))continue;const file=path.join(base,entry);if(!(await fs.lstat(file)).isFile())continue;sourceFiles.push({path:relative,body:await fs.readFile(file)});}
 const project=sourceFiles.find(file=>file.path==='project.godot');let projectText=project.body.toString('utf8');const autoload='StandaloneAcceptance="*res://standalone_acceptance.gd"';projectText=projectText.includes('[autoload]')?projectText.replace('[autoload]','[autoload]\n'+autoload):projectText+'\n[autoload]\n'+autoload+'\n';
 // A unique export identity prevents this fixture sharing the base's user:// saves.
 projectText=projectText.replace(/config\/name="[^"]*"/,'config/name="Craftmine Standalone Acceptance"');project.body=Buffer.from(projectText);
 sourceFiles.push({path:'standalone_acceptance.gd',body:await fs.readFile(path.join(here,'windows-game-acceptance.gd'))},{path:'export_presets.cfg',body:Buffer.from(windowsPreset)});
 const seed=await call('godotProject.create',{context,worldId,toolCallId:'create-source',baseBuild:'base-windows',baseId:'first-person',files:[{path:'project.godot',text:projectText}]});
 const source=await call('godotProject.applyFiles',{context,worldId,toolCallId:'full-author-source',revision:seed.revision,manifestHash:seed.manifestHash,files:sourceFiles.map(file=>({path:file.path,bytesBase64:file.body.toString('base64'),expectedHash:file.path==='project.godot'?hash(project.body):null}))});report.source=source;
 const projectRoot=path.join(root,'project');await fs.mkdir(projectRoot);let offset=0;
 do{const index=await call('godotProject.index',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,offset,limit:32});for(const file of index.files){let next=0;const chunks=[];do{const part=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:file.path,offset:next,limit:16000});chunks.push(part.encoding==='base64'?Buffer.from(part.bytesBase64,'base64'):Buffer.from(part.text));next=part.nextOffset;}while(next!=null);const body=Buffer.concat(chunks);assert.equal(hash(body),file.sha256);assert.equal(body.length,file.bytes);await fs.mkdir(path.dirname(path.join(projectRoot,file.path)),{recursive:true});await fs.writeFile(path.join(projectRoot,file.path),body);}offset=index.nextOffset;}while(offset!=null);
 report.checks.push('Actual Rust managed source transaction and pinned paginated read materialize full training range');
 const response=await broker('exportWindows',projectRoot,toolchain.engineRoot,source);report.response=response;
 const exe=response.artifacts.find(file=>file.path==='game.exe'),pck=response.artifacts.find(file=>file.path==='game.pck');assert.ok(exe&&pck);assert.equal(exe.sha256,WINDOWS_TEMPLATE.sha256);assert.ok(pck.bytes>0);report.checks.push('LPAC + Job fixed Windows export returns original pinned engine EXE and nonempty PCK with verified cleanup');
 const output=path.join(root,'standalone');await fs.mkdir(output);for(const file of response.artifacts){assert.match(file.path,/^[a-zA-Z0-9_.-]+$/);const original=path.join(response.artifactsRoot,file.path);assert.equal(await sha256(original),file.sha256);await fs.copyFile(original,path.join(output,file.path));}
 for(const name of ['GODOT_LICENSE.txt','GODOT_COPYRIGHT.txt'])await fs.copyFile(path.join(repo,'desktop/godot/licenses',name),path.join(output,name));
 // Only our fixed, fully recorded authored source is run directly. This is not
 // a native execution permission for future model-authored binaries.
 const env={};for(const key of ['SystemRoot','WINDIR','COMSPEC'])if(process.env[key])env[key]=process.env[key];env.PATH=path.join(process.env.SystemRoot,'System32');for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){env[key]=path.join(root,'runtime-profile',key.toLowerCase());await fs.mkdir(env[key],{recursive:true});}
 const states=[];for(const mode of ['write','read']){const log=path.join(root,'standalone-'+mode+'.log');let result;try{result=await promisify(execFile)(path.join(output,'game.exe'),['--headless','--','--craftmine-'+mode],{cwd:output,env,windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});}catch(error){await fs.writeFile(log,String(error.stdout??'')+String(error.stderr??'')+'\n'+String(error));throw error;}const text=result.stdout+result.stderr;await fs.writeFile(log,text);assert.doesNotMatch(text,/SCRIPT ERROR|Parse Error|ERROR:|USER_GAME_FAILURE/);const stateLine=text.split(/\r?\n/).find(line=>line.startsWith('USER_GAME_STATE='));assert.ok(stateLine);states.push(JSON.parse(stateLine.slice(16)));assert.ok(text.includes(env.APPDATA.replaceAll('\\','/'))||text.includes(env.APPDATA));}
 assert.deepEqual(states[1],states[0]);assert.ok(JSON.stringify(states[0].equipment).includes('practice_sword'));report.states=states;report.checks.push('Independent exported EXE equips real sword and durably saves complete native state');report.checks.push('Second exported game process restores exact full state from isolated user data');report.output=output;report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{await core.stop();await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
