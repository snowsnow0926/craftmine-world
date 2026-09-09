import {createHash,randomUUID} from 'node:crypto';

export type GodotMiningAcceptanceAccess={
  observe:()=>Promise<any>;
  action:(op:string,args:Record<string,unknown>)=>Promise<any>;
  capture:(width:number,height:number)=>Promise<{pngBase64:string;width:number;height:number;viewportObservation?:unknown}>;
  save:()=>Promise<any>;
};
const canonical=(value:any):string=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const digest=(value:any)=>createHash('sha256').update(canonical(value)).digest('hex');
const unwrap=(value:any):any=>value?.result!==undefined?unwrap(value.result):value;

/** Fixed authored mining route. No model, source patch, state injection or OS input. */
export function createGodotMiningAcceptance(access:GodotMiningAcceptanceAccess){
  let busy=false;
  return async(method:string):Promise<any>=>{
    if(method!=='godotPlayMine')throw Error('Unknown fixed mining acceptance operation');
    if(busy)throw Error('Mining acceptance already running');
    busy=true;
    const evidence:any={format:'craftmine.godot-mining-evidence/1',method,ok:false,actions:[],observations:[],snapshots:[],checks:[],limits:['Fixed mine-camp route, not model authoring or subjective gameplay acceptance','No save/restart proof until caller restarts the actual client and compares finalState']};
    let identity='',worldId='';
    const check=(name:string,passed:boolean)=>{evidence.checks.push({name,passed:!!passed});if(!passed)throw Error(name);};
    const observe=async(sample?:any)=>{
      const value=sample??await access.observe();evidence.observations.push(value);
      check('Actual mining runtime identity',value?.format==='craftmine.godot-observation/1'&&value.baseId==='mining-sandbox'&&!!value.worldId&&!!value.buildId&&!!value.instanceId);
      const next=JSON.stringify([value.worldId,value.buildId,value.instanceId,value.baseVersion]);
      check('Same runtime throughout mining route',!identity||next===identity);identity=next;worldId=value.worldId;
      check('Mining boot has no error',!value.payload?.bootError);
      return value;
    };
    const action=async(op:string,args:Record<string,unknown>={})=>{
      check('Fixed operation budget',evidence.actions.length<650);
      const item:any={op,args};evidence.actions.push(item);
      try{item.raw=await access.action(op,args);const result=unwrap(item.raw);if(item.raw?.error||result?.error||result?.ok===false)throw Error(String(item.raw?.error??result?.error??result?.reason));item.observation=await observe();return result;}
      catch(error){item.error=String(error);throw error;}
    };
    const snapshot=async(label:string)=>{
      const raw=await action('snapshot'),state=raw?.state??raw?.snapshot;
      check('Complete mining progress envelope',state?.format==='craftmine.godot-progress/1'&&state.worldId===worldId&&state.baseId==='mining-sandbox'&&state.body?.worldId===worldId&&state.body?.state?.worldId===worldId&&state.body.chunks&&typeof state.body.chunks==='object'&&!Array.isArray(state.body.chunks));
      const observation=evidence.observations.at(-1).payload;
      const nonzero=(items:any)=>Object.fromEntries(Object.entries(items??{}).filter(([,count])=>typeof count==='number'&&count>0));
      check('Observed inventory matches complete native inventory',canonical(nonzero(state.body.state.inventory))===canonical(nonzero(observation.inventory)));
      check('Observed terrain hash matches complete native chunks state',state.body.terrainHash===observation.terrainHash);
      const result=JSON.parse(JSON.stringify(state));evidence.snapshots.push({label,state:result,sha256:digest(result)});return result;
    };
    const inventory=async()=>{const value=await action('inventory');const {ok,...items}=value;return items;};
    const tile=async(tx:number,ty:number)=>action('tile',{tx,ty});
    try{
      await observe();await action('resume');await action('wait',{frames:40});
      evidence.initialState=await snapshot('initial');
      check('Fixed mine-camp terrain seed',evidence.initialState.body.seed===31415926);
      const initialInventory=await inventory();
      const movement=await action('move',{dx:0.25,dy:0,steps:4});
      check('Ordinary movement changes actual position',typeof movement.distance==='number'&&movement.distance>0);
      await action('wait',{frames:16});
      let digs=0,stoneGained=0;
      // Observe a finite local neighbourhood. Prefer reachable stone, otherwise
      // open a two-cell shaft through soil; gravity and collision move the player.
      while(stoneGained<2&&digs<24){
        const sample=await observe(),position=sample.payload?.player?.position;
        check('Finite live player position',Array.isArray(position)&&position.length===2&&position.every(Number.isFinite));
        const tx=Math.floor(position[0]/16),ty=Math.floor((position[1]+1)/16);
        const candidates:any[]=[];
        for(const dy of [0,1,2,3])for(const dx of [0,1,-1]){
          const value=await tile(tx+dx,ty+dy);
          if(value.solid&&value.breakable&&value.requiredTier===0&&['stone','grass','dirt'].includes(value.material))candidates.push(value);
        }
        const target=candidates.find(v=>v.material==='stone')??candidates[0];
        check('Bounded dig route finds reachable soil or stone',!!target);
        const before=await inventory(),beforeState=await snapshot('before-dig-'+digs);
        const receipt=await action('dig',{tx:target.tx,ty:target.ty,requestId:randomUUID()});digs++;
        const after=await inventory(),afterTile=await tile(target.tx,target.ty),afterState=await snapshot('after-dig-'+digs);
        check('Dig actually removes selected tile',afterTile.material==='air'&&!afterTile.solid);
        const drop=receipt.dropped;
        check('Dig drop is reflected in actual inventory',!!drop?.id&&drop.count>0&&(after[drop.id]??0)-(before[drop.id]??0)===drop.count);
        check('Dig changes complete native chunk edits',canonical(beforeState.body.chunks)!==canonical(afterState.body.chunks)&&beforeState.body.terrainHash!==afterState.body.terrainHash);
        check('Complete chunk contains the exact dug air cell',afterState.body.chunks[receipt.chunk]?.cells?.some((cell:any)=>Array.isArray(cell)&&cell[0]===target.tx&&cell[1]===target.ty&&cell[2]==='air')===true);
        stoneGained=(after.stone??0)-(initialInventory.stone??0);
        await action('wait',{frames:16});
      }
      check('At least two stone mined within bounded route',stoneGained>=2);
      const craftBefore=await inventory();
      const crafted=await action('craft',{recipeId:'stone-brick',requestId:randomUUID()});
      const craftAfter=await inventory();
      check('Ordinary recipe consumes two stone and grants one brick',crafted.recipeId==='stone-brick'&&(craftBefore.stone??0)-(craftAfter.stone??0)===2&&(craftAfter.stone_brick??0)-(craftBefore.stone_brick??0)===1);
      const sample=await observe(),position=sample.payload.player.position,tx=Math.floor(position[0]/16),ty=Math.floor((position[1]+1)/16);
      let destination:any=null;
      for(const dx of [2,-2,3,-3]){
        if(destination)break;
        for(const dy of [-1,0,1]){
          const candidate=await tile(tx+dx,ty+dy);if(candidate.solid)continue;
          for(const [sx,sy]of [[0,1],[1,0],[-1,0],[0,-1]])if((await tile(candidate.tx+sx,candidate.ty+sy)).solid){destination=candidate;break;}
          if(destination)break;
        }
      }
      check('A reachable supported placement cell exists outside player body',!!destination);
      const placeBefore=await snapshot('before-place'),countBefore=await inventory();
      const placement=await action('place',{tx:destination.tx,ty:destination.ty,materialId:'stone_brick',requestId:randomUUID()});
      const placed=await tile(destination.tx,destination.ty),countAfter=await inventory(),placeAfter=await snapshot('after-place');
      check('Placement consumes crafted brick and changes terrain',placed.material==='stone_brick'&&placed.solid&&(countBefore.stone_brick??0)-(countAfter.stone_brick??0)===1&&canonical(placeBefore.body.chunks)!==canonical(placeAfter.body.chunks));
      check('Complete chunk contains the exact placed brick cell',placeAfter.body.chunks[placement.chunk]?.cells?.some((cell:any)=>Array.isArray(cell)&&cell[0]===destination.tx&&cell[1]===destination.ty&&cell[2]==='stone_brick')===true);
      await action('pause');evidence.finalState=await snapshot('paused-final');
      const image=await access.capture(1280,720),bytes=Buffer.from(image.pngBase64,'base64');
      evidence.capture={image};
      check('Actual PNG matches requested capture dimensions',image.width===1280&&image.height===720&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(16)===1280&&bytes.readUInt32BE(20)===720);
      evidence.capture.observation=await observe(image.viewportObservation);
      const surface=evidence.capture.observation.payload?.surfaceSize,logical=evidence.capture.observation.payload?.logicalViewportSize;
      check('Live physical surface matches captured image',JSON.stringify(surface)===JSON.stringify([1280,720]));
      check('Live logical viewport is positive',Array.isArray(logical)&&logical.length===2&&logical.every((value:any)=>typeof value==='number'&&Number.isFinite(value)&&value>0));
      evidence.save=await access.save();
      check('Core confirms durable progress save',evidence.save?.status==='persisted'&&evidence.save?.receipt?.format==='craftmine.godot-progress-receipt/1');
      evidence.afterSave=await snapshot('after-save');
      evidence.saveComparison={equal:canonical(evidence.finalState)===canonical(evidence.afterSave),beforeSha256:digest(evidence.finalState),afterSha256:digest(evidence.afterSave)};
      check('Every native progress field survives paused save',evidence.saveComparison.equal);
      evidence.ok=true;
    }catch(error){evidence.error=String(error);try{evidence.failurePause=await access.action('pause',{});}catch(pauseError){evidence.failurePauseError=String(pauseError);}}
    finally{busy=false;}
    return evidence;
  };
}
