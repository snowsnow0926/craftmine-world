// Matched fresh-agent experiment using the ordinary project author CLI.
// This runner never writes authored world source or supplies a model budget.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
export const OBJECTIVE='请在当前世界原有的 64×64 米场地内，做一个可以实际走进去游玩的峡谷城小庭院：两栋红色坡屋顶的房屋，深色木结构与石头基座，带少量尖刺装饰；南侧是一座有两座塔、两边有短城墙的敞开城门；一条平坦的沙土地街道连接城门和两栋房屋。两栋房屋都要有正常人物能够进出的门洞和完整屋顶，城门中间可以穿过，地面与墙体有正确碰撞。整体要像一个完成的小聚落，不要用几个简单方块占位。保留当前玩家、出生位置、已有内容和 WASD/鼠标视角操作，让保存后重开还可以继续走动。这次只需要这两栋房屋、城门和街道，不需要守卫、战斗、任务或整座城市。请使用正常创作、检查和候选流程，交付时说明城门通道、两个房门的位置和实际完成状态；素材提案、写入源文件、检查通过与正式应用要如实区分。';
export const MODES={fresh:'这次请从头制作需要的房屋、城门和街道，不复用已有模型、素材组件或世界模板。',library:'这次请优先从本地素材库找到已经完成的峡谷城房屋、城门或街区并复用；找到完整匹配时不要重新建模。',reference:'当前世界是从已经完成同一庭院目标的参考世界模板新建的独立世界。请保留可以直接复用的成果，核对上面的全部要求，必要时再调整；不要为了重新生成而删除已经合适的内容。'};
export function summarizeEvents(events){
 const turns=[];let current=null,lastTotal=null;
 for(const event of events){
  if(event.type==='user'){current={hostTurnId:event.hostTurnId,request:event.text,startedAt:event.at,tools:{},errors:[],usageBefore:lastTotal};turns.push(current);}
  if(event.type==='usage'){const total=event.tokenUsage?.total??null;if(total){lastTotal=total;if(current)current.usageAfter=total;}}
  if(!current)continue;
  if(event.type==='tool-start')current.tools[event.name]=(current.tools[event.name]??0)+1;
  if(event.type==='tool-error')current.errors.push({name:event.name,error:event.error});
  if(event.type==='turn-end'){current.endedAt=event.at;current.elapsedMs=event.elapsedMs;current.status=event.status;current=null;}
 }
 for(const turn of turns){if(turn.usageAfter)turn.usage=Object.fromEntries(Object.entries(turn.usageAfter).filter(([,value])=>typeof value==='number').map(([key,value])=>[key,value-(turn.usageBefore?.[key]??0)]));}
 return {turns,totals:turns.reduce((result,turn)=>{result.elapsedMs+=turn.elapsedMs??0;for(const [key,value]of Object.entries(turn.usage??{}))result.tokens[key]=(result.tokens[key]??0)+value;return result;},{elapsedMs:0,tokens:{}}),missingUsage:turns.filter(turn=>!turn.usage).map(turn=>turn.hostTurnId),scope:'Per-turn differences of actual CLI cumulative counters. Output already includes reasoning; model-turn and operator/first-playable times are separate.'};
}
export async function benchmarkMain(argv=process.argv.slice(2)){
 const [action,...args]=argv,options={};for(let i=0;i<args.length;i+=2){if(!['--data','--mode','--codex','--request-file'].includes(args[i])||!args[i+1])throw Error('BENCHMARK_ARGUMENTS');options[args[i]]=args[i+1];}
 const data=options['--data'];if(!data||!path.isAbsolute(data))throw Error('BENCHMARK_ABSOLUTE_DATA_REQUIRED');
 if(action==='cost'){
  const filename=path.join(data,'events.jsonl'),bytes=fs.readFileSync(filename),events=bytes.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),summary={...summarizeEvents(events),eventsSha256:createHash('sha256').update(bytes).digest('hex')};fs.writeFileSync(path.join(data,'benchmark-cost.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));return summary;
 }
 if(action!=='turn'||!MODES[options['--mode']]||!path.isAbsolute(options['--codex']??''))throw Error('BENCHMARK_ARGUMENTS');
 const mode=options['--mode'],state=JSON.parse(fs.readFileSync(path.join(data,'session.json')));if(state.model!=='gpt-6-astra'||state.effort!=='xhigh')throw Error('BENCHMARK_MODEL_MISMATCH');
 const request=options['--request-file']?JSON.parse(fs.readFileSync(options['--request-file'],'utf8')).request:OBJECTIVE+'\n\n'+MODES[mode];if(typeof request!=='string'||!request.trim())throw Error('BENCHMARK_REQUEST_REQUIRED');
 const sequence=fs.readdirSync(data).filter(file=>/^benchmark-turn-\d+\.json$/.test(file)).length+1,stem='benchmark-turn-'+sequence,record={format:'craftmine.courtyard-benchmark-turn/1',mode,request,model:state.model,effort:state.effort,worldId:state.worldId,projectId:state.projectId,sessionId:state.sessionId,sourceIdentity:state.sourceIdentity,threadWasFresh:state.threadId===null,startedAt:new Date().toISOString(),status:'running',modelBudgetAdded:false};
 const target=path.join(data,stem+'.json');fs.writeFileSync(target,JSON.stringify(record,null,2));
 const stdout=fs.openSync(path.join(data,stem+'.stdout.jsonl'),'wx'),stderr=fs.openSync(path.join(data,stem+'.stderr.log'),'wx');
 const child=spawn(process.execPath,[path.join(root,'scripts/promo-world-author.mjs'),'turn','--data',data,'--codex',options['--codex'],'--prompt',request,'--live-host','true'],{cwd:root,env:process.env,windowsHide:true,shell:false,stdio:['ignore',stdout,stderr]});
 record.pid=child.pid;fs.writeFileSync(target,JSON.stringify(record,null,2));console.log(JSON.stringify({status:'dispatched',mode,pid:child.pid,record:target,model:state.model,effort:state.effort}));
 try{record.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});record.status=record.exitCode===0?'completed':'failed';}finally{fs.closeSync(stdout);fs.closeSync(stderr);record.endedAt=new Date().toISOString();record.processElapsedMs=Date.parse(record.endedAt)-Date.parse(record.startedAt);fs.writeFileSync(target,JSON.stringify(record,null,2));}
 console.log(JSON.stringify({status:record.status,mode,processElapsedMs:record.processElapsedMs,record:target}));if(record.exitCode!==0)process.exitCode=1;return record;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))benchmarkMain().catch(error=>{console.error(error);process.exitCode=1;});
