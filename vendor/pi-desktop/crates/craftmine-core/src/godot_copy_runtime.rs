//! Fixed source identity transformation for copied managed bases. Gameplay
//! scripts, binary bodies and native progress are never rewritten.
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use crate::{TaskJournal, digest, godot_projects};
use crate::content_history::repo::{ContentFile, RepositoryStore, RepoLayout};

pub(super) fn runtime_ref(world: &str, build: &str) -> String {
    format!("{}{}",crate::content_history::repo::COPIED_RUNTIME_REF_PREFIX,digest(&format!("{world}|{build}")))
}

// Replace a single root JSON string token while preserving all other bytes.
fn json_identity(bytes: &[u8], key: &str, old: &str, new: &str) -> Result<Vec<u8>> {
    let mut expected: Value=serde_json::from_slice(bytes)?;
    ensure!(expected[key]==old,"GODOT_COPY_IDENTITY_MISMATCH: {key}");
    expected[key]=json!(new);
    let mut depth=0i32; let mut i=0; let mut spans=Vec::new();
    while i<bytes.len() {
        match bytes[i] {
            b'{'|b'[' => {depth+=1;i+=1;},
            b'}'|b']' => {depth-=1;i+=1;},
            b'"' => {
                let start=i;i+=1;
                while i<bytes.len() {if bytes[i]==b'\\' {i+=2;} else if bytes[i]==b'"' {i+=1;break;} else {i+=1;}}
                ensure!(i<=bytes.len(),"GODOT_COPY_METADATA_INVALID");
                if depth==1 && serde_json::from_slice::<String>(&bytes[start..i])?==key {
                    let mut at=i;while at<bytes.len()&&bytes[at].is_ascii_whitespace(){at+=1;}
                    if bytes.get(at)==Some(&b':') {
                        at+=1;while at<bytes.len()&&bytes[at].is_ascii_whitespace(){at+=1;}
                        ensure!(bytes.get(at)==Some(&b'"'),"GODOT_COPY_METADATA_INVALID");
                        let begin=at;at+=1;
                        while at<bytes.len(){if bytes[at]==b'\\'{at+=2;}else if bytes[at]==b'"'{at+=1;break;}else{at+=1;}}
                        spans.push((begin,at));
                    }
                }
            },
            _=>i+=1,
        }
    }
    ensure!(spans.len()==1,"GODOT_COPY_METADATA_AMBIGUOUS: {key}");
    let (start,end)=spans[0]; let mut result=bytes[..start].to_vec();
    result.extend(serde_json::to_vec(new)?);result.extend(&bytes[end..]);
    ensure!(serde_json::from_slice::<Value>(&result)?==expected,"GODOT_COPY_METADATA_INVALID");
    Ok(result)
}

