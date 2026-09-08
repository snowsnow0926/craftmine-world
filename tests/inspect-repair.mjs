import fs from 'node:fs';
import path from 'node:path';
import { workbench } from './workbench.mjs';
const artifact=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),w=await workbench('repair-preview');
try{
  await w.load(artifact.scene,{format:'craftmine.progress/1',player:{x:-8.5,y:6,z:17.5,yaw:.12,pitch:-.23}});
  await w.page.waitForTimeout(500);await w.saveScreenshot('flora-overview');
  w.check('真实生成的花草修复在新渲染器中载入',w.errors.length===0&&(await w.snapshot()).player.x===-8.5,w.errors);
  await w.domClick('[data-view="assets"]');await w.saveScreenshot('memory-overview');
}catch(error){w.errors.push(error.stack);console.error(error);process.exitCode=1;}finally{await w.close();console.log('Report: '+path.join(w.dir,'report.json'));}
