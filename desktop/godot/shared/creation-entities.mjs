// 静态视图的作者数据。不存在的文档返回 null，不伪造场景版本或世界身份。
import {assertCreationScene} from './creation-scene.mjs';
export function readCreationEntities(text) {
 if(typeof text!=='string')throw Error('CREATION_SCENE_INVALID');
 if(text.trim()==='')return null;
 let value;
 try{value=JSON.parse(text);}catch{throw Error('CREATION_SCENE_INVALID');}
 assertCreationScene(value);
 return structuredClone(value);
}
export function creationRenderItems(document) {
 if(document===null)return [];
 assertCreationScene(document);
 return document.entities.map(entity=>({id:entity.id,kind:entity.kind,
  position:{x:entity.position[0],y:entity.position[2]},
  scale:{x:entity.scale[0],y:entity.scale[2]},color:entity.color}));
}
// 仅为视图坐标映射，不表示旧底座支持相应实体的碰撞、编辑或持久玩法。
export function creationRenderItemsForBase(document,baseId,options={}) {
 if(!['side-view','mining-sandbox','top-down'].includes(baseId))throw Error('CREATION_BASE_UNSUPPORTED');
 const scale=options.scale??32,origin=options.origin??[0,0];
 if(!Number.isFinite(scale)||scale<=0||!Array.isArray(origin)||origin.length!==2||!origin.every(Number.isFinite))throw Error('CREATION_PROJECTION_OPTIONS_INVALID');
 if(document===null)return [];
 assertCreationScene(document);
 const axis=baseId==='top-down'?2:1;
 return document.entities.map(entity=>({id:entity.id,kind:entity.kind,
  position:{x:origin[0]+entity.position[0]*scale,y:origin[1]+entity.position[axis]*scale},
  scale:{x:entity.scale[0],y:entity.scale[axis]},color:entity.color}));
}
