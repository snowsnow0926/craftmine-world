import { createHash } from 'node:crypto';
import {checkModuleSyntax} from './behavior-syntax.mjs';
import { validateBehavior } from './behavior-contracts.mjs';
import { canonicalJSON } from './canonical.mjs';

const parsed=new Set();
// 静态识别 ES 模块是否真的导出了 step。源码在服务里从不执行，所以只能用结构判断；
// 真正的玩法验收仍在隔离 Worker 中完成，这里只把明显错误提前到构建阶段。
const EXPORTED_STEP=/\bexport\s+(async\s+)?function\s+step\b|\bexport\s+(async\s+)?(const|let|var)\s+step\b|\bexport\s*\{[^}]*\bstep\b[^}]*\}/;
const COMMONJS_EXPORT=/\b(module\.)?exports\./;

export function compileBehavior(input){
  const definition=validateBehavior(input);
  // Parsing only. The generated file is never executed in the Node service.
  const sourceHash=createHash('sha256').update(definition.code).digest('hex');
  if(!parsed.has(sourceHash)){
    checkModuleSyntax(definition.code);
    if(parsed.size>=128)parsed.delete(parsed.values().next().value);parsed.add(sourceHash);
  }
  if(COMMONJS_EXPORT.test(definition.code))throw Error('玩法源码必须使用 ES 模块导出，不能用 CommonJS 的 exports.xxx；请写成 export function step({frame,params,state}){...}');
  if(!EXPORTED_STEP.test(definition.code))throw Error('玩法源码必须导出 step 函数，例如 export function step({frame,params,state}){ return {state,commands}; }；不能只写 function step，也不能省略 export');
  const hash=createHash('sha256').update(canonicalJSON(definition)).digest('hex');
  return {format:'craftmine.behavior-build/1',id:'code-'+hash.slice(0,20),hash,definition,checks:['源码结构、状态与权限声明校验通过','JavaScript 模块语法检查通过（尚不代表玩法验收）','已确认源码以 ES 模块导出 step 函数']};
}
