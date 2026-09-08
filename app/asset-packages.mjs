import { validateAsset } from './assets.mjs';
import { validateModule } from './memory.mjs';
import { decodeWorldAssets,WORLD_ASSET_LIMITS } from './asset-binding.mjs';
import { exactKeys } from './gameplay.mjs';
export const PACKAGE_BYTES=48*1024*1024;
export const moduleAssetsScene=module=>({objects:module.kind==='creation'?module.payload.objects:module.kind==='object'?[module.payload]:[]});
export function validatePackedAssets(scene,input){
  if(!Array.isArray(input)||input.length>WORLD_ASSET_LIMITS.assets)throw Error('作品素材清单无效或超过 16 个版本');
  const assets=input.map(validateAsset);decodeWorldAssets(scene,assets);return assets;
}
export function unpackModule(input,library,data){
  if(input?.format==='craftmine.module-package/1'){
    exactKeys(input,['format','module','assets']);const module=validateModule(input.module),assets=validatePackedAssets(moduleAssetsScene(module),input.assets);return {module,assets};
  }
  const module=validateModule(input);return {module,assets:library.resolve(data,moduleAssetsScene(module))};
}
