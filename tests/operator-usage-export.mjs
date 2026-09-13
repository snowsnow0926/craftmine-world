// Independent offline export. It never imports a runtime/driver or calls a model.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractOperatorUsage,operatorUsageMarkdown} from './helpers/operator-usage-report.mjs';
const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.includes('--help')){console.log('node tests/operator-usage-export.mjs --report ABS_OPERATOR_REPORT --output ABS_NEW_JSON [--require-final]');process.exit(0);}
const reportFile=option('--report'),output=option('--output');
if(!reportFile||!output||!path.isAbsolute(reportFile)||!path.isAbsolute(output)||!output.endsWith('.json'))throw Error('ABSOLUTE_REPORT_AND_NEW_JSON_OUTPUT_REQUIRED');
const root=path.dirname(path.resolve(reportFile)),sources=[],readWarnings=[],reports=[],sessions=[],events=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function read(file){
  const resolved=path.resolve(file),relative=path.relative(root,resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('EVIDENCE_INPUT_OUTSIDE_OPERATOR_DIRECTORY');
  const stat=fs.lstatSync(resolved);if(!stat.isFile()||stat.isSymbolicLink())throw Error('EVIDENCE_INPUT_REGULAR_FILE_REQUIRED');
  const bytes=fs.readFileSync(resolved),after=fs.statSync(resolved);
  const stable=stat.size===bytes.length&&after.size===bytes.length&&stat.mtimeMs===after.mtimeMs;
  sources.push({file:resolved,bytes:bytes.length,sha256:sha(bytes),stableDuringRead:stable});
  if(!stable)readWarnings.push({code:'INPUT_CHANGED_WHILE_READING',file:resolved});
  return bytes.toString('utf8');
}
const seen=new Set();let current=path.resolve(reportFile);
while(current){if(seen.has(current))throw Error('OPERATOR_REPORT_CHAIN_CYCLE');seen.add(current);const data=JSON.parse(read(current));if(data.format!=='craftmine.product-agent-operator/1'||path.resolve(data.out)!==root)throw Error('OPERATOR_REPORT_OWNER_MISMATCH');reports.unshift({source:current,data});current=data.previousReport?path.resolve(data.previousReport):null;}
const eventFile=path.join(root,'agent-events.ndjson');
if(fs.existsSync(eventFile)){
  const text=read(eventFile),lines=text.split('\n');
  for(let index=0;index<lines.length;index++){const line=lines[index].trim();if(!line)continue;try{events.push({source:eventFile,line:index+1,data:JSON.parse(line)});}catch(error){if(index===lines.length-1&&!text.endsWith('\n'))readWarnings.push({code:'INCOMPLETE_FINAL_EVENT_LINE',file:eventFile,line:index+1});else throw Error('INVALID_EVENT_JSON:'+eventFile+':'+(index+1));}}
}else readWarnings.push({code:'EVENT_LOG_MISSING',file:eventFile});
const turnsDirectory=path.join(root,'turns');
if(fs.existsSync(turnsDirectory))for(const name of fs.readdirSync(turnsDirectory).filter(name=>/^[a-zA-Z0-9_-]+\.json$/.test(name)).sort()){
  const file=path.join(turnsDirectory,name),value=JSON.parse(read(file));
  if(value.turn&&value.session?.session?.id){reports.push({source:file,turnField:'turn',data:{format:'craftmine.product-agent-operator/1',sessionId:value.session.session.id,turns:[value.turn]}});sessions.push({source:file,data:value.session,messageField:'session.session.messages'});}
}
const sessionFile=path.join(root,'session.json');if(fs.existsSync(sessionFile))sessions.push({source:sessionFile,data:JSON.parse(read(sessionFile))});
const result=extractOperatorUsage({reports,events,sessions});result.inputs=sources;result.inputWarnings=readWarnings;result.operatorReport=path.resolve(reportFile);
if(readWarnings.some(row=>['INPUT_CHANGED_WHILE_READING','INCOMPLETE_FINAL_EVENT_LINE'].includes(row.code))){result.finalAggregate=null;result.aggregateAvailability='unstable-input-snapshot-no-final-total';}
const markdown=output.slice(0,-5)+'.md';
if([output,markdown].some(file=>fs.existsSync(file)||sources.some(source=>source.file===path.resolve(file))))throw Error('NEW_EVIDENCE_OUTPUT_FILES_REQUIRED');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});fs.writeFileSync(markdown,operatorUsageMarkdown(result),{flag:'wx'});
console.log(JSON.stringify({output,markdown,turns:result.turns.length,terminalTurns:result.turns.filter(row=>row.terminal).length,aggregateAvailability:result.aggregateAvailability}));
if(args.includes('--require-final')&&!result.finalAggregate)process.exitCode=2;
