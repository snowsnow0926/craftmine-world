import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const require=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function files(directory,relative=''){return fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).flatMap(e=>{const name=relative?relative+'/'+e.name:e.name;return e.isDirectory()?files(directory,name):[{path:name,bytes:fs.statSync(path.join(directory,name)).size,sha256:hash(fs.readFileSync(path.join(directory,name)))}];});}
export async function runScenarioOffscreen(out,plan){
 const exportsRoot=out;out=fs.mkdtempSync(path.join(out,'offscreen-'));
 const {build}=require('esbuild'),electron=require('electron');
 const cases=[];
 for(const [mode,variant] of [['disabled','correct'],['positive','correct'],['negative','collision-retained'],['cancel','correct'],['official-failure','correct']]){
  const artifactsRoot=path.join(out,'offscreen-artifacts-'+mode);fs.mkdirSync(artifactsRoot);fs.cpSync(path.join(exportsRoot,variant+'-web'),path.join(artifactsRoot,'web'),{recursive:true});
  const artifacts=files(artifactsRoot);
  cases.push({name:mode,mode,descriptor:{format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:'gjob-'+hash(mode),inputHash:hash(JSON.stringify(plan)),worldId:'gu4-web-fixture',buildId:'gbd-'+hash(JSON.stringify(artifacts)),baseId:'creation-sandbox',root:artifactsRoot,entry:'web/index.html',threads:true,artifacts,snapshot:mode==='official-failure'?{invalid:'deliberate wrong progress format'}:null}});
 }
 fs.writeFileSync(path.join(out,'offscreen-cases.json'),JSON.stringify({cases,plan},null,2));
 const appDir=path.join(out,'offscreen-app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'scenario-offscreen-check',main:'main/index.cjs'}));
 for(const [entry,destination]of [['tests/fixtures/godot-scenario-collector-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
 const log=fs.createWriteStream(path.join(out,'offscreen-electron.log'));
 const child=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'offscreen-profile')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_SCENARIO_CHECK_OUT:out}});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),420000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));log.end();
 const result=JSON.parse(fs.readFileSync(path.join(out,'offscreen-report.json'),'utf8'));assert.equal(code,0,JSON.stringify(result));assert.equal(result.passed,true,JSON.stringify(result));return {passed:result.passed,cases:result.cases.map(c=>({name:c.name,passed:c.evidence.passed,diagnostic:c.evidence.scenarioDiagnostic?.status??null})),path:path.join(out,'offscreen-report.json')};
}
