'use strict';
// Model-facing read projection only. Core receipts and diagnostic analysis stay
// unchanged; an explicit full read returns the original decorated job record.
const {createHash}=require('node:crypto');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
const fullRead=jobId=>({tool:'godot_build_read',args:{jobId,detail:'full'}});
function omitted(value,pointer){
  const text=typeof value==='string'?value:JSON.stringify(value);
  return {representation:'omitted-from-summary',pointer,sha256:hash(text),characters:text.length,
    encoding:typeof value==='string'?'utf8-text':'compact-json',trust:'untrusted-data',availableThrough:'summary.fullRead'};
}
function compactDiagnostics(value,pointer){
  if(!record(value))return value;
  const result=clone(value),groups=new Map();
  for(const original of result.diagnostics??[]){
    // Keep identity once, but never merge records with different source pins.
    const sameSource=JSON.stringify(original.source)===JSON.stringify(result.source);
    const {evidenceRefs=[],...item}=original;
    if(sameSource){delete item.source;item.sourceRef=pointer+'/source';}
    const key=JSON.stringify(item),existing=groups.get(key);
    if(existing){existing.occurrences++;for(const reference of evidenceRefs)if(!existing.evidenceRefs.some(row=>JSON.stringify(row)===JSON.stringify(reference)))existing.evidenceRefs.push(reference);}
    else groups.set(key,{...item,occurrences:1,evidenceRefs});
  }
  result.originalDiagnosticCount=result.diagnostics?.length??0;
  result.diagnostics=[...groups.values()];
  result.evidence=(result.evidence??[]).map(item=>{
    const {preview,...rest}=item;
    return {...rest,...(preview===undefined?{}:{previewOmitted:true})};
  });
  result.representation='summary';
  return result;
}

function compactGodotBuildRead(value){
  if(!record(value))return value;
  const result=clone(value);
  if(record(result.output)){
    for(const [section,key] of [['import','log'],['check','diagnosticLog'],['check','defaultsSnapshot']]){
      if(record(result.output[section])&&Object.hasOwn(result.output[section],key))result.output[section][key]=omitted(result.output[section][key],'/output/'+section+'/'+key);
    }
    // Artifact hashes and paths are already present in the durable top-level
    // receipt. Only omit an identical copy, never an inconsistent evidence set.
    if(Array.isArray(result.artifacts)&&JSON.stringify(result.output.artifacts)===JSON.stringify(result.artifacts))result.output.artifacts={representation:'same-as',pointer:'/artifacts'};
  }
  result.diagnostics=compactDiagnostics(result.diagnostics,'/diagnostics');
  result.summary={format:'craftmine.godot-tool-summary/1',fullRead:fullRead(result.jobId),
    note:'Logs and default snapshots are referenced, not repeated. All distinct diagnostics remain; counts do not change the core verdict. A passed check does not prove adoption or gameplay.'};
  return result;
}

function compactGodotProjectFacts(value){
  if(!record(value))return value;
  const result=clone(value),job=result.recovery?.latestJob;
  if(record(job)&&record(job.diagnostics)){
    job.diagnostics=compactDiagnostics(job.diagnostics,'/recovery/latestJob/diagnostics');
    job.summary={format:'craftmine.godot-tool-summary/1',fullRead:fullRead(job.jobId),note:'This recovery overview does not repeat raw check logs. Core status, source comparison and candidate/application evidence remain separate.'};
  }
  return result;
}

module.exports={compactGodotBuildRead,compactGodotProjectFacts};