fn transform(files: &mut BTreeMap<String,Vec<u8>>, base: &str, old: &str, new: &str) -> Result<()> {
    let source=files.get("project.godot").context("GODOT_COPY_CONFIG_REQUIRED")?;
    let text=std::str::from_utf8(source)?;
    let mut section="";let mut result=String::new();let mut count=0;
    for line in text.split_inclusive('\n') {
        let trimmed=line.trim();
        if trimmed.starts_with('[')&&trimmed.ends_with(']'){section=trimmed;}
        if section=="[craftmine]" {
            if let Some((key,value))=line.split_once('=') {
                if key.trim()=="runtime/world_id" {
                    let token=value.trim();
                    ensure!(serde_json::from_str::<String>(token)?==old,"GODOT_COPY_IDENTITY_MISMATCH: project.godot");
                    let start=value.find(token).context("GODOT_COPY_CONFIG_UNSUPPORTED")?;
                    result.push_str(key);result.push('=');result.push_str(&value[..start]);
                    result.push_str(&serde_json::to_string(new)?);result.push_str(&value[start+token.len()..]);count+=1;continue;
                }
            }
        }
        result.push_str(line);
    }
    ensure!(count==1,"GODOT_COPY_CONFIG_UNSUPPORTED");
    files.insert("project.godot".into(),result.into_bytes());
    match base {
        "first-person"=>{},
        "creation-sandbox"=>{
            // Copied history reserves the same object IDs and records origin;
            // it must not retain a foreign world binding that blocks all edits.
            if let Some(bytes)=files.get("world/creation-operations.json") {
                let mut journal:Value=serde_json::from_slice(bytes)?;
                ensure!(journal["format"]=="craftmine.creation-operations/1","GODOT_COPY_CREATION_JOURNAL_INVALID");
                let operations=journal["operations"].as_array_mut().context("GODOT_COPY_CREATION_JOURNAL_INVALID")?;
                ensure!(operations.len()<=4096,"GODOT_COPY_CREATION_JOURNAL_INVALID");
                for entry in operations {
                    ensure!(entry["receipt"]["worldId"]==old,"GODOT_COPY_CREATION_JOURNAL_INVALID");
                    if entry["receipt"].get("originWorldId").is_none(){entry["receipt"]["originWorldId"]=json!(old);}
                    entry["receipt"]["worldId"]=json!(new);
                }
                files.insert("world/creation-operations.json".into(),serde_json::to_vec_pretty(&journal)?);
            }
        },
        "top-down"|"mining-sandbox"=>{
            // Only the shipped root metadata schema grants an identity edit.
            let value:Value=serde_json::from_slice(files.get("world.json").context("GODOT_COPY_METADATA_REQUIRED")?)?;
            let format=if base=="mining-sandbox" {"craftmine.godot-mining-sandbox-world/1"} else {"craftmine.godot-topdown-world/1"};
            ensure!(value["format"]==format,"GODOT_COPY_METADATA_UNSUPPORTED");
            if base=="mining-sandbox" {ensure!(value["baseId"]==base,"GODOT_COPY_METADATA_UNSUPPORTED");}
            let bytes=files.get("world.json").unwrap();
            files.insert("world.json".into(),json_identity(bytes,"worldId",old,new)?);
        },
        "side-view"=>{
            let pointer:Value=serde_json::from_slice(files.get("worlds/default.json").context("GODOT_COPY_METADATA_REQUIRED")?)?;
            ensure!(pointer["format"]=="craftmine.godot-sideview-default/1","GODOT_COPY_METADATA_UNSUPPORTED");
            let template=pointer["worldId"].as_str().context("GODOT_COPY_METADATA_INVALID")?;
            ensure!(!template.is_empty()&&template.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'_'|b'-')),"GODOT_COPY_METADATA_INVALID");
            let path=format!("worlds/{template}/world.json");
            let data:Value=serde_json::from_slice(files.get(&path).context("GODOT_COPY_METADATA_REQUIRED")?)?;
            ensure!(data["format"]=="craftmine.godot-sideview-world/1","GODOT_COPY_METADATA_UNSUPPORTED");
            for (path,key) in [("worlds/default.json","instanceId"),(path.as_str(),"worldId")] {
                let value=files.get(path).context("GODOT_COPY_METADATA_REQUIRED")?;
                files.insert(path.into(),json_identity(value,key,old,new)?);
            }
        },
        _=>anyhow::bail!("GODOT_COPY_BASE_UNSUPPORTED"),
    }
    if let Some(bytes)=files.get("MATERIALIZED.json") {
        let value:Value=serde_json::from_slice(bytes)?;
        ensure!(value["format"]=="craftmine.godot-sideview-materialize/1","GODOT_COPY_METADATA_UNSUPPORTED");
        let bytes=json_identity(bytes,"worldId",old,new)?;
        files.insert("MATERIALIZED.json".into(),json_identity(&bytes,"instanceId",old,new)?);
    }
    // The product initializer excludes this outer materialization manifest.
    // Do not silently retain or invent hashes for a foreign authored manifest.
    ensure!(!files.contains_key("managed-base.json"),"GODOT_COPY_OUTER_MANIFEST_UNSUPPORTED");
    Ok(())
}

impl TaskJournal {
    fn copy_runtime_expected(&self, world:&str, metadata:&Value, parent:&str, store:&RepositoryStore, layout:&RepoLayout)->Result<(Vec<ContentFile>,Value)> {
        let old=metadata["copiedFromWorldId"].as_str().context("GODOT_COPY_NOT_REQUIRED")?;
        let mut files=BTreeMap::new();
        for entry in store.tree_entries(layout,parent)? {
            ensure!(entry.mode=="100644","GODOT_COPY_SOURCE_MODE_UNSUPPORTED");
            files.insert(entry.path.clone(),store.read_file(layout,parent,&entry.path)?);
        }
        let original=files.clone();
        transform(&mut files,metadata["baseId"].as_str().context("INVALID_GODOT_BASE")?,old,world)?;
        let changed:Vec<Value>=files.iter().filter(|(p,b)|original.get(*p)!=Some(*b)).map(|(path,bytes)|json!({"path":path,
            "beforeSha256":godot_projects::digest_bytes(&original[path]),"sha256":godot_projects::digest_bytes(bytes),"bytes":bytes.len()})).collect();
        let proof=json!({"format":"craftmine.godot-copy-transform/1","worldId":world,"sourceWorldId":old,
            "sourceParentOid":parent,"changedFiles":changed});
        Ok((files.into_iter().map(|(path,bytes)|ContentFile{path,bytes}).collect(),proof))
    }

