import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractCityFragment,sha} from './lib/city-fragments.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),original=path.join(root,'desktop/godot/shared/promo-templates/promo-city/source');
export const CITY_FRAGMENT_PROFILES=[
 {slug:'ward-building',id:'cw.city.ward-building',label:'峡谷城红顶民居',kind:'object',anchor:[-23,0,-52],buildings:1,tags:['建筑','房屋','民居','红顶','building','house'],aliases:['奥格瑞玛建筑','兽人房屋','enterable ward house'],capabilities:['enterable-building','static-triangle-collision','independent-placement'],parts:[{file:'orgrimmar-wards.glb',nodePattern:'^(Detail|Solid)_LowerWard_0_',boxes:[{min:[-31.5,-.1,-60.5],max:[-14.5,12,-43.5]}]}],ground:{included:false},route:{kind:'enter-building',start:[4,0,7],end:[0,0,0]}},
 {slug:'gate-section',id:'cw.city.gate-section',label:'峡谷城双塔城门',kind:'object',anchor:[0,0,-36],buildings:0,tags:['城门','城墙','双塔','入口','gate','wall'],aliases:['奥格瑞玛城门','兽人城门','twin tower gate'],capabilities:['walk-through-gate','static-triangle-collision','independent-placement'],parts:[{file:'orgrimmar-city.glb',nodePattern:'^(Detail|Solid)_Gate_',clip:true,boxes:[{min:[-24,-.1,-48],max:[24,24,-28]}]}],ground:{included:false},route:{kind:'gate-passage',start:[0,0,9],end:[0,0,-10]}},
 {slug:'ward-street',id:'cw.city.ward-street',label:'峡谷城双屋街区',kind:'scene',anchor:[-23,0,-63],buildings:2,tags:['街区','街道','建筑群','street','block'],aliases:['奥格瑞玛街区','兽人街道','two house street'],capabilities:['two-enterable-buildings','walkable-street','included-ground','static-triangle-collision','independent-placement'],parts:[{file:'orgrimmar-wards.glb',nodePattern:'^(Detail|Solid)_LowerWard_0_',boxes:[{min:[-31.5,-.1,-60.5],max:[-14.5,12,-43.5]},{min:[-32.5,-.1,-81.5],max:[-15.5,12,-64.5]}]},{file:'orgrimmar-city.glb',nodePattern:'^Solid_ValleyStrength_sand$',clip:true,boxes:[{min:[-35,-.01,-85],max:[-8,.01,-41]}]}],ground:{included:true},route:{kind:'street-traverse',start:[12,0,20],end:[12,0,-20]}},
];
const NAVIGATION={
 'ward-building':[{id:'house-entry',kind:'approach-to-interior',approachMm:[4000,0,7000],interiorMm:[0,0,0]}],
 'gate-section':[{id:'gate-passage',kind:'through-passage',approachMm:[0,0,9000],interiorMm:[0,0,-10000]}],
 'ward-street':[{id:'street-traverse',kind:'street-traverse',approachMm:[12000,20,20000],interiorMm:[12000,20,-20000]},
  {id:'first-house-entry',kind:'approach-to-interior',approachMm:[4000,20,17928],interiorMm:[0,20,11000],entryAngleDegrees:60},
  {id:'second-house-entry',kind:'approach-to-interior',approachMm:[5928,20,-6000],interiorMm:[-1000,20,-10000],entryAngleDegrees:30}],
};
const wrapper=`extends Node3D

@export var entity_id: String = ""
const Surface = preload("res://addons/ASSET_ID/city_surface.gdshader")
var collision_triangles := 0
var mesh_count := 0

func _ready() -> void:
\t_prepare_geometry($Geometry)

func _prepare_geometry(node: Node) -> void:
\tif node is MeshInstance3D:
\t\tvar mesh_node := node as MeshInstance3D
\t\tmesh_count += 1
\t\tif str(node.name).begins_with("Solid_") or str(node.name).begins_with("HiddenSolid_"):
\t\t\tvar shape := ConcavePolygonShape3D.new()
\t\t\tvar faces := mesh_node.mesh.get_faces()
\t\t\tshape.set_faces(faces)
\t\t\tshape.backface_collision = true
\t\t\tcollision_triangles += faces.size() / 3
\t\t\tvar body := StaticBody3D.new()
\t\t\tbody.name = "FragmentCollision"
\t\t\tbody.collision_layer = 1
\t\t\tbody.collision_mask = 0
\t\t\tvar collision := CollisionShape3D.new()
\t\t\tcollision.shape = shape
\t\t\tbody.add_child(collision)
\t\t\tmesh_node.add_child(body)
\t\tif str(node.name).begins_with("HiddenSolid_"):
\t\t\tmesh_node.visible = false
\t\telif DisplayServer.get_name() != "headless":
\t\t\tfor index in range(mesh_node.mesh.get_surface_count()):
\t\t\t\tvar original_material := mesh_node.mesh.surface_get_material(index) as StandardMaterial3D
\t\t\t\tif original_material == null:
\t\t\t\t\tcontinue
\t\t\t\tvar material := ShaderMaterial.new()
\t\t\t\tmaterial.shader = Surface
\t\t\t\tmaterial.set_shader_parameter("base_color", original_material.albedo_color)
\t\t\t\tvar key := original_material.resource_name
\t\t\t\tvar kind := 0.0
\t\t\t\tif key.begins_with("wood") or key == "trunk": kind = 1.0
\t\t\t\telif key.begins_with("red"): kind = 2.0
\t\t\t\telif key in ["iron", "edge", "gold"]: kind = 3.0
\t\t\t\telif key.begins_with("palm"): kind = 4.0
\t\t\t\telif key in ["fire", "heart"]: kind = 5.0
\t\t\t\telif key in ["water", "foam"]: kind = 6.0
\t\t\t\tmaterial.set_shader_parameter("kind", kind)
\t\t\t\tmesh_node.set_surface_override_material(index, material)
\tfor child in node.get_children():
\t\t_prepare_geometry(child)
`;
export function buildCityFragments({output=path.join(root,'desktop/godot/components/city-fragments'),includePreviews=true}={}){
 const sources=Object.fromEntries(['orgrimmar-city.glb','orgrimmar-wards.glb'].map(file=>[file,fs.readFileSync(path.join(original,'assets/blender',file))]));
 const inventory={format:'craftmine.city-fragments/1',sourceWorld:'promo-orgrimmar',entries:[]};
 for(const profile of CITY_FRAGMENT_PROFILES){
  const {bytes,stats}=extractCityFragment({sources,parts:profile.parts,anchor:profile.anchor});
  if(stats.boundaryTrianglesExcluded)throw Error(profile.slug+': selection cuts a building or gate triangle: '+stats.boundaryTrianglesExcluded);
  const directory=path.join(output,profile.slug);fs.mkdirSync(directory,{recursive:true});
  const provenance={format:'craftmine.city-fragment-provenance/1',sourceWorld:'promo-orgrimmar',sourceTemplate:'desktop/godot/shared/promo-templates/promo-city/source',sources:stats.parts,derivation:'Existing static triangle/material subset, translated to a local ground anchor; gate wall ends and street ground triangles clipped to declared rectangles. No new AI model or Blender modeling run.',originalsModified:false,licenseStatus:'unverified',sourceLicenseFile:'ORIGINAL_ASSETS_LICENSE.txt',sourceLicenseClaim:'MIT source declaration; generated city/reference rights have not been independently verified'};
  let activeWrapper=wrapper.replaceAll('ASSET_ID',profile.id);
  if(profile.slug==='ward-street'){
   activeWrapper=activeWrapper.replace('\t\tmesh_count += 1','\t\tmesh_count += 1\n\t\t# Keep this included surface and its child collider above a normal Y=0 receiving floor.\n\t\tif str(node.name) == "Solid_ValleyStrength_sand":\n\t\t\tmesh_node.position.y += 0.02');
   provenance.includedGroundTransform={node:'Solid_ValleyStrength_sand',translationMm:[0,20,0],scope:'instance mesh and matching child collider; approved and derived GLB bytes unchanged'};
  }
  const files={'geometry.glb':bytes,'geometry.glb.import':Buffer.from('[remap]\nimporter="scene"\ntype="PackedScene"\n\n[params]\nmeshes/generate_lods=false\n'),'fragment.gd':Buffer.from(activeWrapper),'fragment.gd.uid':Buffer.from('uid://b'+sha(profile.id).slice(0,11)+'\n'),'city_surface.gdshader':fs.readFileSync(path.join(original,'shaders/city_surface.gdshader')),'ORIGINAL_ASSETS_LICENSE.txt':fs.readFileSync(path.join(original,'licenses/ORIGINAL_ASSETS_LICENSE.txt')),'provenance.json':Buffer.from(JSON.stringify(provenance,null,2)+'\n'),'fragment.tscn':Buffer.from(`[gd_scene load_steps=3 format=3]\n[ext_resource type="Script" path="res://addons/${profile.id}/fragment.gd" id="script"]\n[ext_resource type="PackedScene" path="res://addons/${profile.id}/geometry.glb" id="geometry"]\n[node name="CityFragment" type="Node3D"]\nscript = ExtResource("script")\n[node name="Geometry" parent="." instance=ExtResource("geometry")]\n`)};
  const manifest={format:'craftmine.city-fragment/1',...profile,version:1,geometry:{...stats,bytes:bytes.length,sha256:sha(bytes),dimensionsMm:stats.bounds.max.map((n,i)=>Math.ceil((n-stats.bounds.min[i])*1000))},source:provenance,files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)}))};
  manifest.navigation={coordinates:'component-local-millimetres',meaning:'measured walk approach and interior/passage waypoints, not exact doorway frame centers',actorRadiusMm:300,actorHeightMm:1800,routes:NAVIGATION[profile.slug]};
  if(profile.slug==='ward-street')manifest.ground={included:true,surfaceClearanceMm:20,colliderMatchesSurface:true,adoption:'Keep the current player outside the raised ground footprint until adoption; use ordinary walking, never rewrite saved pose.'};
  const previewRoot=path.join(root,'desktop/godot/components/city-fragments/previews'),previewFile=path.join(previewRoot,'manifest.json');
  if(includePreviews&&fs.existsSync(previewFile)){
   const preview=JSON.parse(fs.readFileSync(previewFile)).entries.find(item=>item.slug===profile.slug),png=preview?fs.readFileSync(path.join(previewRoot,preview.file)):null;
   if(!preview||preview.geometrySha256!==sha(bytes)||preview.wrapperSha256!==sha(files['fragment.gd'])||preview.shaderSha256!==sha(files['city_surface.gdshader'])||sha(png)!==preview.sha256)throw Error('CITY_FRAGMENT_PREVIEW_SOURCE_CHANGED');
   files['preview.png']=png;manifest.files.push({path:'preview.png',bytes:png.length,sha256:sha(png)});manifest.preview={...preview,file:'preview.png'};
  }
  if(manifest.files.reduce((sum,file)=>sum+file.bytes,0)>4*1024*1024)throw Error('CITY_FRAGMENT_TOO_LARGE');
  for(const [name,body]of Object.entries(files))fs.writeFileSync(path.join(directory,name),body);fs.writeFileSync(path.join(directory,'component.json'),JSON.stringify(manifest,null,2)+'\n');inventory.entries.push({slug:profile.slug,id:profile.id,componentSha256:sha(fs.readFileSync(path.join(directory,'component.json')))});
 }
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(inventory,null,2)+'\n');return inventory;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildCityFragments(),null,2));
