import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {describeTargetFeedback,patchTargetFeedback} from '../../desktop/godot/shared/target-feedback-configuration.mjs';
import {addTargetFeedbackSiblingOverride} from './fixtures/target-feedback-sibling-override.mjs';
const root=path.resolve(import.meta.dirname,'../..'),dependencies=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT;
if(!dependencies||!process.env.CRAFTMINE_CORE_BIN||!process.env.CRAFTMINE_GODOT_BROKER_IDENTITY)throw Error('Explicit dependencies, new core and broker identity required');
const require=createRequire(path.join(dependencies,'vendor/pi-desktop/apps/desktop/package.json')),electron=require('electron');
const {build}=createRequire(path.join(dependencies,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const hash=value=>createHash('sha256').update(value).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results','target-feedback-chain-'));console.log('CHAIN_OUT '+out);
const sourceExtensions=new Set(['.godot','.gd','.tscn','.tres','.gdshader','.gdshaderinc','.json','.cfg','.txt','.md','.csv','.svg','.obj','.mtl','.uid']);
const setup={kind:'actual-core-executor-broker-verifier',out,core:{path:process.env.CRAFTMINE_CORE_BIN,sha256:hash(fs.readFileSync(process.env.CRAFTMINE_CORE_BIN))},electron:{path:electron,sha256:hash(fs.readFileSync(electron))},sources:[]};
const fixtures=[];
for(const name of ['positive','sibling-override']){
 const worldId='chain-'+name,source=path.join(out,name,'source');materializeBase({baseId:'first-person',worldId,template:'training-range',out:source});
 const files=new Map(fs.readdirSync(source,{recursive:true}).filter(p=>fs.statSync(path.join(source,p)).isFile()&&sourceExtensions.has(path.extname(p))).map(p=>[p.replaceAll('\\','/'),fs.readFileSync(path.join(source,p))]));
 const scenePath='scenes/training_range.tscn';
 if(name!=='positive'){const fixture=addTargetFeedbackSiblingOverride(files.get(scenePath).toString('utf8'));files.set(scenePath,Buffer.from(fixture.sceneText));for(const [p,b]of fixture.files)files.set(p,b);}
 const args={scenePath,sceneText:files.get(scenePath).toString('utf8'),targetId:'target_a',files};const described=describeTargetFeedback(args),patch=patchTargetFeedback({...args,binding:described.binding,values:{hitFlashMilliseconds:500}});assert.equal(patch.changed,true);files.set(scenePath,Buffer.from(patch.text));
 // Materializer metadata is not source authority; only actual file bytes enter core.
 files.delete('managed-base.json');
 const snapshot=JSON.parse(fs.readFileSync(path.join(root,'desktop/godot/shared/initial-states/first-person-training-range.json'),'utf8')).snapshot;snapshot.worldId=worldId;snapshot.body.worldId=worldId;
 fixtures.push({name,worldId,snapshot,files:[...files].map(([path,bytes])=>({path,bytesBase64:bytes.toString('base64')}))});setup.sources.push({name,worldId,files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))});
}
fs.writeFileSync(path.join(out,'fixtures.json'),JSON.stringify(fixtures));fs.writeFileSync(path.join(out,'setup.json'),JSON.stringify(setup,null,2));
const appDir=path.join(out,'app');fs.mkdirSync(path.join(appDir,'main'),{recursive:true});fs.mkdirSync(path.join(appDir,'preload'));fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'finite-feedback-chain',main:'main/index.cjs'}));
for(const [entry,destination]of [['tests/player-product/target-feedback-chain-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appDir,destination),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
const log=fs.createWriteStream(path.join(out,'electron.log'));const child=spawn(electron,[appDir,'--user-data-dir='+path.join(out,'profile')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_FEEDBACK_CHAIN_OUT:out,CRAFTMINE_GODOT_BRIDGE_PATH:path.join(root,'desktop/godot/web/bridge.js'),CRAFTMINE_GODOT_TOOLCHAIN_LOCK:path.join(root,'desktop/godot/toolchain.lock.json')}});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),840000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);log.end();fs.writeFileSync(path.join(out,'electron-exit.json'),JSON.stringify({code}));const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));console.log(JSON.stringify({out,code,passed:report.passed,checks:report.checks,failure:report.failure??null}));assert.equal(code,0);assert.equal(report.passed,true);
