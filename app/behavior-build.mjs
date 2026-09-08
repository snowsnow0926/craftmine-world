import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateBehavior } from './behavior-contracts.mjs';
import { canonicalJSON } from './scene.mjs';

export function compileBehavior(input){
  const definition=validateBehavior(input);
  // Parsing only. The generated file is never executed in the Node service.
  const check=spawnSync(process.execPath,['--check','--input-type=module'],{input:definition.code,encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:16000});
  if(check.error)throw Error('玩法语法检查未完成：'+check.error.message);
  if(check.status!==0)throw Error('玩法源码语法错误：'+String(check.stderr).slice(0,1600));
  const hash=createHash('sha256').update(canonicalJSON(definition)).digest('hex');
  return {format:'craftmine.behavior-build/1',id:'code-'+hash.slice(0,20),hash,definition,checks:['源码结构、状态与权限声明校验通过','JavaScript 模块语法检查通过（尚不代表玩法验收）']};
}
