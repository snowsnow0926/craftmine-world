//! Creation observation is a product-owned sampling boundary. The authored
//! scene remains writable, while the sampler and its transport must be exact.
use anyhow::{ensure, Result};
use serde_json::json;
use super::{digest,godot_projects::Manifest};

pub(super) fn files()->Vec<(&'static str,String)>{vec![
 ("craftmine_shared/base_adapter.gd",include_str!("../../../../../desktop/godot/shared/adapters/creation-sandbox.gd").replace("\r\n","\n")),
 ("craftmine_shared/runtime_bridge.gd",include_str!("../../../../../desktop/godot/shared/runtime_bridge.gd").replace("\r\n","\n")),
 ("craftmine_shared/state_guard.gd",include_str!("../../../../../desktop/godot/shared/state_guard.gd").replace("\r\n","\n")),
 ("craftmine_shared/headless_play_action.gd",include_str!("../../../../../desktop/godot/shared/headless_play_action.gd").replace("\r\n","\n")),
 ("craftmine_shared/scene_mesh_picker.gd",include_str!("../../../../../desktop/godot/shared/scene_mesh_picker.gd").replace("\r\n","\n")),
]}
pub(super) fn hash()->String {digest(&serde_json::to_string(&files().iter().map(|(path,text)|json!({"path":path,"sha256":digest(text)})).collect::<Vec<_>>()).unwrap())}
pub(super) const CONTROLLER_PROFILE:&str="creation-fixed-controller/1";
pub(super) fn controller_files()->Vec<(&'static str,String)>{
 let mut profile=files();profile.retain(|(path,_)|*path!="craftmine_shared/base_adapter.gd");
 profile.extend([
  ("craftmine_shared/base_adapter.gd",include_str!("../../../../../desktop/godot/shared/adapters/creation-sandbox-controller-v1.gd").replace("\r\n","\n")),
  ("craftmine_shared/base_adapter_legacy.gd",include_str!("../../../../../desktop/godot/shared/adapters/creation-sandbox.gd").replace("\r\n","\n")),
  ("craftmine_shared/controller_evidence.gd",include_str!("../../../../../desktop/godot/shared/controller_evidence.gd").replace("\r\n","\n")),
  ("craftmine_shared/scene_mesh_picker_v2.gd",include_str!("../../../../../desktop/godot/shared/scene_mesh_picker_v2.gd").replace("\r\n","\n")),
 ]);profile
}
pub(super) fn controller_hash()->String {digest(&serde_json::to_string(&controller_files().iter().map(|(path,text)|json!({"path":path,"sha256":digest(text)})).collect::<Vec<_>>()).unwrap())}
pub(super) fn validate_controller_manifest(manifest:&Manifest)->Result<()> {
 for(path,text)in controller_files(){
  let entry=manifest.files.get(path).ok_or_else(||anyhow::anyhow!("CREATION_CONTROLLER_PROBE_UNSUPPORTED: {path}"))?;
  ensure!([digest(&text),digest(&text.replace('\n',"\r\n"))].contains(&entry.sha256),"CREATION_CONTROLLER_PROBE_UNSUPPORTED: {path}");
  ensure!(!manifest.files.keys().any(|p|p!=path&&(p.eq_ignore_ascii_case(path)||p.to_ascii_lowercase().starts_with(&(path.to_owned()+".")))),"CREATION_CONTROLLER_PROBE_ALIAS: {path}");
 }Ok(())
}
// Extra requirements apply only to newly opted-in fixed-controller passage
// checks. Unsupported custom controllers remain untouched and can still use
// legacy checks; they need a separate future physical-action contract.
pub(super) fn passage_files()->Vec<(&'static str,String)>{vec![
 ("scripts/reused/player_controller.gd",include_str!("../../../../../desktop/godot/bases/creation-sandbox/scripts/reused/player_controller.gd").replace("\r\n","\n")),
 ("scripts/reused/camera_rig.gd",include_str!("../../../../../desktop/godot/bases/creation-sandbox/scripts/reused/camera_rig.gd").replace("\r\n","\n")),
]}
pub(super) fn validate_passage_manifest(manifest:&Manifest)->Result<()> {
 for(path,text)in passage_files(){
  let expected=[digest(&text),digest(&text.replace('\n',"\r\n"))];
  let entry=manifest.files.get(path).ok_or_else(||anyhow::anyhow!("CREATION_PASSAGE_CONTROLLER_UNSUPPORTED: {path}"))?;
  ensure!(expected.contains(&entry.sha256),"CREATION_PASSAGE_CONTROLLER_UNSUPPORTED: {path}");
  ensure!(!manifest.files.keys().any(|p|p!=path&&(p.eq_ignore_ascii_case(path)||p.to_ascii_lowercase().starts_with(&(path.to_owned()+".")))),"CREATION_PASSAGE_CONTROLLER_ALIAS_UNSUPPORTED: {path}");
 }
 Ok(())
}
pub(super) fn validate_manifest(manifest:&Manifest)->Result<()> {
 let wrapper=controller_files().into_iter().find(|(path,_)|*path=="craftmine_shared/base_adapter.gd").unwrap().1;
 if manifest.files.get("craftmine_shared/base_adapter.gd").is_some_and(|entry|[digest(&wrapper),digest(&wrapper.replace('\n',"\r\n"))].contains(&entry.sha256)) {return validate_controller_manifest(manifest);}
 ensure!(!manifest.files.keys().any(|p|["craftmine_shared/base_adapter_legacy.gd","craftmine_shared/controller_evidence.gd","craftmine_shared/scene_mesh_picker_v2.gd"].iter().any(|name|p.eq_ignore_ascii_case(name)||p.to_ascii_lowercase().starts_with(&format!("{name}.")))),"CREATION_CONTROLLER_PROFILE_MIXED");
 for (path,text) in files(){
  let expected=[digest(&text),digest(&text.replace('\n',"\r\n"))];
  let entry=manifest.files.get(path).ok_or_else(||anyhow::anyhow!("CREATION_PROBE_SOURCE_MISSING: {path}"))?;
  ensure!(expected.contains(&entry.sha256),"CREATION_PROBE_SOURCE_MISMATCH: {path}");
  ensure!(!manifest.files.keys().any(|p|p!=path&&(p.eq_ignore_ascii_case(path)||p.to_ascii_lowercase().starts_with(&(path.to_owned()+".")))),"CREATION_PROBE_RESOURCE_ALIAS: {path}");
 }
 Ok(())
}
pub(super) fn validate_project(bytes:&[u8])->Result<()> {
 let text=std::str::from_utf8(bytes)?;let mut section="";let mut adapter=0;let mut bridge=0;
 for raw in text.lines(){let line=raw.trim();if line.starts_with(';')||line.starts_with('#')||line.is_empty(){continue;}
  if line.starts_with('[')&&line.ends_with(']'){ensure!(line[1..line.len()-1].bytes().all(|c|c.is_ascii_alphanumeric()||b"_-/".contains(&c)),"CREATION_PROBE_ENTRY_MISMATCH");section=line;continue;}
  let Some((key,value))=line.split_once('=')else{continue;};let key=key.trim();let value=value.trim();
  if section=="[autoload]"||section=="[craftmine]"{ensure!(!key.contains('"')&&!key.contains('\\'),"CREATION_PROBE_ENTRY_MISMATCH");}
  if section=="[autoload]"&&key=="CraftmineRuntime"{bridge+=1;ensure!(value=="\"*res://craftmine_shared/runtime_bridge.gd\"","CREATION_PROBE_ENTRY_MISMATCH");}
  if section=="[craftmine]"&&key=="runtime/adapter"{adapter+=1;ensure!(value=="\"res://craftmine_shared/base_adapter.gd\"","CREATION_PROBE_ENTRY_MISMATCH");}
 }
 ensure!(bridge==1&&adapter==1,"CREATION_PROBE_ENTRY_MISMATCH");Ok(())
}

