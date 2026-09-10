// 静态几何投影：只读取作者数据，不生成运行时身份、目标快照或玩法进度。
// 真正的选中目标和进度来自 Godot 相机射线、主机捕获与运行时脚本。
import {assertCreationScene, CREATION_HALF_EXTENTS} from './creation-scene.mjs';
const copy=value=>structuredClone(value);

export function projectCreationScene(document) {
  assertCreationScene(document);
  return {format:'craftmine.creation-projection/1',sceneRevision:document.revision,
    timeOfDay:document.defaults.timeOfDay,
    entities:document.entities.map(entity=>{
      const shape=CREATION_HALF_EXTENTS[entity.kind],angle=entity.rotationY*Math.PI/180;
      const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
      const x=shape[0]*entity.scale[0],y=shape[1]*entity.scale[1],z=shape[2]*entity.scale[2];
      const halfExtents=[x*c+z*s,y,x*s+z*c];
      return {...copy(entity),halfExtents,
        bounds:{position:[entity.position[0],entity.position[1]+y,entity.position[2]],halfExtents:[...halfExtents]}};
    }),ruleDeclarations:copy(document.rules??[])};
}
const optionsOf=({origin=[192,128],pixelsPerUnit=32,padding=8,maxDistance=Infinity}={})=>{
 if(!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite)||!Number.isFinite(pixelsPerUnit)||pixelsPerUnit<=0||!Number.isFinite(padding)||padding<0||!(Number.isFinite(maxDistance)||maxDistance===Infinity)||maxDistance<0)throw Error('CREATION_PROJECTION_OPTIONS_INVALID');
 return {origin,pixelsPerUnit,padding,maxDistance};
};
export function creationScreenPoint(entity,options={}) {
 assertCreationScene({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[entity]});
 const {origin,pixelsPerUnit}=optionsOf(options);
 return [origin[0]+entity.position[0]*pixelsPerUnit,origin[1]+entity.position[2]*pixelsPerUnit];
}
// 平面示意图命中，仅供静态投影。结果不能作为 creation_operation 的主机目标。
export function selectCreationTarget(document,point,options={}) {
 const projection=projectCreationScene(document),settings=optionsOf(options);
 if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite))throw Error('CREATION_PROJECTION_POINT_INVALID');
 let best=null;
 for(const entity of projection.entities){
  const screen=[settings.origin[0]+entity.position[0]*settings.pixelsPerUnit,settings.origin[1]+entity.position[2]*settings.pixelsPerUnit];
  const radius=Math.max(entity.halfExtents[0],entity.halfExtents[2])*settings.pixelsPerUnit+settings.padding;
  const distance=Math.hypot(point[0]-screen[0],point[1]-screen[1]);
  if(distance>radius||distance>settings.maxDistance)continue;
  if(!best||distance<best.distance||(distance===best.distance&&entity.id<best.entity.id))best={entity,distance};
 }
 return best?copy(document.entities.find(entity=>entity.id===best.entity.id)):null;
}
