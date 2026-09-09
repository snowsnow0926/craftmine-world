// Exercise the extracted browser verifier through the real local HTTP route.
// Independent headless profiles only; this script never calls input helpers.
import path from 'node:path';
import {workbench} from './workbench.mjs';
import {compileScene} from '../app/scene.mjs';
import {verifyBehaviors} from '../app/behavior-verify.mjs';
import {behaviorScene} from './behavior-fixtures.mjs';

const w=await workbench('shared-behavior-verification');
try {
  const scene=behaviorScene();
  scene.behaviors[0].code=scene.behaviors[0].code.replace('color:null',"color:'#ff5599'");
  const valid=await verifyBehaviors(compileScene(scene),{origin:w.origin});
  w.check('共享验收器观察实际碰撞、位置和颜色变化，并验证恢复事件',valid.passed&&valid.modules.length===2&&valid.modules.every(module=>module.events.includes('restore')),valid);
  scene.behaviors[0].code="throw Error('TOP_LEVEL_MUST_STAY_IN_WORKER'); export function step({state}) {return {state,commands:[]};}";
  const broken=compileScene(scene);
  const result=await verifyBehaviors(broken,{origin:w.origin});
  w.check('顶层源码仅在隔离 Worker 执行，异常成为失败证据',!result.passed&&result.modules[0].error.includes('TOP_LEVEL_MUST_STAY_IN_WORKER'));
  w.check('检查没有修改测试世界', (await w.api('/api/state')).history.length===1);
}catch(error){w.errors.push(String(error.stack||error));console.error(error);process.exitCode=1;}
finally{await w.close();console.log('Shared verifier report: '+path.join(w.dir,'report.json'));}