#[cfg(test)]mod tests{
 use super::*;use super::super::godot_projects::FileEntry;use std::collections::BTreeMap;
 #[test]fn controller_cohort_keeps_legacy_and_rejects_missing_changed_or_mixed_resources(){
  let mut entries:BTreeMap<String,FileEntry>=BTreeMap::new();
  for(path,text)in controller_files(){entries.insert(path.into(),FileEntry{bytes:text.len()as u64,sha256:digest(&text)});}
  let value=json!({"format":"craftmine.godot-project/1","worldId":"world","baseBuild":"base","baseId":"creation-sandbox","engineVersion":"4.7.2-stable","language":"gdscript","renderer":"gl_compatibility","target":"web","revision":1,"task":{"projectId":"project","sessionId":"session","turnId":"turn","taskId":"task","baseBuild":"base"},"files":entries});
  let mut manifest:Manifest=serde_json::from_value(value).unwrap();assert!(validate_manifest(&manifest).is_ok());
  for(path,_)in controller_files(){
   let old=manifest.files.remove(path).unwrap();assert!(validate_manifest(&manifest).is_err(),"missing {path}");manifest.files.insert(path.into(),old.clone());
   manifest.files.get_mut(path).unwrap().sha256=digest("changed");assert!(validate_manifest(&manifest).is_err(),"changed {path}");manifest.files.insert(path.into(),old);
  }
  for(path,text)in files(){manifest.files.insert(path.into(),FileEntry{bytes:text.len()as u64,sha256:digest(&text)});}
  assert!(validate_manifest(&manifest).is_err());
  manifest.files.retain(|path,_|files().iter().any(|(name,_)|*name==path));assert!(validate_manifest(&manifest).is_ok());assert!(validate_controller_manifest(&manifest).is_err());
 }
 #[test]fn probe_transport_and_selector_are_pinned(){
  let project=b"config_version=5\n[autoload]\nCraftmineRuntime=\"*res://craftmine_shared/runtime_bridge.gd\"\n[craftmine]\nruntime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n";
  assert!(validate_project(project).is_ok());assert!(validate_project(&String::from_utf8_lossy(project).replace("base_adapter.gd","forged.gd").into_bytes()).is_err());
  assert!(validate_project(&[project.as_slice(),b"runtime/adapter=\"res://craftmine_shared/base_adapter.gd\"\n"].concat()).is_err());
  let mut entries:BTreeMap<String,FileEntry>=BTreeMap::new();for(path,text)in files(){entries.insert(path.into(),FileEntry{bytes:text.len() as u64,sha256:digest(&text)});}
  // JSON construction keeps this test independent of TaskBinding constructors.
  let value=json!({"format":"craftmine.godot-project/1","worldId":"world","baseBuild":"base","baseId":"creation-sandbox","engineVersion":"4.7.2-stable","language":"gdscript","renderer":"gl_compatibility","target":"web","revision":1,"task":{"projectId":"project","sessionId":"session","turnId":"turn","taskId":"task","baseBuild":"base"},"files":entries});
  let mut manifest:Manifest=serde_json::from_value(value).unwrap();assert!(validate_manifest(&manifest).is_ok());
  for(path,_)in files(){let old=manifest.files[path].clone();manifest.files.get_mut(path).unwrap().sha256=digest("forged observer");assert!(validate_manifest(&manifest).is_err());manifest.files.insert(path.into(),old);}
  manifest.files.insert("craftmine_shared/base_adapter.gd.remap".into(),FileEntry{bytes:1,sha256:digest("x")});assert!(validate_manifest(&manifest).is_err());
 }
}
