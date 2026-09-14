import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorCollectorPerformanceSample as sample,accumulateOperatorCollectorPerformance as accumulate} from './helpers/operator-collector-performance.mjs';
const input=(overrides={})=>({at:'2026-09-14T12:00:00Z',controllerRunId:'controller',launchIndex:1,appPid:10,collectorId:'first',worldId:'world',sessionId:'session',isRunning:true,inspectElapsedMs:40,nodeMemory:{rss:100,heapUsed:80},nodeCpu:{user:20,system:3},renderer:{memory:{usedJSHeapSize:50,totalJSHeapSize:60,jsHeapSizeLimit:100}},collector:{peakPendingRecords:14,collectedBytes:386000,observedEvents:80},...overrides});
test('cold launch and later small samples cannot erase creation-stage heap/queue maxima',()=>{
  let summary=accumulate(null,sample(input()));summary=accumulate(summary,sample(input({launchIndex:2,appPid:11,collectorId:'cold',renderer:{memory:{usedJSHeapSize:2,totalJSHeapSize:3}},collector:{peakPendingRecords:2,collectedBytes:1200,observedEvents:3}})));
  assert.equal(summary.samples,2);assert.equal(summary.sampledMax.rendererHeapUsedBytes,50);assert.equal(summary.sampledMax.peakPendingRecords,14);assert.equal(summary.collectedBytesAcrossKnownCollectors,387200);assert.equal(summary.collectors.first.appPid,10);assert.equal(summary.collectors.cold.appPid,11);
  summary=accumulate(summary,sample(input({collector:{peakPendingRecords:14,collectedBytes:386100,observedEvents:81}})));assert.equal(summary.collectedBytesAcrossKnownCollectors,387300,'same collector cumulative bytes are not repeatedly added');
});
test('missing renderer heap stays unknown instead of zero and samples contain no bodies',()=>{
  const row=sample(input({renderer:{memory:null,body:'secret body'},body:'never store this',nodeMemory:{rss:200,text:'no'},collector:{collectedBytes:0,message:'no'}}));
  assert.equal(row.rendererMemory.availability,'unknown');assert.equal(row.rendererMemory.usedJSHeapSize,null);assert(!JSON.stringify(row).includes('secret body'));assert(!JSON.stringify(row).includes('never store'));const summary=accumulate(null,row);assert.equal(summary.sampledMax.rendererHeapUsedBytes,null);assert.equal(summary.rendererHeapUnknownSamples,1);assert.equal(summary.rendererHeapSamples,0);assert.equal(summary.collectedBytesAcrossKnownCollectors,0);
});
test('a different controller invocation cannot silently relabel previous sampled maxima',()=>{
  const first=accumulate(null,sample(input()));assert.throws(()=>accumulate(first,sample(input({controllerRunId:'other'}))),/CONTROLLER_CHANGED/);
});
