// Actual Main/React forms with two local assets. No model, engine job or input simulation.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {isolatedParameterEnvironment,inspectParameterPackage} from './parameter-client-package.mjs';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';
import {versionDiffLaunchPlan} from './version-diff-client-package.mjs';
import {assetClientArguments} from './asset-client-arguments.mjs';
import {assertCleanHeadlessShutdown} from '../player-product/shutdown-exit-audit.mjs';
const options=assetClientArguments(process.argv.slice(2)),root=path.resolve(options['--source-root']),app=path.join(root,'vendor/pi-desktop/apps/desktop'),parent=path.resolve(options['--output-parent']);
assert.equal(path.basename(parent),'test-results');assert(fs.statSync(parent).isDirectory()&&!fs.lstatSync(parent).isSymbolicLink());
const sha=b=>createHash('sha256').update(b).digest('hex'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const commit=git('rev-parse','HEAD');assert.equal(git('status','--porcelain'),'','Source must be clean and committed');
const packaged=options['--mode']==='packaged'?options['--packaged-root']:null;
if(packaged)assert.equal(commit,options['--expected-commit']);
const packageOptions={packaged,expectedCommit:options['--expected-commit'],expectedManifestHash:options['--expected-build-manifest-sha256']},asar=packaged?loadPackageAsar(options['--deps-app']):null;
const packageInfo=packaged?await inspectParameterPackage({...packageOptions,asar}):null;
const electron=packaged?null:createRequire(path.join(options['--deps-app'],'package.json'))('electron');
const plan=versionDiffLaunchPlan({packaged,packageInfo,root,app,electron}),{core,host}=plan;
const main=packageInfo?packageInfo.main:fs.readFileSync(path.join(app,'out/main/index.js'));
for(const marker of ['assetsView','assetsProbeScript','INVALID_ASSET_ANNOTATION_RECEIPT','configureHeadlessAcceptance()','focusable: !headlessAcceptance','offscreen: !!headlessAcceptance'])assert(main.includes(Buffer.from(marker)),marker);
assert((packageInfo?packageInfo.preload:fs.readFileSync(path.join(app,'out/preload/craftmine-headless.cjs'))).includes(Buffer.from('requestPointerLock')));
const runtime=packageInfo?{sourceCommit:packageInfo.identity.runtimeSourceCommit}:JSON.parse(fs.readFileSync(path.join(root,'desktop/build/runtime-resources/runtime-resources.json'),'utf8'));assert.equal(runtime.sourceCommit,commit);
const out=fs.mkdtempSync(path.join(parent,'desktop-native-assets-')),profile=path.join(out,'profile'),legacy=path.join(out,'legacy'),data=path.join(profile,'plugins/data/craftmine.world'),input=path.join(out,'input'),token=randomUUID();
for(const directory of [data,legacy,input])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy}));
const report={format:'craftmine.asset-client-acceptance/1',passed:false,startedAt:new Date().toISOString(),commit,mode:options['--mode'],package:packageInfo?.identity??null,out,mainSha256:sha(main),coreSha256:sha(fs.readFileSync(core)),hostSha256:sha(fs.readFileSync(host)),steps:[],calls:[],launches:[],limits:['Two tiny generated local assets only. No existing personal settings/profile are read.','Metadata changes use actual navigation/Main/React forms. Core calls only seed fixtures and inspect durable state while the client is stopped.','No engine job, real model, visible input, focus or Pointer Lock. Installer execution and clean-OS testing remain separate.']};
const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
const verifyPackage=async()=>{if(packageInfo)assert.deepEqual((await inspectParameterPackage({...packageOptions,asar})).identity,packageInfo.identity,'Package changed before process startup');};
const {CoreClient}=createRequire(import.meta.url)(packaged?path.join(packaged,'resources/plugins/craftmine.world/core-client.cjs'):path.join(root,'plugins/craftmine-world/core-client.cjs'));
async function withCore(fn){await verifyPackage();const client=new CoreClient(core,data);try{await client.start();return await fn(client);}finally{await client.stop();}}
const assetIds=['asset-local-a','asset-local-b'];
async function immutable(c){return Promise.all(assetIds.map(async assetId=>({assetId,read:await c.call('asset.read',{assetId,version:1}),versions:await c.call('asset.versions',{assetId,offset:0,limit:20})})));}
let child,ended=true,ready=false,exit,launch,ownerWorldId=null;const pending=new Map();
async function start(){
 if(packageInfo)assert.deepEqual((await inspectParameterPackage({...packageOptions,asar})).identity,packageInfo.identity,'Package changed before launch');
 ended=false;ready=false;launch={at:new Date().toISOString()};report.launches.push(launch);const current=launch,number=report.launches.length;
 child=spawn(plan.executable,plan.args,{cwd:plan.cwd,env:isolatedParameterEnvironment(process.env,{out,profile,token,core,host,bases:plan.bases}),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>fs.appendFileSync(path.join(out,`${number}-${stream}.log`),bytes));
 child.on('message',m=>{if(m?.type==='craftmine-headless-ready')ready=true;if(m?.type==='craftmine-headless-exit')current.audit=m;if(m?.type!=='craftmine-headless')return;const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);});
 exit=new Promise(resolve=>{const finish=(code,signal,error)=>{if(ended)return;ended=true;current.exit={code,signal,error:String(error??'')};for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Client exited'));}pending.clear();persist();resolve();};child.once('error',e=>finish(null,null,e));child.once('exit',(code,signal)=>finish(code,signal));});
}
function rpc(method,payload={},timeout=60000){return new Promise((resolve,reject)=>{if(ended||!child.connected)return reject(Error('Client exited'));const id=randomUUID(),record={method,payload};report.calls.push(record);const timer=setTimeout(()=>{pending.delete(id);record.error='timeout';reject(Error('Timed out '+method));},timeout);pending.set(id,{timer,resolve:value=>{record.result=value;resolve(value);},reject:e=>{record.error=String(e);reject(e);}});child.send({type:'craftmine-headless',id,method,...payload});});}
const nav=(channel,payload={})=>rpc('worldNavigation',{channel,payload}),view=(action,args={})=>rpc('assetsView',{payload:{action,ownerWorldId,...args}});
async function until(fn,accept,label){const deadline=Date.now()+60000;let last;while(Date.now()<deadline){if(ended)throw Error('Client exited: '+label);try{last=await fn();}catch(e){last={error:String(e)};}if(accept(last))return last;await delay(150);}throw Error(label+': '+JSON.stringify(last));}
async function step(name,fn){try{const result=await fn();report.steps.push({name,passed:true,result});persist();console.log('PASS '+name);return result;}catch(e){report.steps.push({name,passed:false,error:String(e)});persist();throw e;}}
async function stop(){if(!launch)return;if(!ended){try{await rpc('quit',{},5000);}catch{}await Promise.race([exit,delay(20000)]);if(!ended){launch.forcedStop=true;child.kill();await Promise.race([exit,delay(5000).then(()=>{throw Error('CLIENT_STOP_TIMEOUT');})]);}}assertCleanHeadlessShutdown(launch);}
async function openAssets(){
 await until(()=>ready,Boolean,'private controller');
 await until(async()=>{const list=await nav('world.list');ownerWorldId=list.activeWorldId??null;return view('open');},v=>v.open,'actual asset navigation');
 return until(()=>view('read'),v=>v.cards?.length===2&&!v.error,'two seeded cards');
}
try {
 await withCore(async c=>{for(const [n,assetId]of assetIds.entries()){
  const sourcePath=path.join(input,assetId+'.png');fs.writeFileSync(sourcePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'));
  await c.call('asset.import',{operationId:'seed-'+assetId,sourceRoot:input,sourcePath,assetId,version:1,kind:'raw',mediaKind:'image',path:assetId+'.png',mediaType:'image/png',displayName:assetId,source:{origin:'fixed-local-test',author:'test-fixture',license:'unknown',licenseStatus:'unverified'},tags:[]});
 }report.beforeAssets=await immutable(c);});
 await start();await step('actual Main navigation opens the local asset library',openAssets);const beforeWorlds=await nav('world.list');report.beforeWorlds=beforeWorlds;
 await view('select',{assetId:assetIds[0],version:1});await until(()=>view('read'),v=>v.selected?.assetId===assetIds[0],'selected detail');
 await step('favorite and filter commit through real forms',async()=>{await view('favorite',{assetId:assetIds[0]});await until(()=>view('read'),v=>v.selected?.favorite&&!v.selected.pending,'favorite receipt');await view('filter',{favoritesOnly:true});return until(()=>view('read'),v=>v.cards?.length===1&&v.cards[0].assetId===assetIds[0],'favorite filter');});
 await step('unfavorite removes only its filtered card',async()=>{await view('favorite',{assetId:assetIds[0]});const value=await until(()=>view('read'),v=>v.cards?.length===0&&v.selected?.favorite===false&&!v.selected.pending,'unfavorite receipt');assert.equal(value.selected.assetId,assetIds[0]);return value;});
 await step('tag edit is acknowledged without another asset changing',async()=>{await view('saveTags',{assetId:assetIds[0],tags:['建筑','常用']});await until(()=>view('read'),v=>v.selected?.tags==='常用, 建筑'&&!v.selected.pending,'tag receipt');await view('filter',{favoritesOnly:false});await until(()=>view('read'),v=>v.cards?.length===2,'all cards');await view('select',{assetId:assetIds[1],version:1});const value=await until(()=>view('read'),v=>v.selected?.assetId===assetIds[1],'second asset');assert.equal(value.selected.favorite,false);assert.equal(value.selected.tags,'');assert.deepEqual(await nav('world.list'),beforeWorlds);return value;});
 await view('close');await until(()=>view('read'),v=>!v.open,'closed asset sheet');await step('first client shutdown is strictly clean',stop);
 await withCore(async c=>{assert.deepEqual(await immutable(c),report.beforeAssets);report.afterFirstAssets=await immutable(c);});
 await start();await step('reopened actual library retains tags and favorite state',async()=>{await openAssets();await view('select',{assetId:assetIds[0],version:1});const value=await until(()=>view('read'),v=>v.selected?.assetId===assetIds[0],'reopened detail');assert.equal(value.selected.tags,'常用, 建筑');assert.equal(value.selected.favorite,false);assert.deepEqual(await nav('world.list'),beforeWorlds);return value;});
 await view('close');await until(()=>view('read'),v=>!v.open,'second sheet close');await step('second client shutdown is strictly clean',stop);
 await step('durable bodies, licenses, hashes and versions are unchanged',async()=>withCore(async c=>{assert.deepEqual(await immutable(c),report.beforeAssets);const rows=await c.call('asset.search',{scope:'local-library',query:'',tags:[],favoritesOnly:false,latestOnly:true,offset:0,limit:20});assert.equal(rows.items.length,2);assert.deepEqual(rows.items.find(v=>v.assetId===assetIds[0]).tags,['常用','建筑']);assert.equal(rows.items.find(v=>v.assetId===assetIds[0]).favorite,false);assert.deepEqual(rows.items.find(v=>v.assetId===assetIds[1]).tags,[]);return rows;}));
 report.passed=true;
} catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{try{await stop();}catch(e){report.shutdownError=String(e);report.passed=false;process.exitCode=1;}report.finishedAt=new Date().toISOString();persist();console.log(JSON.stringify({out,passed:report.passed,error:report.error,shutdownError:report.shutdownError}));}
