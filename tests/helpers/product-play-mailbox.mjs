// Test operator only: fixed, authorized gameplay commands in an existing private
// profile. No prompts, source writes, installation or acceptance-state mutations.
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const allowed=new Set(['resume','explore','input-segment','snapshot','capture','save','reopen','status']);
export async function playCommand(out,id,command,args={}){
  if(!path.isAbsolute(out)||!path.basename(out).startsWith('desktop-native-product-')||!/^play-\d{3,4}(?:-[a-z0-9-]+)?$/.test(id)||!allowed.has(command))throw Error('PLAY_COMMAND_INVALID');
  const input=path.join(out,'inbox',id+'.json'),response=path.join(out,'responses',id+'.json');
  if(fs.existsSync(input)||fs.existsSync(response))throw Error('PLAY_COMMAND_ID_ALREADY_USED');
  const temp=input+'.tmp';fs.writeFileSync(temp,JSON.stringify({id,command,args},null,2)+'\n',{flag:'wx'});fs.renameSync(temp,input);
  while(!fs.existsSync(response))await delay(150);
  const result=JSON.parse(fs.readFileSync(response));
  if(result.status!=='completed')throw Object.assign(Error('PLAY_COMMAND_FAILED:'+id),{evidence:result,response});
  if(command==='input-segment'&&(result.result?.status!=='completed'||result.result?.release?.released!==true||!result.result?.operatorCheckpoint?.snapshot))throw Object.assign(Error('PLAY_INPUT_NOT_COMPLETED:'+id),{evidence:result,response});
  return {response,result:result.result};
}
export function playIdentity(out){const status=JSON.parse(fs.readFileSync(path.join(out,'status.json'))),o=status.observation;if(status.status?.status?.isRunning||!o?.worldId||!o?.buildId||!o?.instanceId)throw Error('PLAY_IDLE_FORMAL_REQUIRED');return {worldId:o.worldId,buildId:o.buildId,instanceId:o.instanceId};}
export function playSummary(result){const body=result?.operatorCheckpoint?.snapshot?.state?.body??result?.state?.body;return {status:result?.status,player:body?.player,inventory:body?.inventory,components:body?.components,checkpoint:result?.operatorCheckpoint?{receipt:result.operatorCheckpoint.receipt,via:result.operatorCheckpoint.via,continuousHumanPlay:result.operatorCheckpoint.continuousHumanPlay}:undefined};}
