import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const PRODUCT_AGENT_COMMANDS = new Set(['status','brief','goal-add','goal-review','prompt','send-composer','composition','answer','permission','install-proposal','candidate','explore','capture','history','source-read','save','reopen','publish','export-template','abort','quit']);
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
