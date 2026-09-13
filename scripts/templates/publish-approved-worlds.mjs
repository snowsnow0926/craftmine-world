// Operator publication only: restore archives into private staging, read native
// formal source, and capture authored runtime defaults without player progress.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),require=createRequire(import.meta.url);
const {CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const root=path.resolve(import.meta.dirname,'../..');
const archive=process.argv[2];
if(!archive||!path.isAbsolute(archive)||(process.argv[3]&&!path.isAbsolute(process.argv[3])))throw Error('Usage: node scripts/templates/publish-approved-worlds.mjs ABS_APPROVED_ARCHIVE [ABS_NEW_OUTPUT]');
const approved=JSON.parse(fs.readFileSync(path.join(archive,'manifest.json')));
const resources=path.join(archive,'windows-client/resources');
process.env.CRAFTMINE_BUNDLED_GIT=path.join(resources,'git/bin/git.exe');
const sha=b=>createHash('sha256').update(b).digest('hex');
const output=process.argv[3]??path.join(root,'desktop/godot/shared/promo-templates');
if(fs.existsSync(output))throw Error('PUBLICATION_OUTPUT_MUST_BE_NEW');
const staging=fs.mkdtempSync(path.join(fs.mkdirSync(path.join(root,'test-results'),{recursive:true})||path.join(root,'test-results'),'template-publication-'));
const engine=path.join(staging,'engine');fs.mkdirSync(engine);const exe=path.join(engine,'godot.exe');
fs.copyFileSync(path.join(resources,'godot/engine/4.7.2-stable/editor/Godot_v4.7.2-stable_win64.exe'),exe);fs.writeFileSync(path.join(engine,'_sc_'),'');
if(sha(fs.readFileSync(exe))!==JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/toolchain.lock.json'))).editor.executableSha256)throw Error('ENGINE_HASH_MISMATCH');
const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.join(process.env.SystemRoot,'System32')};
for(const k of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){env[k]=path.join(staging,'profile',k);fs.mkdirSync(env[k],{recursive:true});}
for(const folder of ['Desktop','Documents','Downloads','Music','Pictures','Videos'])fs.mkdirSync(path.join(env.USERPROFILE,folder),{recursive:true});
fs.mkdirSync(output,{recursive:true});
const catalog={format:'craftmine.authored-world-templates/1',templates:[]};
for(const [name,record] of Object.entries(approved.worlds)){
 const archivePath=path.join(archive,record.archive),bytes=fs.readFileSync(archivePath);if(sha(bytes)!==record.sha256)throw Error('ARCHIVE_HASH_MISMATCH');
 const bootstrap=new CoreClient(path.join(resources,'bin/craftmine-core.exe'),path.join(staging,name,'empty'));await bootstrap.start();
 const restored=path.join(staging,name,'restored');
 try{await bootstrap.call('backup.restorePortable',{operationId:'template-publish-'+name,archivePath,targetDirectory:restored},120000);}finally{await bootstrap.stop();}
 const core=new CoreClient(path.join(resources,'bin/craftmine-core.exe'),restored);await core.start();
 const dir=path.join(output,'promo-'+name),project=path.join(staging,name,'project');fs.mkdirSync(project,{recursive:true});fs.mkdirSync(dir,{recursive:true});
 let source;
 try{
  source=await core.call('godotRuntime.exportSource',{worldId:record.worldId});
  for(const file of source.files){
   if(file.path.includes('..')||file.path.includes('\\')||path.isAbsolute(file.path))throw Error('SOURCE_PATH_INVALID');
   const result=await core.call('content.readFile',{worldId:record.worldId,rev:source.contentOid,path:file.path,encoding:'base64'});
   const body=Buffer.from(result.base64,'base64');if(body.length!==file.bytes||sha(body)!==file.sha256)throw Error('SOURCE_HASH_MISMATCH');
   for(const target of [path.join(dir,'source',file.path),path.join(project,file.path)]){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,body);}
  }
 }finally{await core.stop();}
 const script=`extends SceneTree\nfunc _initialize() -> void:\n    _capture.call_deferred()\nfunc _capture() -> void:\n    change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))\n    var bridge = root.get_node("CraftmineRuntime")\n    for frame in range(600):\n        await process_frame\n        if bridge.initialized:\n            var result = await bridge.handle_request({"worldId":"${record.worldId}","buildId":"initial-state-capture","instanceId":"initial-state-capture","op":"load","args":{}})\n            if result.has("error"):\n                push_error(str(result.error))\n                quit(1)\n                return\n            print("CRAFTMINE_INITIAL_STATE:" + JSON.stringify(result.result.snapshot.state))\n            quit(0)\n            return\n    quit(1)\n`;
 fs.writeFileSync(path.join(project,'capture_initial.gd'),script);
 for(const [stage,args]of [['import',['--editor','--import']],['capture',['--script','res://capture_initial.gd']]]){
  const result=await run(exe,['--headless','--fixed-fps','60','--language','en','--path',project,...args],{env,windowsHide:true,maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(staging,name,stage+'.log'),result.stdout+result.stderr);
  const diagnostic=(result.stdout+result.stderr).split(/\r?\n/).filter(line=>/SCRIPT ERROR|Parse Error|ERROR:/.test(line));
  if(diagnostic.some(line=>!(name==='rain'&&stage==='capture'&&line.startsWith('ERROR: Rain magic executed probe failed: '))))throw Error(name+' '+stage+' failed');
  if(diagnostic.length)console.log(JSON.stringify({name,stage,retainedDiagnostics:diagnostic}));
  if(stage==='capture'){
   const line=result.stdout.split(/\r?\n/).find(x=>x.startsWith('CRAFTMINE_INITIAL_STATE:'));if(!line)throw Error('INITIAL_STATE_NOT_CAPTURED');
   const snapshot=JSON.parse(line.slice('CRAFTMINE_INITIAL_STATE:'.length));if(snapshot.worldId!==record.worldId)throw Error('INITIAL_IDENTITY_MISMATCH');
   fs.writeFileSync(path.join(dir,'initial.json'),JSON.stringify(snapshot,null,2)+'\n');
  }
 }
 const preview=fs.readFileSync(path.join(archive,'previews',name+'.png'));fs.writeFileSync(path.join(dir,'preview.png'),preview);
 const manifest={format:'craftmine.authored-world-template/1',id:'promo-'+name,version:'1.0.0',baseId:source.baseId,baseVersion:source.baseVersion,worldId:record.worldId,
  title:record.title,source:{buildId:source.buildId,contentOid:source.contentOid,archiveSha256:record.sha256,sourceCommit:approved.sourceCommit},files:source.files,
  initial:{file:'initial.json',sha256:sha(fs.readFileSync(path.join(dir,'initial.json'))),authority:'authored-runtime-defaults'},preview:{file:'preview.png',sha256:sha(preview),bytes:preview.length}};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 catalog.templates.push({id:manifest.id,label:record.title,kind:'example',description:({mainline:'森林伙伴、巨兽试炼与枪械',flight:'歼二十起降与驾驶',rain:'暂停雨滴、倒流与控雨',city:'城市街区漫游与探索'})[name],version:manifest.version,sha256:sha(fs.readFileSync(path.join(dir,'manifest.json')))});
 console.log(JSON.stringify({name,files:source.files.length,bytes:source.files.reduce((n,f)=>n+f.bytes,0)}));
}
fs.writeFileSync(path.join(output,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
console.log(staging);
