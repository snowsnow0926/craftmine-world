// CN0-CN6 incremental acceptance. Fixed test list; never invokes a model runner.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),options={},flags=new Set();
for(let i=0;i<args.length;i++){
 const name=args[i];
 if(['--quick','--native-only'].includes(name)){if(flags.has(name))throw Error('DUPLICATE_OPTION '+name);flags.add(name);continue;}
 if(!['--source-root','--output-root','--packaged-root'].includes(name)||options[name]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: node scripts/verify-creation-continuity.mjs [--source-root <repository>] [--output-root <absolute raw parent>] [--packaged-root <win-unpacked>] [--quick | --native-only]');
 options[name]=args[++i];
}
if(flags.size>1)throw Error('CHOOSE_QUICK_OR_NATIVE_ONLY');
const root=path.resolve(options['--source-root']??path.join(import.meta.dirname,'..'));
const parent=options['--output-root']??path.join(root,'test-results');
if(!path.isAbsolute(parent))throw Error('ABSOLUTE_OUTPUT_ROOT_REQUIRED');
function directory(value){
 const resolved=path.resolve(value);let current=path.parse(resolved).root;
 for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  if(!fs.existsSync(current))fs.mkdirSync(current);
  const item=fs.lstatSync(current);if(item.isSymbolicLink()||!item.isDirectory())throw Error('OUTPUT_LINK_OR_FILE_DENIED');
 }
 return resolved;
}
// Product headless acceptance also requires the immediate parent to be named test-results.
const out=fs.mkdtempSync(path.join(directory(parent),'creation-continuity-')),raw=path.join(out,'raw','test-results');fs.mkdirSync(raw,{recursive:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=argv=>execFileSync('git',argv,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:64*1024*1024});
const identity=()=>({commit:git(['rev-parse','HEAD']).trim(),trackedDiffSha256:digest(git(['diff','--binary','HEAD'])),dirty:!!git(['status','--porcelain','--untracked-files=no']).trim()});
const packaged=options['--packaged-root']?path.resolve(options['--packaged-root']):null;
const report={format:'craftmine.creation-continuity-checks/1',scope:flags.has('--quick')?'unit':flags.has('--native-only')?'native':'incremental-integration',root,out,raw,packaged,sourceBefore:identity(),startedAt:new Date().toISOString(),steps:[],passed:false,limits:['Fixed incremental CN tests; previous NB 18-stage suite is not repeated.','No model runner, physical input, microphone or installer invocation.','Packaged mode applies only to the native EXE story; unit and UI fixtures inspect source.','No clean Windows lifecycle or real-player acceptance claim.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const logic=['tests/creation-application-completion.test.mjs','tests/creation-packaged-launch.test.mjs','tests/creation-operations.test.mjs','tests/creation-source-service.test.mjs','tests/godot-build-read-wait.test.mjs'];
const host=['creation-direct-placement','creation-recent-results','creation-edit-service','creation-edit-guards','creation-check-requirements','creation-target-service','creation-target','creation-auto-apply-service','creation-host-task-status','creation-task-status'].map(name=>'vendor/pi-desktop/apps/desktop/test/'+name+'.test.mjs');
const stages=[];
if(!flags.has('--native-only'))stages.push(['logic',['--test',...logic]],['host',['--test',...host]],['executor-protocol',['--test','tests/godot-remaining/C/executor-protocol.mjs']]);
if(!flags.has('--quick')){
 if(!flags.has('--native-only'))stages.push(['editing-ui',['tests/creation-edit-ui-headless.mjs']],['recent-ui',['tests/creation-recent-ui-headless.mjs']]);
 stages.push(['native-story',['tests/creation-place-native.mjs',...(packaged?['--packaged-root',packaged]:[])]]);
}
persist();
for(const [name,command]of stages){
 const log=path.join(out,name+'.log'),entry={name,command:[process.execPath,...command],log,status:'running',startedAt:new Date().toISOString()};report.steps.push(entry);persist();console.log('Running '+name+'; log '+log);
 const fd=fs.openSync(log,'w'),started=Date.now();
 try{
  const environment={...process.env,CRAFTMINE_SOURCE_ROOT:root,CRAFTMINE_CREATION_OUTPUT_ROOT:raw,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_CREATION_EVAL:'0',CRAFTMINE_CREATION_COPY_SESSION:'0'};
  // Package selection is explicit for this invocation, not inherited accidentally.
  delete environment.CRAFTMINE_PACKAGED_ROOT;delete environment.CRAFTMINE_EVAL_KEY;
  const child=spawn(process.execPath,command,{cwd:root,env:environment,windowsHide:true,stdio:['ignore',fd,fd]});
  entry.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});entry.status=entry.exitCode===0?'passed':'failed';
 }catch(error){entry.status='failed';entry.error=String(error);}
 finally{fs.closeSync(fd);entry.elapsedMs=Date.now()-started;entry.sha256=digest(fs.readFileSync(log));persist();}
 console.log(name+': '+entry.status);if(entry.status!=='passed'){process.exitCode=1;break;}
}
report.sourceAfter=identity();report.sourceUnchanged=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
report.passed=report.steps.length===stages.length&&report.steps.every(step=>step.status==='passed')&&report.sourceUnchanged;
if(!report.passed)process.exitCode=1;
report.finishedAt=new Date().toISOString();persist();console.log('Acceptance report: '+path.join(out,'report.json'));
