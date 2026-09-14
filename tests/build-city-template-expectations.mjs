// Freeze expectations from actual native receipts; never synthesize a default
// state by clearing a completed game's inventory or component fields.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectTemplateState,validateTemplateExpectations} from './helpers/template-import-expectations.mjs';

const [archive,snapshotFile,observationFile,output]=process.argv.slice(2);
assert([archive,snapshotFile,observationFile,output].every(value=>typeof value==='string' && path.isAbsolute(value)),'ABSOLUTE_ZIP_SNAPSHOT_OBSERVATION_OUTPUT_REQUIRED');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const snapshotReceipt=read(snapshotFile),observationReceipt=read(observationFile);
const snapshot=snapshotReceipt.result?.state?snapshotReceipt.result:snapshotReceipt;
const observation=observationReceipt.result?.observation??observationReceipt.result??observationReceipt.observation??observationReceipt;
const body=snapshot.state?.body,preparation=observation.payload?.flightPreparation;
assert.equal(body?.format,'craftmine.creation-progress/1');
assert.equal(snapshot.worldId,observation.worldId,'SAME_FROZEN_WORLD_REQUIRED');
const packet={format:'craftmine.template-import-expectations/1',archiveSha256:sha(fs.readFileSync(archive)),title:'独立玩家导入奥格瑞玛',city:{districts:6,authoredBuildings:22},quest:{items:['org-flight-chart','org-flight-clearance','org-flight-compass'],collected:preparation?.collected},checks:[],evidence:[snapshotFile,observationFile].map(file=>({file,sha256:sha(fs.readFileSync(file))}))};
for(const field of ['inventory','openedChests','doors','rules'])packet.checks.push({id:field,source:'snapshot',pointer:'/state/body/'+field,value:body[field]});
for(const [key,entityId]of [['flight',preparation?.aircraftId],['pet',preparation?.companionId]]){
 const component=body.components?.[entityId];assert(component,'ACTUAL_COMPONENT_REQUIRED:'+key);
 packet[key]={entityId,format:component.format};
 const fields=key==='flight'?['hasFlown','landings','piloted','crashed','grounded','gearDown','assist','afterburner','throttle','cockpitView','settings','sourceSettings']:['interactionCount','settings/following','settings/name','sourceSettings'];
 for(const field of fields){let value=component;for(const part of field.split('/')){assert(value&&Object.hasOwn(value,part),'ACTUAL_COMPONENT_FIELD_REQUIRED:'+field);value=value[part];}
  packet.checks.push({id:key+'-'+field,source:'snapshot',pointer:'/state/body/components/'+entityId.replaceAll('~','~0').replaceAll('/','~1')+'/'+field,value});
 }
}
validateTemplateExpectations(packet);const verified=inspectTemplateState(packet,{snapshot,observation});assert(verified.passed,JSON.stringify(verified));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,archiveSha256:packet.archiveSha256,questCollected:packet.quest.collected,checks:verified.checks.length,generatedFromActualReceipts:true}));
