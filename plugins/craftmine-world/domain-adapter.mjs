import {compileScene, INITIAL_SNAPSHOT, validateSnapshot} from '../../app/scene.mjs';

export function emptyWorld(title) {
  const build = compileScene({format:'craftmine.scene/3',title,night:false,objects:[],systems:[],behaviors:[]});
  return {build:{...build,id:'v-'+build.hash.slice(0,20)},snapshot:structuredClone(INITIAL_SNAPSHOT),extensions:[]};
}

export {validateSnapshot};
