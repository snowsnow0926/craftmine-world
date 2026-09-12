// Background-only native smoke. No UI, input simulation or player/model budget.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const [broker,runtimeRoot,outputRoot]=process.argv.slice(2);
if(!broker||!runtimeRoot)throw Error('usage: blender-smoke.mjs broker.exe resources/blender [evidenceDir]');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cm-bl-'));
const projectRoot=path.join(root,'input');const tasksRoot=path.join(root,'tasks');
fs.mkdirSync(projectRoot);fs.mkdirSync(tasksRoot);
const script=process.env.CRAFTMINE_BLENDER_SMOKE_SCRIPT??'import bpy\nbpy.ops.mesh.primitive_cube_add(size=2)\nbpy.context.object.name="CraftmineSmokeCube"\n';
fs.writeFileSync(path.join(projectRoot,'script.py'),script);
if(process.env.CRAFTMINE_BLENDER_SMOKE_SOURCE)fs.copyFileSync(process.env.CRAFTMINE_BLENDER_SMOKE_SOURCE,path.join(projectRoot,'source.blend'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=fs.readdirSync(projectRoot).sort().map(file=>({path:file,bytes:fs.statSync(path.join(projectRoot,file)).size,sha256:sha(fs.readFileSync(path.join(projectRoot,file)))}));
const request={schemaVersion:1,requestId:'smoke',taskId:'smoke',operation:'model',projectRoot,tasksRoot,runtimeRoot:path.resolve(runtimeRoot),sourceBinding:{worldId:'smoke-world',buildId:'smoke-build',sourceRevision:1,sourceDigest:'0'.repeat(64)},inputHash:sha(JSON.stringify(files))};
const child=spawn(path.resolve(broker),['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
child.stdin.write(JSON.stringify(request)+'\n');
let cancelPoll;
if(process.env.CRAFTMINE_BLENDER_SMOKE_CANCEL_MARKER){
  cancelPoll=setInterval(()=>{
    const log=path.join(tasksRoot,'smoke','logs','task.log');
    if(fs.existsSync(log)&&fs.readFileSync(log,'utf8').includes(process.env.CRAFTMINE_BLENDER_SMOKE_CANCEL_MARKER)){
      clearInterval(cancelPoll); child.stdin.write('{"cancel":true}\n');
    }
  },50);
}
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
clearInterval(cancelPoll);
child.stdin.destroy();
const response=JSON.parse(stdout.trim().split('\n').at(-1));
const evidence={root,request,response,brokerExitCode:code,stderr};
if(outputRoot){fs.mkdirSync(outputRoot,{recursive:true});fs.writeFileSync(path.join(outputRoot,'native-smoke.json'),JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify(evidence,null,2));
if(response.state!=='succeeded')process.exitCode=1;
