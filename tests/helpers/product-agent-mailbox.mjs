import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const PRODUCT_AGENT_COMMANDS = new Set(['status','brief','goal-add','goal-review','prompt','send-composer','composition','answer','permission','install-proposal','candidate','input-segment','cancel-inputs','explore','capture','history','source-read','save','reopen','publish','export-template','abort','quit']);
export function readProductAgentCommand(directory, name) {
  if (!/^[a-zA-Z0-9_-]{1,100}\.json$/.test(name)) throw Error('MAILBOX_NAME_INVALID');
  const file=path.join(directory,name),stat=fs.lstatSync(file);
  if (!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024) throw Error('MAILBOX_FILE_INVALID');
  const bytes=fs.readFileSync(file),value=JSON.parse(bytes.toString('utf8'));
  if (!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['id','command','args'].includes(key))||value.id!==name.slice(0,-5)||!PRODUCT_AGENT_COMMANDS.has(value.command)||value.args!==undefined&&(!value.args||typeof value.args!=='object'||Array.isArray(value.args))) throw Error('MAILBOX_COMMAND_INVALID');
  return {...value,args:value.args??{},sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function atomicProductAgentJson(file, value) {
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n');fs.renameSync(temp,file);
}
export function measureProductAgentFiles(files) {
  return Object.fromEntries(Object.entries(files).map(([name,file])=>{
    const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('OPERATOR_ARTIFACT_FILE_REQUIRED:'+name);
    const bytes=fs.readFileSync(file);
    return [name,{file:path.resolve(file),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}];
  }));
}
/** Always return failure evidence so the caller can persist it before exit. */
export function checkProductAgentIntegrity(expected, assertLaunchUnchanged=()=>{}) {
  const result={checkedAt:new Date().toISOString(),status:'passed',files:{}};
  try {
    result.files=measureProductAgentFiles(Object.fromEntries(Object.entries(expected).map(([name,row])=>[name,row.file])));
    const changed=Object.keys(expected).filter(name=>expected[name].bytes!==result.files[name].bytes||expected[name].sha256!==result.files[name].sha256);
    if(changed.length)throw Error('OPERATOR_REPORTED_ARTIFACT_CHANGED:'+changed.join(','));
    assertLaunchUnchanged();
  }catch(error){result.status='failed';result.error=String(error.stack??error);}
  return result;
}
