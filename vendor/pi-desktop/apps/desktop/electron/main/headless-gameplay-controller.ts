import {browserKey,type GameInputEvent} from './headless-game-input';
import type {PlayIdentity} from './headless-play-action';
type Data=Record<string,any>;
export type InputSegment={keys?:string[];buttons?:Array<'left'|'middle'|'right'>;motion?:{x:number;y:number};frames:number;settleFrames?:number;capture?:boolean};
export function validateInputSegment(input:unknown):asserts input is InputSegment {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('GAMEPLAY_SEGMENT_INVALID');
  const s=input as Data;
  if(Object.keys(s).some(k=>!['keys','buttons','motion','frames','settleFrames','capture'].includes(k)))throw Error('GAMEPLAY_SEGMENT_FIELDS');
  if(!Number.isSafeInteger(s.frames)||s.frames<1||s.frames>600||s.settleFrames!==undefined&&(!Number.isSafeInteger(s.settleFrames)||s.settleFrames<0||s.settleFrames>600))throw Error('GAMEPLAY_FRAME_RANGE');
  if(s.capture!==undefined&&typeof s.capture!=='boolean')throw Error('GAMEPLAY_CAPTURE_FLAG');
  if(s.keys!==undefined){if(!Array.isArray(s.keys)||s.keys.length>16||new Set(s.keys).size!==s.keys.length)throw Error('GAMEPLAY_KEYS_INVALID');for(const key of s.keys)browserKey(key);}
  if(s.buttons!==undefined&&(!Array.isArray(s.buttons)||s.buttons.length>3||new Set(s.buttons).size!==s.buttons.length||s.buttons.some((b:any)=>!['left','middle','right'].includes(b))))throw Error('GAMEPLAY_BUTTONS_INVALID');
  if(s.motion!==undefined&&(!s.motion||typeof s.motion!=='object'||Object.keys(s.motion).sort().join(',')!=='x,y'||![s.motion.x,s.motion.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=4096)))throw Error('GAMEPLAY_MOTION_INVALID');
}
export type GameplayControllerAccess={instance:()=>PlayIdentity|null;dispatch:(identity:PlayIdentity,events:GameInputEvent[])=>Promise<any>;
  wait:(frames:number)=>Promise<any>;snapshot:()=>Promise<any>;observe:()=>Promise<any>;capture:(identity:PlayIdentity)=>Promise<any>;diagnostics:()=>Promise<any>;hold:()=>Promise<()=>void>};
export function createGameplayController(access:GameplayControllerAccess) {
  let active:{identity:PlayIdentity;cancelled:boolean;held:GameInputEvent[];release?:Promise<any>;work:Promise<any>;settled:boolean}|null=null;
  const identity=(requested:PlayIdentity)=>{
    const current=access.instance();
    if(!requested||Object.keys(requested).sort().join(',')!=='buildId,instanceId,worldId'||!current||['worldId','buildId','instanceId'].some(k=>(current as Data)[k]!==(requested as Data)[k]))throw Error('GAMEPLAY_IDENTITY');
  };
  const evidence=async(id:PlayIdentity,capture:boolean)=>{
    identity(id);const snapshot=await access.snapshot(),observation=await access.observe();
    const frame=capture?await access.capture(id):null;const diagnostics=await access.diagnostics();identity(id);
    return {snapshot,observation,frame,diagnostics};
  };
  const release=async(run:NonNullable<typeof active>)=>{
    if(run.release)return run.release;
    if(!run.held.length)return {released:true,events:[]};
    const events=run.held.map(event=>({...event,down:false}) as GameInputEvent).reverse();
    run.release=access.dispatch(run.identity,events).then(receipt=>{run.held=[];return {released:true,receipt};}).catch(error=>{run.release=undefined;throw error;});
    return run.release;
  };
  return {
    get busy(){return active!==null;},
    async segment(requested:PlayIdentity,s:InputSegment) {
      identity(requested);validateInputSegment(s);if(active)throw Error('GAMEPLAY_BUSY');
      const run={identity:{...requested},cancelled:false,held:[] as GameInputEvent[],release:undefined as Promise<any>|undefined,work:Promise.resolve(null) as Promise<any>,settled:false,evidence:{} as Data};active=run;
      run.work=(async()=>{
        const unhold=await access.hold();const startedAt=new Date().toISOString();
        let before,during,after,delivery,releaseReceipt,waitReceipt;
        try {
          before=await evidence(run.identity,s.capture!==false);run.evidence.before=before;
          if(!run.cancelled){
            const down:GameInputEvent[]=(s.keys??[]).map(code=>({kind:'key',code,key:browserKey(code),down:true}));
            for(const button of s.buttons??[])down.push({kind:'button',button:['left','middle','right'].indexOf(button) as 0|1|2,down:true});
            // Record before the async dispatch so a cancelled/lost reply still
            // sends releases for every key that could have reached the engine.
            run.held=down;const events=[...down];if(s.motion)events.push({kind:'motion',...s.motion});
            delivery=await access.dispatch(run.identity,events);
            waitReceipt=await access.wait(s.frames);identity(run.identity);
            if(!run.cancelled){during={source:'native-observation-before-release',waitReceipt,...await evidence(run.identity,s.capture!==false)};run.evidence.during=during;}
          }
        } finally {
          try {releaseReceipt=await release(run);run.evidence.release=releaseReceipt;}
          finally{unhold();}
        }
        if((s.settleFrames??1)>0)await access.wait(s.settleFrames??1);
        after=await evidence(run.identity,s.capture!==false);run.evidence.after=after;
        const guardCalls=(e:any)=>e?.diagnostics?.views?.reduce((n:number,v:any)=>n+(v.runtime?.guard?.pointerLock??0)+(v.runtime?.guard?.focus??0),0)??0;
        const policyBlocked=guardCalls(after)>guardCalls(before);
        return {format:'craftmine.gameplay-segment/1',status:run.cancelled?'cancelled':policyBlocked?'policy-blocked':'completed',identity:run.identity,
          requested:s,startedAt,endedAt:new Date().toISOString(),delivery,waitReceipt,release:releaseReceipt,before,during,after,
          evidenceKind:'scripted-input-functional',semanticSuccess:null,policyBlocked,
          limitations:['DOM delivery alone does not prove an authored control consumed the event.','Snapshots, observations and frames are sequential samples, not a shared physics tick.','Human control feel and unknown gameplay objectives are not assessed.']};
      })();
      try{return await run.work;}catch(error){if(error&&typeof error==='object')Object.assign(error,{gameplayEvidence:{identity:run.identity,requested:s,...run.evidence,heldUnreleased:run.held.length>0}});throw error;}finally{run.settled=true;if(active===run&&!run.held.length)active=null;}
    },
    async cancel(requested:PlayIdentity) {
      identity(requested);const run=active;
      if(!run)return {status:'idle',released:true};
      if(['worldId','buildId','instanceId'].some(key=>(run.identity as Data)[key]!==(requested as Data)[key]))throw Error('GAMEPLAY_IDENTITY');
      run.cancelled=true;const receipt=await release(run);if(run.settled&&active===run&&!run.held.length)active=null;return {status:active===run?'cancelling':'cancelled',...receipt};
    },
    async drain() {
      const run=active;if(!run)return;
      run.cancelled=true;await release(run);await run.work.catch(()=>{});if(active===run)active=null;
    },
  };
}
