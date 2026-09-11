import assert from 'node:assert/strict';
export function inspectFailedPlayerRetry(report,failedMessageId,text){
 assert.equal(report?.format,'craftmine.promo-player/1');assert.equal(report.status,'RUN_FAILED');assert.equal(report.stateIntegrityVerified,true);assert.equal(report.latest?.active,false);assert.equal(report.forcedStop,undefined);assert.ok(Number.isFinite(Date.parse(report.endedAt)));
 for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(report.exitReport?.[field],[]);
 assert.equal(report.messageId,failedMessageId);assert.equal(report.text,text);assert.equal(report.latest.record.session.id,report.sessionId);const last=report.latest.record.session.messages.at(-1);assert.equal(last.role,'user');assert.equal(last.id,failedMessageId);assert.equal(last.content,text);assert.equal(last.status,'complete');assert.ok(!last.attachments?.length);assert.ok(!report.before.record.session.messages.some(m=>m.id===failedMessageId));
 assert.equal(report.latest.metrics.sessionId,report.sessionId);assert.equal(report.latest.metrics.status,'error');assert.equal(report.latest.metrics.calls.pending,0);assert.equal(typeof report.latest.metrics.turnId,'string');
 return {failedMessageId,failedTurnId:report.latest.metrics.turnId,text,sessionId:report.sessionId,worldId:report.worldId};
}
