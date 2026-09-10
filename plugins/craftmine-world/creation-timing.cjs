'use strict';
const {performance}=require('node:perf_hooks');

// Durations describe actual work, including failed and replayed attempts. They
// are not progress percentages and are never used to bypass an identity check.
function creationTiming(clock=()=>performance.now()) {
  const started=clock(),stages=[];
  const elapsed=from=>Math.max(0,Math.round((clock()-from)*1000)/1000);
  async function measure(stage,run){
    const start=clock();let passed=false;
    try{const result=await run();passed=true;return result;}
    finally{stages.push({stage,elapsedMs:elapsed(start),passed});}
  }
  function snapshot(){return {format:'craftmine.creation-timing/1',totalMs:elapsed(started),stages:stages.map(item=>({...item}))};}
  return {measure,snapshot};
}
module.exports={creationTiming};
