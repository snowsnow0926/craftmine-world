import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packStaticPackage,unpackStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(condition,code)=>{if(!condition)throw Error(code);};
const definitions=[
  {id:'cw.nature.promo-broadleaf',slug:'broadleaf',kind:'object',label:'宣传片同款阔叶树',
    tags:['树','树木','阔叶树','森林','同款树','broadleaf','tree'],
    description:'Reuse the exact Blender broadleaf model from the approved promo world, with the first grove tree tint/scale and the original base collision dimensions. This is an independent static instance; it does not replace the world tree generator.',
    controls:{leaf_color:'Per-instance foliage tint',model_scale:'Positive per-instance visual and collision scale'},
    placement:{anchor:'ground-origin',dimensionsMm:[2541,4150,2516],collisionDimensionsMm:[2640,4200,2640],measurement:'Pinned Godot imported original model with default adapter scale; dimensions rounded up to millimeters'},
    collision:{kind:'static-box',layer:1,unscaledDimensionsMm:[1200,4000,1200],defaultScaleThousandths:[2200,1050,2200]}},
  {id:'cw.scene.promo-meadow',slug:'meadow',kind:'scene',label:'宣传片同款草地与野花',
    tags:['草','草地','草甸','花','花草','野花','meadow','grass','flowers'],
    description:'Reuse the complete authored meadow decoration from the promo world, approximately 56 by 56 meters and 0.63 meters high. Grass and flowers retain their original arrangement. It adds no floor collision, trees, enemies, camera or player; use sufficiently large receiving world ground and inspect the footprint before placement. For a small flower cluster, search individual grass or flower assets instead.',
    placement:{anchor:'ground-origin',dimensionsMm:[56113,626,56130],measurement:'Pinned Godot imported original model at unit scale; dimensions rounded up to millimeters',groundRequirement:'Existing ground under the full footprint; this component adds no terrain'},
    controls:{},collision:{kind:'none',decorationOnly:true}},
];

export function buildPromoNaturePackages({repository=process.cwd()}={}){
  const template='desktop/godot/shared/promo-templates/promo-mainline';
  const sourceRoot=path.join(repository,template,'source');
  const manifestBytes=fs.readFileSync(path.join(repository,template,'manifest.json'));
  const sourceManifest=JSON.parse(manifestBytes);
  return definitions.map(definition=>{
    const originalPath=`assets/blender/${definition.slug}.glb`;
    const original=sourceManifest.files.find(file=>file.path===originalPath);
    check(original,'PROMO_NATURE_SOURCE_NOT_DECLARED');
    const model=fs.readFileSync(path.join(sourceRoot,originalPath));
    check(model.length===original.bytes&&sha(model)===original.sha256,'PROMO_NATURE_SOURCE_CHANGED');
    const script=fs.readFileSync(path.join(repository,'desktop/godot/components/promo-nature',definition.slug+'.gd'),'utf8').replace(/\r\n/g,'\n');
    const provenance={format:'craftmine.promo-nature-provenance/1',templateId:'promo-mainline',manifestSha256:sha(manifestBytes),
      source:sourceManifest.source,model:{path:originalPath,bytes:model.length,sha256:sha(model),byteRelation:'identical'},
      adapter:{sha256:sha(script),scope:definition.slug==='broadleaf'?'Instance identity and original broadleaf tint/scale/base collision adapted to an independent root.':'Instance identity around the original decoration.'}};
    const files={
      'model.glb':model,
      'component.gd':Buffer.from(script),
      'component.gd.uid':Buffer.from('uid://'+sha(definition.id+'/1/component.gd').slice(0,12)+'\n'),
      'provenance.json':Buffer.from(JSON.stringify(provenance,null,2)+'\n'),
      'ORIGINAL_ASSETS_LICENSE.txt':fs.readFileSync(path.join(sourceRoot,'licenses/ORIGINAL_ASSETS_LICENSE.txt')),
      'README.md':Buffer.from(`# ${definition.label}\n\n${definition.description}\n\nUse the live catalog archiveRef with the ordinary source installer. It creates one root with its own entity_id and preserves other scene nodes and saved player progress. It does not alter the base world scripts. Default placement is the original model origin on the ground; explicit placement must come from the real receiving scene. Check/adopt through the normal host workflow and inspect actual appearance and collision.\n\nThe model bytes match the original manifest. The wrapper is an adaptation, not proof of cross-world gameplay validation. Source license declarations and provenance are retained without asserting independent rights verification.\n`),
    };
    const content={assetId:definition.id,version:1,kind:definition.kind,
      files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})),dependencies:[],
      entry:{entities:['root'],label:definition.label,description:definition.description,
        sceneInstall:{mode:'script-node',script:'component.gd',nodeType:'Node3D',identityField:'entity_id',identityType:'String'},
        collision:definition.collision,placement:definition.placement,editableSettings:definition.controls,
        installationGuide:{automaticNodes:['one independent static root with the original model'],manualNodes:[],
          instructions:'Place only in the measured receiving scene. Preserve existing objects. Run ordinary checks and inspect the actual result; this archive does not replace a complete world.'},
        lineage:provenance},interfaces:{},compatibility:{base:'creation-sandbox',baseVersion:'1.0.0',engine:'4.7.2-stable'},
      state:{kind:'static-component-no-player-state',identity:'entity_id',progress:'receiving-world-player-progress'},
      licenses:{status:'source-declared-unverified',declarationFile:'ORIGINAL_ASSETS_LICENSE.txt',provenanceFile:'provenance.json'}};
    const rootContentHash=contentHash(content);
    const bytes=packStaticPackage({root:{id:definition.id,version:1},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:rootContentHash},files}]});
    const unpacked=unpackStaticPackage(bytes);
    check(unpacked.resources.length===1&&unpacked.resources[0].contentHash===rootContentHash,'PROMO_NATURE_PACKAGE_MISMATCH');
    const file=definition.id+'.zip';
    return {file,bytes,entry:{assetId:definition.id,version:1,kind:definition.kind,file,bytes:bytes.length,sha256:sha(bytes),rootContentHash,
      label:definition.label,tags:['builtin','approved-demo','reusable-world-content','prefab',...definition.tags],
      source:{origin:'Craftmine promo-mainline / '+originalPath,author:'Craftmine World player / Codex-authored source',
        license:'Source-declared MIT; generated/reference rights unverified',licenseStatus:'unverified'}}};
  });
}
