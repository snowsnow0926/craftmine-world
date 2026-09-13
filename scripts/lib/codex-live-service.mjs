import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {MODEL,redact} from './codex-app-server.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const require=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const desktopRequire=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
const DOMAIN=new Set(['world.read','godotWorld.initStatus','godotWorld.initLaunchFailed','godotWorld.initLaunchRetry',
  'godotRuntime.describe','godotRuntime.describeCandidate','godotRuntime.saveProgress','godotCandidate.read',
  'godotApplication.prepare','godotApplication.commit','godotApplication.read','godotApplication.abort',
  'content.status','content.apply.prepare','content.apply.advance','content.apply.confirm','content.apply.rollback','content.operation.read']);
const METHODS={open:[],status:[],observe:['worldId','buildId','instanceId'],capture:['worldId','buildId','instanceId','candidateId'],
  snapshot:[],save:[],pause:[],resume:[],preview:['candidateId'],apply:['candidateId'],previewClose:[],retryFirstLoad:['candidateId'],
  performance:['worldId','buildId','instanceId'],walk:['forward','right','frames'],inputSegment:['identity','segment'],validateInputPlan:['segments'],cancelInputs:['identity'],diagnostics:[],close:[],shutdown:[],check:['descriptor'],cancelCheck:[],cancelFirstLoad:[]};
export function validateLiveCommand(method,args={}) {
  if(!Object.hasOwn(METHODS,method)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!METHODS[method].includes(k)))throw Error('LIVE_OPERATION_NOT_ALLOWED');
  if(['apply','preview','retryFirstLoad'].includes(method)&&!/^gcan-[a-f0-9]{64}$/.test(args.candidateId??''))throw Error('LIVE_CANDIDATE_REQUIRED');
}
export function validateLiveDomain(worldId,method,args) {
  if(!DOMAIN.has(method)||!args||typeof args!=='object'||Array.isArray(args))throw Error('LIVE_DOMAIN_NOT_ALLOWED');
  if(args.worldId!==undefined&&args.worldId!==worldId||args.context?.worldId!==undefined&&args.context.worldId!==worldId||method==='world.read'&&args.id!==worldId)throw Error('LIVE_WORLD_MISMATCH');
}

