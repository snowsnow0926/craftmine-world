import {createHash} from 'node:crypto';
import definition from './companion-position-profiles.json' with {type:'json'};
const {profiles}=definition;
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const MAX_SCENE_BYTES=256*1024;
const pinnedScripts=(profile,files)=>profile.rootBinding?.scripts.every(script=>files.get(script.path)?.sha256===script.sha256);
const runtimePinsMatch=(profile,files)=>profile.projectMaterialization?.requirements.every(file=>files.get(file.path)?.sha256===file.sha256);

function projectBindingMatches(profile,files,source){
  const expected=profile.selectors.find(item=>item.path==='project.godot'),file=files.get('project.godot');
  if(file?.sha256===expected?.sha256)return true;
  if(profile.projectMaterialization?.mode!=='append-runtime'||!runtimePinsMatch(profile,files)||!/^[a-z0-9][a-z0-9-]{1,47}$/.test(source?.worldId??'')
    ||typeof file?.text!=='string'||Buffer.byteLength(file.text)>32768||hash(file.text)!==file.sha256)return false;
  // Exact output of materializeBase: no section stripping, normalization or
  // extra setting tolerance. Every stock-prefix byte and suffix byte is bound.
  const suffix='\n[autoload]\nCraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"\n'
    +'\n[craftmine]\nruntime/enabled=true\nruntime/world_id='+JSON.stringify(source.worldId)+'\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n';
  return file.text.endsWith(suffix)&&hash(file.text.slice(0,-suffix.length))===expected.sha256;
}

// Deliberately narrow static grammar. Unsupported/ambiguous roots require
// explicit configuration; this is never a substitute for Godot validation.
function header(line){
  const match=/^\[(gd_scene|ext_resource|sub_resource|node)\s+(.+)\]$/.exec(line);if(!match)return null;
  const attributes={},text=match[2];let offset=0;
  while(offset<text.length){
    const field=/^([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"|[^\s\]]+)(?:\s+|$)/.exec(text.slice(offset));
    if(!field||Object.hasOwn(attributes,field[1]))return null;
    attributes[field[1]]=field[2];offset+=field[0].length;
  }
  return {kind:match[1],attributes};
}
function rootBindingMatches(profile,files){
  const binding=profile.rootBinding,file=files.get(binding?.scene);
  if(!binding||!pinnedScripts(profile,files)||typeof file?.text!=='string'||Buffer.byteLength(file.text)>MAX_SCENE_BYTES||hash(file.text)!==file.sha256)return false;
  const roots=[],resources=new Map(),resourceIds=new Set(),nodeIds=new Set();let sceneHeaders=0,current=null;
  for(const raw of file.text.split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
    if(line.startsWith('[')){
      const section=header(line);if(!section)return false;current=section;
      if(sceneHeaders===0&&section.kind!=='gd_scene')return false;
      if(section.kind==='gd_scene'){if(++sceneHeaders!==1||roots.length||resources.size||section.attributes.format!=='3'||Object.keys(section.attributes).some(key=>!['format','load_steps','uid'].includes(key)))return false;}
      if(section.kind==='ext_resource'||section.kind==='sub_resource'){
        const id=section.attributes.id;if(!/^"[^"\\]+"$/.test(id??''))return false;const key=section.kind+':'+id;
        if(resourceIds.has(key))return false;resourceIds.add(key);
        if(section.kind==='ext_resource')resources.set(id,section.attributes);
      }
      if(section.kind==='node'){
        const {name,parent}=section.attributes;
        if(!/^"[^"\\]+"$/.test(name??'')||(parent!==undefined&&!/^"[^"\\]+"$/.test(parent)))return false;
        const key=JSON.stringify([parent??null,name]);if(nodeIds.has(key))return false;nodeIds.add(key);
        section.properties=new Map();
        if(!Object.hasOwn(section.attributes,'parent'))roots.push(section);
      }
      continue;
    }
    if(!current)return false;
    if(current.kind==='node'){
      const property=/^([A-Za-z_][A-Za-z0-9_/]*)\s*=\s*(.*)$/.exec(line);
      if(property){if(current.properties.has(property[1]))return false;current.properties.set(property[1],property[2]);}
      if(!Object.hasOwn(current.attributes,'parent')&&!property)return false;
    }
  }
  if(sceneHeaders!==1||roots.length!==1)return false;
  const root=roots[0];
  if(Object.keys(root.attributes).sort().join(',')!=='name,type'||root.attributes.name!==JSON.stringify(binding.name)||root.attributes.type!==JSON.stringify(binding.type)||root.properties.size!==1)return false;
  const script=/^ExtResource\(("[^"\\]+")\)$/.exec(root.properties.get('script')??'');
  const resource=script&&resources.get(script[1]);
  return !!resource&&resource.type==='"Script"'&&resource.path===JSON.stringify('res://'+binding.script)
    // Registered stock root resources have no UID. A supplied UID can resolve
    // differently from this path; child-instance resource UIDs are unrelated.
    &&Object.keys(resource).every(key=>['type','path','id'].includes(key));
}

async function enrichCompanionSourceFiles(call,context,worldId,source,files,assertActive=()=>{}){
  // Only known project/script cohorts merit a scene read. Other worlds remain
  // unknown without fetching arbitrary files or searching for similar scripts.
  const readText=async(name,limit)=>{
    const scene=files.get(name);if(!scene||scene.bytes>limit)return;
    let offset=0,text='',pages=0;
    try{
      do{
        if(++pages>32)throw Error('COMPANION_SCENE_READ_LIMIT');
        assertActive();const part=await call('godotProject.read',{context,worldId,revision:source.revision,manifestHash:source.manifestHash,path:name,offset,limit:16000});assertActive();
        if(part.sha256!==scene.sha256||typeof part.text!=='string')throw Error('COMPANION_SCENE_READ_UNVERIFIED');
        text+=part.text;if(Buffer.byteLength(text)>limit)throw Error('COMPANION_SCENE_READ_LIMIT');
        if(part.nextOffset!=null&&(!Number.isSafeInteger(part.nextOffset)||part.nextOffset<=offset||part.nextOffset>limit||!part.text.length))throw Error('COMPANION_SCENE_READ_UNVERIFIED');
        offset=part.nextOffset;
      }while(offset!=null);
      if(hash(text)!==scene.sha256)throw Error('COMPANION_SCENE_READ_UNVERIFIED');
      files.set(name,{...scene,text});
    }catch{assertActive();/* No proof is a configuration-required result. */}
  };
  for(const profile of profiles){
    const binding=profile.rootBinding;if(!binding||!pinnedScripts(profile,files))continue;
    if(!projectBindingMatches(profile,files,source)&&runtimePinsMatch(profile,files))await readText('project.godot',32768);
    if(!projectBindingMatches(profile,files,source))continue;
    const scene=files.get(binding.scene);
    if(scene&&scene.sha256!==profile.selectors.find(item=>item.path===binding.scene)?.sha256)await readText(binding.scene,MAX_SCENE_BYTES);
  }
}
export {rootBindingMatches,enrichCompanionSourceFiles,pinnedScripts,projectBindingMatches};