    pub(super) fn verified_copy_runtime(&self, world:&str, metadata:&Value, parent:&str)->Result<Option<Value>> {
        let (store,layout)=self.content_layout(world)?;
        let reference=runtime_ref(world,metadata["buildId"].as_str().context("INVALID_GODOT_BUILD")?);
        let Some(commit)=store.git().ref_value(&layout.git_dir,&reference)? else{return Ok(None)};
        if commit==parent{return Ok(None)} // interrupted before the atomic child ref update
        let (files,proof)=self.copy_runtime_expected(world,metadata,parent,&store,&layout)?;
        let history=store.history(&layout,&commit,0,1)?;
        ensure!(history.records.first().is_some_and(|r|r.parents==[parent]),"GODOT_COPY_TRANSFORM_PARENT_MISMATCH");
        ensure!(store.tree_entries(&layout,&commit)?.len()==files.len(),"GODOT_COPY_TRANSFORM_MISMATCH");
        for file in files {ensure!(store.read_file(&layout,&commit,&file.path)?==file.bytes,"GODOT_COPY_TRANSFORM_MISMATCH: {}",file.path);}
        Ok(Some(json!({"worldId":world,"contentOid":commit,"sourceParentOid":parent,"transformHash":digest(&serde_json::to_string(&proof)?),"proof":proof})))
    }

    fn bind_copy_draft(&self,world:&str,metadata:&Value,formal_parent:&str,formal_child:&str)->Result<Value> {
        let (store,layout)=self.content_layout(world)?;
        let head=store.branch_head(&layout,"main")?.context("CONTENT_BRANCH_NOT_FOUND")?;
        if head==formal_parent {
            store.git().update_ref(&layout.git_dir,"refs/heads/main",formal_child,Some(&head))?;
            return Ok(json!({"sourceParentOid":head,"contentOid":formal_child,"usesFormalTransform":true}));
        }
        let planned=self.copy_runtime_expected(world,metadata,&head,&store,&layout);
        let (files,proof)=match planned {
            Ok(value)=>value,
            Err(error)=>{
                // Repeated preparation or later authoring may already carry the
                // target identity. Validate every fixed identity field without
                // rewriting a target-bound user draft or hiding mixed identities.
                let mut target_metadata=metadata.clone();target_metadata["copiedFromWorldId"]=json!(world);
                self.copy_runtime_expected(world,&target_metadata,&head,&store,&layout)
                    .with_context(||format!("GODOT_COPY_DRAFT_IDENTITY_REBIND_REQUIRED: {error}"))?;
                return Ok(json!({"contentOid":head,"alreadyBound":true}));
            }
        };
        let message=crate::content_history::repo::commit_message("copy-draft-identity","native-copy",
            "Bind copied draft identity without applying its content",&format!("draft parent {head}; target {world}"))?;
        let child=store.commit_ref(&layout,"refs/heads/main",Some(&head),&files,&message)?;
        Ok(json!({"sourceParentOid":head,"contentOid":child,"transformHash":digest(&serde_json::to_string(&proof)?),"proof":proof}))
    }