export async function startCodexLiveService({core,state,data}) {
  if(typeof state?.pluginRoot!=='string'||!path.isAbsolute(state.pluginRoot))throw Error('LIVE_PLUGIN_ROOT_REQUIRED');
  const {flattenObservationEnvelope}=createRequire(import.meta.url)(path.join(state.pluginRoot,'tool-services.cjs'));
  if(typeof flattenObservationEnvelope!=='function')throw Error('LIVE_PLUGIN_SERVICE_INVALID');
  await core.start();
  const parent=path.join(data,'test-results');await fs.mkdir(parent,{recursive:true});
  const directory=await fs.mkdtemp(path.join(parent,'desktop-native-codex-live-'));
  const profile=path.join(directory,'profile'),legacy=path.join(directory,'empty-import'),appRoot=path.join(directory,'app');
  await fs.mkdir(profile);await fs.mkdir(legacy);
  const token=randomUUID();
  await fs.writeFile(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:legacy,rendering:'offscreen'}));
  const {build}=require('esbuild');
  for(const [entry,out] of [
    ['scripts/lib/codex-live-main.ts','main/index.cjs'],
    ['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs'],
    ['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs'],
    ['vendor/pi-desktop/apps/desktop/electron/preload/craftmine-headless.ts','preload/craftmine-headless.cjs'],
  ])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appRoot,out),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
  await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify({main:'main/index.cjs'}));
  await fs.writeFile(path.join(appRoot,'surface.html'),'<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>html,body{margin:0;background:#172028}</style>');
  const env={CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:directory,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token,CRAFTMINE_CODEX_LIVE_WORLD:state.worldId};
  for(const key of ['SystemRoot','WINDIR','COMSPEC','PATH'])if(process.env[key])env[key]=process.env[key];
  for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){env[key]=path.join(directory,key.toLowerCase());await fs.mkdir(env[key]);}
  const child=spawn(desktopRequire('electron'),[appRoot],{cwd:directory,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});
  const pending=new Map();let ended=false,closing,guardWrite=Promise.resolve(),exitWrite=Promise.resolve();
  let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const diagnostics=[];
  // Only this helper's own bounded diagnostics, with no inherited account environment.
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostics.push(redact(String(chunk)));if(diagnostics.length>40)diagnostics.shift();});
  const exited=new Promise(resolve=>child.once('close',code=>{
    const methods=[...pending.values()].map(call=>call.method);
    if(code!==0||methods.length)exitWrite=Promise.all([
      fs.writeFile(path.join(directory,'unexpected-exit.json'),JSON.stringify({code,pendingMethods:methods,worldId:state.worldId,at:new Date().toISOString()},null,2)),
      fs.writeFile(path.join(directory,'failure.log'),diagnostics.join('')),
    ]).catch(()=>{});
    ended=true;const error=Error('LIVE_HOST_EXITED:'+code);rejectReady(error);for(const call of pending.values())call.reject(error);pending.clear();resolve(code);
  }));
  child.on('error',()=>rejectReady(Error('LIVE_HOST_START_FAILED')));
  child.on('message',async message=>{
    if(message?.kind==='codex-live-ready'){resolveReady();return;}
    if(message?.kind==='codex-live-domain') {
      try {
        validateLiveDomain(state.worldId,message.method,message.params);
        const result=await core.call(message.method,message.params,60000);
        if(child.connected)child.send({kind:'codex-live-domain-result',id:message.id,result});
      }catch(error){if(child.connected)child.send({kind:'codex-live-domain-result',id:message.id,error:{code:error.errorCode??error.code??error.message,message:redact(error.message)}});}
      return;
    }
    if(message?.type==='craftmine-headless-exit')guardWrite=fs.writeFile(path.join(directory,'guards.json'),JSON.stringify(message,null,2));
    if(message?.kind!=='codex-live-result')return;
    const call=pending.get(message.id);if(!call)return;pending.delete(message.id);
    if(message.error)call.reject(Error(redact(message.error)));else call.resolve(message.result);
  });
  const startup=setTimeout(()=>{rejectReady(Error('LIVE_HOST_STARTUP_FAILED'));child.kill();},30000);
  try{await ready;}catch(error){child.kill();await exited;await fs.writeFile(path.join(directory,'failure.log'),diagnostics.join(''));throw error;}
  finally{clearTimeout(startup);}
  function call(method,args={}) {
    validateLiveCommand(method,args);
    if(ended)return Promise.reject(Error('LIVE_HOST_CLOSED'));
    return new Promise((resolve,reject)=>{
      const id=randomUUID();pending.set(id,{resolve,reject,method,args});child.send({kind:'codex-live-command',id,method,args},error=>{if(error){pending.delete(id);reject(Error('LIVE_HOST_TRANSPORT_FAILED'));}});
    });
  }
  async function authorize(context) {
    if(context?.projectId!==state.projectId||context?.sessionId!==state.sessionId||typeof context?.turnId!=='string')throw Error('LIVE_TURN_BINDING_MISMATCH');
    const current=await core.call('task.context',{context});
    if(current.world?.id!==state.worldId||current.status!=='running'||!current.lease?.owned)throw Error('LIVE_ACTIVE_TURN_REQUIRED');
  }
  const service={directory,call,
    async gameplay(identity,segment) {
      const result=await call('inputSegment',{identity,segment});
      for(const phase of ['before','during','after']){
        const frame=result[phase]?.frame;if(!frame?.pngBase64)continue;
        const imagePath=path.join(directory,`input-${phase}-${frame.sha256}.png`);
        await fs.writeFile(imagePath,Buffer.from(frame.pngBase64,'base64'));
        const {pngBase64,...receipt}=frame;result[phase].frame={...receipt,imagePath};
        await fs.writeFile(imagePath+'.json',JSON.stringify(receipt,null,2));
      }
      return result;
    },
    cancelGameplay:identity=>call('cancelInputs',{identity}),
    cancelTurn:()=>call('cancelCheck'),
    verifier:{godotCheck:descriptor=>{
      if(descriptor?.worldId!==state.worldId)throw Error('LIVE_CHECK_WORLD_MISMATCH');
      return call('check',{descriptor});
    }},
    toolServices:{
      sampleLiveState:async(input={})=>{
        if(input.worldId&&input.worldId!==state.worldId)throw Error('LIVE_WORLD_MISMATCH');
        const envelope=await call('observe',input);return envelope?flattenObservationEnvelope(envelope,{hostSampledAt:envelope.hostSampledAt}):null;
      },
      captureView:async input=>{
        await authorize(input.context);
        if(input.worldId!==state.worldId)throw Error('LIVE_WORLD_MISMATCH');
        const {context,...identity}=input,result=await call('capture',identity);
        await authorize(context);
        return {...result,status:'captured',delivery:'image-block-ready',model:{providerId:'codex-cli',modelId:MODEL,declaredImages:true,serviceVisionVerified:false}};
      },
      samplePerformance:input=>call('performance',input),
    },
    async capture(args={}) {
      const result=await call('capture',args);
      const imagePath=path.join(directory,`${result.scope}-${result.sha256}.png`);
      await fs.writeFile(imagePath,Buffer.from(result.pngBase64,'base64'));
      const {pngBase64,...receipt}=result;await fs.writeFile(imagePath+'.json',JSON.stringify(receipt,null,2));return {...receipt,imagePath};
    },
    async stop() {
      if(ended){await exitWrite;return;}
      if(closing)return closing;
      closing=(async()=>{
        for(const input of [...pending.values()].filter(p=>p.method==='inputSegment'))await call('cancelInputs',{identity:input.args.identity});
        const current=await call('status');
        if(current.instance){const {worldId,buildId,instanceId}=current.instance;await call('cancelInputs',{identity:{worldId,buildId,instanceId}});}
        // No model time limit: this deadline is only for explicit process retirement.
        const result=await call('shutdown');const timeout=setTimeout(()=>child.kill(),10000);
        await exited;clearTimeout(timeout);await guardWrite;await fs.writeFile(path.join(directory,'close.json'),JSON.stringify(result,null,2));return result;
      })();
      try{return await closing;}catch(error){
        closing=undefined;
        // Preserve a real uncommitted runtime snapshot for explicit recovery;
        // this file is not a Core save receipt or a second world store.
        const snapshot=await call('snapshot').catch(()=>null);
        await fs.writeFile(path.join(directory,'unpersisted-runtime.json'),JSON.stringify({status:'not-persisted',reason:error.message,snapshot},null,2));
        await fs.writeFile(path.join(directory,'failure.log'),diagnostics.join(''));throw error;
      }
    },
    async abandon(){child.kill();await exited;await exitWrite;},
  };
  return service;
}

export async function createServices(input) {
  const service=await startCodexLiveService(input);
  try{
    const opened=await service.call('open');
    // A CLI author turn corresponds to the desktop conversation overlay.
    // Keep the bound scene observable without running combat during model work.
    if(opened.instance)await service.call('pause');
    return service;
  }
  catch(error){await service.stop().catch(()=>service.abandon());throw error;}
}
