import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonicalJSON,compileScene} from '../../app/scene.mjs';
import {captureCreation,creationGroups,creationDependencies} from '../../app/creation.mjs';
import {validateModule} from '../../app/memory.mjs';
import {flower,grass,tree,trainingScene,drainExtension} from './content.mjs';
const digest=value=>createHash('sha256').update(canonicalJSON(value)).digest('hex');
export function packages(){
  const scene=trainingScene(),extension=drainExtension(),build=compileScene(scene,{extensions:new Set(['ext:training-drain@1'])});
  const objects=[flower(),grass(),tree()].map(object=>{
    const payload={name:object.name,parts:object.parts,components:object.components};
    return {format:'craftmine.module/1',runtime:'craftmine-web/2',id:object.id,version:1,kind:'object',hash:digest({kind:'object',payload}),name:payload.name,description:'独立示例；非用户作品，安装后仍需验收。',dependencies:['geometry@2'],payload,origin:{build:build.hash,definition:object.id,time:0}};
  });
  const payload=captureCreation(creationGroups(scene)[0],scene);
  const combined={format:'craftmine.module/4',runtime:'craftmine-web/5',id:'garden-training',version:1,kind:'creation',hash:digest({kind:'creation',payload}),name:payload.name,description:'花草、生命值、近战、射击、奖励和固定版本吸血扩展的组合示例。',dependencies:creationDependencies(payload),payload,origin:{build:build.hash,definition:'training-rewards',time:0}};
  return {scene,extension,modules:[...objects,combined].map(validateModule)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const content=packages();
  for(const module of content.modules)fs.writeFileSync(new URL(module.id+'@1.json',import.meta.url),JSON.stringify(module,null,2)+'\n');
  fs.writeFileSync(new URL('training-drain@1.extension.json',import.meta.url),JSON.stringify(content.extension,null,2)+'\n');
  fs.writeFileSync(new URL('training-scene.json',import.meta.url),JSON.stringify(content.scene,null,2)+'\n');
}
