// Refresh reviewed publication byte pins; do not infer third-party rights.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),relative='desktop/godot/shared';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sharedFile=path.join(root,'desktop/delivery/base-assets/shared-runtime.json');
const shared=JSON.parse(fs.readFileSync(sharedFile));
for(const entry of shared.entries){const file=path.join(root,relative,entry.path);if(entry.path==='materialize.mjs'){const bytes=fs.readFileSync(file);entry.bytes=bytes.length;entry.sha256=hash(bytes);}}
fs.writeFileSync(sharedFile,JSON.stringify(shared,null,2)+'\n');
const fontEntries=JSON.parse(fs.readFileSync(path.join(root,'desktop/delivery/base-assets/bases-creation-sandbox.json'))).entries;
const manifest={format:'craftmine.base-assets/1',baseId:'approved-world-templates',displayName:'Approved authored world templates',baseVersion:'1.0.0',
 sourceDirectory:relative,rightsStatus:'pending-formal-application',rightsNote:'Project-generated demonstration source and Blender models, published for the local application. Preserve the Noto-derived font OFL notice. These declarations do not grant exclusive rights to AI output or rights in third-party trademarks or fictional settings.',entries:[],requiredNotices:[]};
const files=['world-templates.mjs',...fs.readdirSync(path.join(root,relative,'promo-templates'),{recursive:true}).filter(p=>fs.statSync(path.join(root,relative,'promo-templates',p)).isFile()).map(p=>'promo-templates/'+p.replaceAll('\\','/'))];
for(const file of files.sort()){
 const bytes=fs.readFileSync(path.join(root,relative,file));
 const font=fontEntries.find(e=>file.endsWith('/source/'+e.path)&&e.path.startsWith('assets/fonts/'));
 if(font&&(font.bytes!==bytes.length||font.sha256!==hash(bytes)))throw Error('FONT_PROVENANCE_PIN_MISMATCH');
 const entry=font?{...font,path:file,licenseFile:font.licenseFile?file.split('/source/')[0]+'/source/'+font.licenseFile:null}:{path:file,role:file.endsWith('.glb')?'model':file.endsWith('.png')?'preview':'source',origin:'authored',author:'Craftmine World project with Codex-assisted authoring',version:'1.0.0',license:'project-authored',licenseFile:null,redistribution:'permitted',distribution:['app-bundle','user-export'],outstanding:'Local project publication; formal per-module licence application remains pending. Fictional-city and aircraft names are descriptive, not a trademark licence.'};
 manifest.entries.push({...entry,bytes:bytes.length,sha256:hash(bytes)});
}
fs.writeFileSync(path.join(root,'desktop/delivery/base-assets/approved-world-templates.json'),JSON.stringify(manifest,null,2)+'\n');
