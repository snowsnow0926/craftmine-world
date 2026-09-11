import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {completeCreationProgress,observationCreation} from './creation-model-evaluation.mjs';
export {CONTINUITY_EVALUATION_SUITE,CONTINUITY_EVALUATION_CASES,CONTINUITY_EVALUATION_LIMITS} from '../../vendor/pi-desktop/apps/desktop/electron/main/creation-continuity-evaluation.ts';
export const continuityHash=value=>createHash('sha256').update(value).digest('hex');
export function claimContinuityAttempt(manifestPath){
 const text=fs.readFileSync(manifestPath,'utf8'),manifest=JSON.parse(text),manifestHash=continuityHash(text),directory=path.dirname(manifestPath);
 const claim={format:'craftmine.continuity-attempt/1',runId:manifest.runId,manifestHash,startedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(directory,'attempt.json'),JSON.stringify(claim,null,2)+'\n',{flag:'wx'});return claim;
}
export function claimContinuityCase(directory,attempt,caseId){
 assert.ok(['CM01','CM02','CM03','CM04'].includes(caseId));
 const claim={runId:attempt.runId,manifestHash:attempt.manifestHash,caseId,startedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(directory,caseId,'case-attempt.json'),JSON.stringify(claim,null,2)+'\n',{flag:'wx'});return claim;
}
export function inspectContinuityOutcome({entry,before,after,target,beforeProgress,afterProgress,job,reopened,restoredProgress}){
 const checks=[],add=(name,passed)=>checks.push({name,passed:!!passed}),old=observationCreation(before),live=observationCreation(after),prior=completeCreationProgress(beforeProgress),current=completeCreationProgress(afterProgress);
 const selected=target.target?.entityId,original=old.entities.find(item=>item.id===selected),created=live.entities.filter(item=>!old.entities.some(previous=>previous.id===item.id)),entity=entry.id==='CM01'?created[0]:live.entities.find(item=>item.id===selected);
 const near=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((n,i)=>Number.isFinite(n)&&Math.abs(n-b[i])<=.005);
 add('same-world-and-actual-adopted-checked-build',after.worldId===before.worldId&&job?.worldId===after.worldId&&job?.kind==='check'&&job.status==='passed'&&job.buildId===after.buildId&&after.buildId!==before.buildId&&Array.isArray(job.output?.check?.assertions)&&job.output.check.assertions.length>0&&job.output.check.assertions.every(item=>item.passed===true));
 add('check-bound-to-exact-frozen-request',job?.checkRequirements?.creation?.requestHash===continuityHash(entry.request));
 add('actual-frozen-color-and-scale',entity?.kind==='tree'&&entity.color?.toLowerCase()===entry.color&&near(entity.scale,entry.scale)&&entity.visible===true&&entity.solid===true);
 add('actual-collision-present',!!entity&&live.obstacles?.some(item=>item.entityId===entity.id));
 if(entry.id==='CM01')add('one-new-tree-at-real-ray-ground',old.entities.length===0&&created.length===1&&live.entities.length===1&&target.source==='ray'&&target.target?.surface==='ground'&&near(entity.position,target.target.position));
 else add('same-identity-and-position-no-extra-object',!!original&&created.length===0&&old.entities.length===live.entities.length&&near(entity?.position,original.position));
 for(const previous of old.entities)if(previous.id!==selected)add('unrelated-object-preserved:'+previous.id,isDeepStrictEqual(previous,live.entities.find(item=>item.id===previous.id)));
 if(entry.id==='CM03')add('recent-copy-target-is-distinct-from-ray-original',target.source==='recent'&&before.payload.creation.target.entityId!==selected&&old.entities.length===2);
 add('inventory-rewards-and-player-preserved',isDeepStrictEqual(prior.body.inventory,current.body.inventory)&&isDeepStrictEqual(prior.body.openedChests,current.body.openedChests)&&near(prior.body.player.position,current.body.player.position));
 add('fresh-process-restores-actual-build',reopened?.worldId===after.worldId&&reopened?.buildId===after.buildId&&reopened?.instanceId!==after.instanceId);
 add('fresh-process-restores-entities-and-collision',!!reopened&&isDeepStrictEqual(live.entities,observationCreation(reopened).entities)&&isDeepStrictEqual(live.obstacles,observationCreation(reopened).obstacles));
 add('full-progress-restored',!!restoredProgress&&isDeepStrictEqual(current,completeCreationProgress(restoredProgress)));
 return checks;
}