    pub fn godot_world_prepare_copy_runtime(&self,args:&Value)->Result<Value> {
        let _lock=crate::operation_lock::OperationLock::domain(&self.directory)?;
        ensure!(args.as_object().is_some_and(|o|o.len()==1),"INVALID_GODOT_COPY_ARGS");
        let world=args["worldId"].as_str().context("INVALID_WORLD_ID")?;
        let metadata=self.runtime_describe_impl(args,false)?;
        if metadata["copiedFromWorldId"].is_null(){return Ok(json!({"worldId":world,"copied":false}));}
        let build=metadata["buildId"].as_str().context("INVALID_GODOT_BUILD")?;
        let (store,layout)=self.content_layout(world)?;
        let parent=store.git().ref_value(&layout.git_dir,&crate::godot_worlds::copied_formal_ref(world,build))?.context("GODOT_REBUILD_SOURCE_TRANSFER_REQUIRED")?;
        self.verify_copied_formal_source(metadata["copiedFromWorldId"].as_str().unwrap(),build,&store,&layout,&parent)?;
        let mut result=if let Some(mut value)=self.verified_copy_runtime(world,&metadata,&parent)? {
            value["replayed"]=json!(true);value
        } else {
            let (files,_)=self.copy_runtime_expected(world,&metadata,&parent,&store,&layout)?;
            let reference=runtime_ref(world,build);
            if store.git().ref_value(&layout.git_dir,&reference)?.is_none(){store.git().update_ref(&layout.git_dir,&reference,&parent,None)?;}
            let message=crate::content_history::repo::commit_message("copy-runtime","native-copy","Bind copied runtime identity",&format!("source parent {parent}; target {world}"))?;
            store.commit_ref(&layout,&reference,Some(&parent),&files,&message)?;
            let mut value=self.verified_copy_runtime(world,&metadata,&parent)?.context("GODOT_COPY_TRANSFORM_MISSING")?;
            value["replayed"]=json!(false);value
        };
        result["worldId"]=json!(world);result["copied"]=json!(true);
        result["draftTransform"]=self.bind_copy_draft(world,&metadata,&parent,result["contentOid"].as_str().unwrap())?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_rebinding_preserves_every_other_byte_in_four_bases() -> Result<()> {
        for base in ["first-person","top-down","side-view","mining-sandbox","creation-sandbox"] {
            let config=b"config_version=5\r\n[craftmine]\r\nruntime/world_id=\"source\"\r\nruntime/enabled=true\r\n";
            let mut files=BTreeMap::from([("project.godot".into(),config.to_vec()),
                ("script.gd".into(),b"# source must remain source\n".to_vec()),
                ("art.png".into(),vec![137,80,78,71,0,255])]);
            if base=="top-down" {files.insert("world.json".into(),br#"{ "format":"craftmine.godot-topdown-world/1", "worldId" : "source", "quest":{"worldId":"source"} }"#.to_vec());}
            if base=="mining-sandbox" {files.insert("world.json".into(),br#"{ "format":"craftmine.godot-mining-sandbox-world/1", "baseId":"mining-sandbox", "worldId" : "source", "entities":[{"id":"source"}], "notes":"source" }"#.to_vec());}
            if base=="side-view" {
                files.insert("worlds/default.json".into(),br#"{"format":"craftmine.godot-sideview-default/1","worldId":"ruins","instanceId":"source"}"#.to_vec());
                files.insert("worlds/ruins/world.json".into(),br#"{"format":"craftmine.godot-sideview-world/1","worldId":"source","rooms":[{"id":"source"}]}"#.to_vec());
                files.insert("MATERIALIZED.json".into(),br#"{"format":"craftmine.godot-sideview-materialize/1","worldId":"source","instanceId":"source","templateId":"ruins"}"#.to_vec());
            }
            let original=files.clone();transform(&mut files,base,"source","target")?;
            assert_eq!(files["script.gd"],original["script.gd"]);assert_eq!(files["art.png"],original["art.png"]);
            assert_eq!(std::str::from_utf8(&files["project.godot"])?,std::str::from_utf8(config)?.replace("world_id=\"source\"","world_id=\"target\""));
            if base=="top-down" {assert_eq!(files["world.json"],br#"{ "format":"craftmine.godot-topdown-world/1", "worldId" : "target", "quest":{"worldId":"source"} }"#);}
            if base=="mining-sandbox" {assert_eq!(files["world.json"],br#"{ "format":"craftmine.godot-mining-sandbox-world/1", "baseId":"mining-sandbox", "worldId" : "target", "entities":[{"id":"source"}], "notes":"source" }"#);}
            if base=="side-view" {
                let pointer:Value=serde_json::from_slice(&files["worlds/default.json"])?;
                assert_eq!(pointer["worldId"],"ruins");assert_eq!(pointer["instanceId"],"target");
                assert!(std::str::from_utf8(&files["worlds/ruins/world.json"])?.contains("\"id\":\"source\""));
            }
        }
        assert!(json_identity(br#"{"worldId":"source","worldId":"source"}"#,"worldId","source","target").is_err());
        assert!(json_identity(br#"{"worldId":"foreign"}"#,"worldId","source","target").is_err());
        Ok(())
    }
}
