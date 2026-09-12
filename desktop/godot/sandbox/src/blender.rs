//! Separate-process Blender integration. The compiled official inventory and
//! bridge are authoritative; callers cannot select Python, executables or CLI.
use crate::{broker::{SourceBinding, SourceFile, Cleanup, JournalState, file_digest, snapshot},
    task::{Task, TaskKind, TaskBudget, EnginePins, PinnedInput, TaskState}, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, io::Read, path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicBool, Ordering}}};

const LOCK: &str = include_str!("../../../blender/toolchain.lock.json");
const DRIVER: &str = include_str!("../../../blender/bridge/driver.py");

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RuntimeFile { pub path: String, pub bytes: u64, pub sha256: String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct RuntimeLock { format: String, runtime_version: String, executable: String, files: Vec<RuntimeFile> }

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32, pub request_id: String, pub task_id: String,
    pub operation: String, pub project_root: PathBuf, pub tasks_root: PathBuf,
    pub runtime_root: PathBuf, pub source_binding: SourceBinding, pub input_hash: String,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Response {
    pub schema_version: u32, pub request_id: String, pub task_id: String, pub operation: String,
    pub source_binding: SourceBinding, pub input_hash: String, pub source_snapshot_digest: String,
    pub source_files: Vec<SourceFile>, pub state: String, pub exit_code: Option<u32>,
    pub policy_version: String, pub runtime_version: String, pub runtime_inventory_digest: String,
    pub process_verification: Option<crate::verification::ProcessVerification>,
    pub network_preflight: Option<crate::preflight::NetworkPreflight>,
    pub resource_enforcement: Option<crate::task::ResourceEnforcement>,
    pub artifacts: Vec<SourceFile>, pub artifacts_root: PathBuf,
    pub logs: Vec<SourceFile>, pub logs_root: PathBuf, pub cleanup: Cleanup,
    pub recovery_journal: Option<JournalState>, pub error: Option<String>, pub broker_sha256: String,
    pub bin_removed: bool, pub identity_nonce: String, pub job_active_processes: Option<u32>,
}

fn hash(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect() }
fn valid_sha(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || matches!(b,b'a'..=b'f')) }
fn ordinary(path: &Path) -> Result<fs::Metadata> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::symlink_metadata(path)?;
    if meta.file_attributes() & 0x400 != 0 { return Err("Blender paths cannot contain reparse points".into()); }
    Ok(meta)
}
fn directory(path: &Path) -> Result<()> {
    if !path.is_absolute() { return Err("Blender host roots must be absolute".into()); }
    for ancestor in path.ancestors() { if !ordinary(ancestor)?.is_dir() { return Err("Blender root must be an ordinary directory".into()); } }
    Ok(())
}
fn relative(value: &str) -> Result<()> {
    if value.is_empty() || value.contains(['\\', ':', '\0']) || value.split('/').any(|v| v.is_empty() || v == "." || v == ".." || v.ends_with([' ', '.'])) {
        return Err("Invalid runtime inventory path".into());
    }
    Ok(())
}

fn lock(root: &Path) -> Result<RuntimeLock> {
    let compiled: RuntimeLock = serde_json::from_str(LOCK)?;
    let path = root.join("toolchain.lock.json");
    if !ordinary(&path)?.is_file() || fs::metadata(&path)?.len() > 8 * 1024 * 1024 { return Err("Invalid Blender runtime lock".into()); }
    let supplied: RuntimeLock = serde_json::from_slice(&fs::read(path)?)?;
    if supplied.format != compiled.format || supplied.runtime_version != compiled.runtime_version || supplied.executable != compiled.executable || supplied.files != compiled.files {
        return Err("Blender runtime inventory differs from the compiled official pin".into());
    }
    let mut names = BTreeSet::new();
    for file in &compiled.files {
        relative(&file.path)?;
        if !valid_sha(&file.sha256) || !names.insert(file.path.to_ascii_lowercase()) { return Err("Invalid compiled runtime inventory".into()); }
    }
    directory(&root.join("runtime"))?;
    // Check the exact inventory, including additional DLL/Python files: accepting
    // unknown files would undermine hash pinning through module search paths.
    fn walk(root: &Path, here: &Path, names: &mut BTreeSet<String>) -> Result<()> {
        for entry in fs::read_dir(here)? {
            let path = entry?.path(); let meta = ordinary(&path)?;
            if meta.is_dir() { walk(root, &path, names)?; }
            else if meta.is_file() {
                names.insert(path.strip_prefix(root)?.to_str().ok_or("Non-UTF8 runtime path")?.replace('\\', "/").to_ascii_lowercase());
                if names.len() > 10000 { return Err("Runtime inventory file count exceeded".into()); }
            } else { return Err("Runtime contains nonregular file".into()); }
        }
        Ok(())
    }
    let mut actual = BTreeSet::new(); walk(&root.join("runtime"), &root.join("runtime"), &mut actual)?;
    if actual != names { return Err("Blender runtime contains missing or unpinned files".into()); }
    Ok(compiled)
}

pub fn fixed_args(bin: &Path) -> Vec<String> {
    ["--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python"].into_iter().map(str::to_owned)
        .chain([bin.join("bridge-driver.py").to_string_lossy().into_owned(), "--".into(), bin.join("job.json").to_string_lossy().into_owned()]).collect()
}

impl Request {
    fn validate(&self) -> Result<()> {
        if self.schema_version != 1 || self.operation != "model" { return Err("Unsupported Blender broker operation".into()); }
        crate::task::validate_task_id(&self.request_id)?; crate::task::validate_task_id(&self.task_id)?;
        if !valid_sha(&self.input_hash) || !valid_sha(&self.source_binding.source_digest) { return Err("Binding hashes must be lowercase SHA256".into()); }
        if [&self.source_binding.world_id, &self.source_binding.build_id].iter().any(|s| s.is_empty() || s.len()>128 || s.contains('\0')) { return Err("Invalid source binding".into()); }
        directory(&self.tasks_root)?; directory(&self.runtime_root)?; directory(&self.project_root)?;
        Ok(())
    }
}

fn validate_inputs(files: &[SourceFile]) -> Result<()> {
    if !(files.len() == 1 || files.len() == 2) || !files.iter().any(|f| f.path == "script.py" && f.bytes > 0 && f.bytes <= 1024 * 1024)
        || files.iter().any(|f| f.path != "script.py" && f.path != "source.blend") { return Err("Blender input requires script.py and optional source.blend only".into()); }
    Ok(())
}

/// Structural checks are native and run after the process job is empty. Never
/// accept a script-authored report as proof that an exported GLB is valid.
fn validate_glb(bytes: &[u8]) -> Result<()> {
    fn u32_at(bytes: &[u8], i: usize) -> u32 { u32::from_le_bytes(bytes[i..i+4].try_into().unwrap()) }
    if bytes.len()<28 || &bytes[..4] != b"glTF" || u32_at(bytes,4)!=2 || u32_at(bytes,8) as usize != bytes.len() { return Err("Invalid GLB v2 header".into()); }
    let json_len = u32_at(bytes,12) as usize;
    if u32_at(bytes,16)!=0x4e4f534a || json_len%4!=0 || json_len>16*1024*1024 || 20+json_len>bytes.len() { return Err("Invalid GLB JSON chunk".into()); }
    let document: serde_json::Value = serde_json::from_slice(&bytes[20..20+json_len])?;
    if document["asset"]["version"]!="2.0" || document["meshes"].as_array().is_none_or(|m|m.is_empty()) { return Err("GLB has no mesh geometry".into()); }
    let mut offset=20+json_len; let mut bin_bytes=0usize;
    if offset+8<=bytes.len() {
        bin_bytes=u32_at(bytes,offset) as usize;
        if u32_at(bytes,offset+4)!=0x004e4942 || bin_bytes%4!=0 { return Err("Invalid GLB binary chunk".into()); }
        offset=offset.checked_add(8+bin_bytes).ok_or("GLB overflow")?;
    }
    if offset!=bytes.len() || bin_bytes==0 { return Err("GLB requires one embedded binary chunk".into()); }
    let buffers=document["buffers"].as_array().ok_or("GLB missing buffers")?;
    if buffers.len()!=1 || buffers[0].get("uri").is_some() || buffers[0]["byteLength"].as_u64().is_none_or(|n| n==0 || n>bin_bytes as u64) { return Err("GLB must use its embedded buffer only".into()); }
    if document["images"].as_array().is_some_and(|images|images.iter().any(|i|i.get("uri").is_some())) { return Err("GLB images must be embedded".into()); }
    let views=document["bufferViews"].as_array().ok_or("GLB missing buffer views")?;
    for view in views {
        let start=view["byteOffset"].as_u64().unwrap_or(0);
        let length=view["byteLength"].as_u64().ok_or("GLB view missing byte length")?;
        if view["buffer"].as_u64()!=Some(0) || length==0 || start.checked_add(length).is_none_or(|n|n>buffers[0]["byteLength"].as_u64().unwrap()) { return Err("GLB view exceeds embedded buffer".into()); }
    }
    let accessors=document["accessors"].as_array().ok_or("GLB missing accessors")?;
    for mesh in document["meshes"].as_array().unwrap() {
        let primitives=mesh["primitives"].as_array().ok_or("GLB mesh missing primitives")?;
        if primitives.is_empty() { return Err("GLB mesh contains no primitives".into()); }
        for primitive in primitives {
            let index=primitive["attributes"]["POSITION"].as_u64().ok_or("GLB primitive missing positions")? as usize;
            let accessor=accessors.get(index).ok_or("GLB positions accessor out of bounds")?;
            if accessor["type"]!="VEC3" || accessor["componentType"].as_u64()!=Some(5126) { return Err("GLB positions must be float VEC3".into()); }
            let count=accessor["count"].as_u64().filter(|n|*n>0).ok_or("GLB positions are empty")?;
            let view_index=accessor["bufferView"].as_u64().ok_or("GLB positions require dense buffer view")? as usize;
            let view=views.get(view_index).ok_or("GLB accessor view out of bounds")?;
            let stride=view["byteStride"].as_u64().unwrap_or(12);
            let offset=accessor["byteOffset"].as_u64().unwrap_or(0);
            if stride<12 || stride>252 || stride%4!=0 || (count-1).checked_mul(stride).and_then(|n|n.checked_add(offset)).and_then(|n|n.checked_add(12)).is_none_or(|n|n>view["byteLength"].as_u64().unwrap()) {return Err("GLB positions exceed view bounds".into());}
        }
    }
    Ok(())
}

fn validate_outputs(task: &Task) -> Result<()> {
    let files=task.collect_artifacts()?;
    if files.len()!=3 || ["model.glb","source.blend","report.json"].iter().any(|n| !files.iter().any(|f| &f.name==n && f.bytes>0)) { return Err("Blender must export exactly model.glb/source.blend/report.json".into()); }
    validate_glb(&fs::read(task.layout.export_dir.join("model.glb"))?)?;
    let mut magic=[0;7]; fs::File::open(task.layout.export_dir.join("source.blend"))?.read_exact(&mut magic)?;
    if &magic!=b"BLENDER" { return Err("Editable source is not an uncompressed blend file".into()); }
    let report=task.layout.export_dir.join("report.json");
    if fs::metadata(&report)?.len()>1024*1024 { return Err("Blender report exceeds limit".into()); }
    let value:serde_json::Value=serde_json::from_slice(&fs::read(report)?)?;
    if value["schemaVersion"]!=1 || ["meshObjects","vertices","polygons"].iter().any(|k|value[k].as_u64().is_none_or(|v|v==0)) { return Err("Invalid Blender geometry report".into()); }
    Ok(())
}

pub fn execute(request: Request, cancel: Arc<AtomicBool>) -> Result<Response> {
    request.validate()?;
    let (source_files, source_snapshot_digest)=snapshot(Some(&request.project_root))?; validate_inputs(&source_files)?;
    if source_snapshot_digest!=request.input_hash { return Err("Blender input snapshot hash mismatch".into()); }
    if cancel.load(Ordering::SeqCst) { return Err("Cancelled before runtime staging".into()); }
    let runtime=lock(&request.runtime_root)?;
    let runtime_inventory_digest=hash(&serde_json::to_vec(&runtime.files)?);
    let editor=runtime.files.iter().find(|f| f.path==runtime.executable).ok_or("Missing pinned Blender executable")?;
    let pins=EnginePins{editor:PinnedInput{source:request.runtime_root.join("runtime").join(&editor.path),sha256:editor.sha256.clone(),file_name:runtime.executable.clone()},templates:vec![]};
    let executable=std::env::current_exe()?; let broker_sha256=file_digest(&executable)?;
    let broker=PinnedInput{source:executable,sha256:broker_sha256.clone(),file_name:"broker-preflight.exe".into()};
    let journal=crate::recovery::Journal::open(&request.tasks_root)?;
    let mut task=Task::prepare(&request.tasks_root,&request.task_id,TaskKind::Blender,None,&pins,TaskBudget::default())?;
    let journal_result=(|| -> Result<PathBuf> {
        let entry=crate::recovery::JournalEntry::prepared(&task.task_id,&request.request_id,"blenderModel",journal.tasks_root(),&task.layout.root,&task.profile_name,task.sid(),&task.identity_nonce)?;
        journal.write(&entry)
    })();
    let journal_path=match journal_result {
        Ok(path)=>path,
        Err(error)=>{
            let root=task.layout.root.clone(); let cleanup=task.finish();
            if cleanup.is_ok() {let _=fs::remove_dir_all(root);}
            return Err(format!("Blender journal preparation failed: {error}; cleanup={cleanup:?}").into());
        }
    };
    let mut response=Response{schema_version:1,request_id:request.request_id,task_id:request.task_id,operation:request.operation,
        source_binding:request.source_binding,input_hash:request.input_hash,source_snapshot_digest,source_files,
        state:"failed".into(),exit_code:None,policy_version:crate::verification::POLICY_VERSION.into(),runtime_version:runtime.runtime_version,
        runtime_inventory_digest,process_verification:None,network_preflight:None,resource_enforcement:None,
        artifacts:vec![],artifacts_root:task.layout.artifacts.clone(),logs:vec![],logs_root:task.layout.logs.clone(),
        cleanup:Cleanup{verified:false,profile_hresult:None,work_removed:false,error:None},
        recovery_journal:Some(JournalState{path:journal_path,policy_version:crate::recovery::JOURNAL_POLICY_VERSION.into(),cleared:false,error:None}),
        error:None,broker_sha256,bin_removed:false,identity_nonce:task.identity_nonce.clone(),job_active_processes:None};
    let outcome=(|| -> Result<()> {
        for file in &runtime.files {
            if cancel.load(Ordering::SeqCst) { response.state="cancelled".into(); return Err("Cancelled during Blender runtime staging".into()); }
            let src=request.runtime_root.join("runtime").join(&file.path); let dst=task.layout.bin.join(&file.path);
            if !ordinary(&src)?.is_file() || fs::metadata(&src)?.len()!=file.bytes || file_digest(&src)?!=file.sha256 { return Err(format!("Blender runtime pin mismatch: {}",file.path).into()); }
            if file.path!=runtime.executable {
                fs::create_dir_all(dst.parent().ok_or("Runtime path missing parent")?)?; fs::copy(src,&dst)?;
            }
            if file_digest(&dst)?!=file.sha256 { return Err("Blender runtime changed during staging".into()); }
        }
        let input=task.layout.bin.join("input"); fs::create_dir(&input)?;
        for file in &response.source_files { fs::copy(request.project_root.join(&file.path),input.join(&file.path))?; }
        if snapshot(Some(&input))?.1!=response.input_hash { return Err("Blender input changed during staging".into()); }
        fs::write(task.layout.bin.join("bridge-driver.py"),DRIVER)?;
        fs::write(task.layout.bin.join("job.json"),serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"inputRoot":input,"outputRoot":task.layout.export_dir,"sourceBinding":response.source_binding}))?)?;
        task.configure_blender()?;
        let status=task.run_with_preflight(&broker,cancel)?.clone();
        response.exit_code=status.exit_code;
        response.state=match status.state {TaskState::Succeeded=>"succeeded",TaskState::Cancelled=>"cancelled",_=>"failed"}.into();
        if status.state!=TaskState::Succeeded { return Err(status.message.into()); }
        if task.completed_job_active_processes()!=Some(0) { return Err("Blender job has not reached zero active processes".into()); }
        validate_outputs(&task)?;
        response.artifacts=task.hand_off_artifacts()?.into_iter().map(|f|SourceFile{path:f.name,bytes:f.bytes,sha256:f.sha256}).collect();
        // Preserve the actual executed immutable Python, never a script-authored copy.
        let script=response.source_files.iter().find(|f|f.path=="script.py").unwrap();
        let dest=task.layout.artifacts.join("script.py"); fs::copy(input.join("script.py"),&dest)?;
        if file_digest(&dest)?!=script.sha256 { return Err("Source script changed during handoff".into()); }
        response.artifacts.push(SourceFile{path:"script.py".into(),bytes:script.bytes,sha256:script.sha256.clone()});
        response.artifacts.sort_by(|a,b|a.path.cmp(&b.path));
        Ok(())
    })();
    if let Err(error)=outcome { if response.state!="cancelled" {response.state="failed".into();} response.error=Some(error.to_string()); response.artifacts.clear(); }
    response.process_verification=task.process_verification().cloned(); response.network_preflight=task.network_preflight().cloned();
    response.resource_enforcement=task.resource_enforcement().cloned(); response.job_active_processes=task.completed_job_active_processes();
    let logs_result=(|| -> Result<()> {for name in ["preflight.json","task.log"] {
        let path=task.layout.logs.join(name);
        if path.exists() {
            let meta=ordinary(&path)?;
            if !meta.is_file() || meta.len()>4*1024*1024 {return Err("Blender diagnostic log exceeds limit".into());}
            response.logs.push(SourceFile{path:name.into(),bytes:meta.len(),sha256:file_digest(&path)?});
        }
    } Ok(())})();
    if let Err(error)=logs_result {response.state="failed".into();response.error=Some(format!("Blender logs: {error}"));}
    let work=task.layout.work.clone(); let bin=task.layout.bin.clone();
    match task.finish() {
        Ok(code)=>response.cleanup=Cleanup{verified:code>=0 && !work.exists(),profile_hresult:Some(code),work_removed:!work.exists(),error:None},
        Err(error)=>response.cleanup.error=Some(error.to_string()),
    }
    // The job object is gone, the profile has been deleted and source/artifacts
    // are durably separate. Reclaim only this fresh, nonce-marked task's bin.
    if response.cleanup.verified {
        match fs::remove_dir_all(&bin) {Ok(())=>response.bin_removed=true,Err(error)=>{response.cleanup.verified=false;response.cleanup.error=Some(format!("Blender runtime cleanup: {error}"));}}
    }
    if response.cleanup.verified {
        match journal.clear(&response.task_id) {Ok(())=>response.recovery_journal.as_mut().unwrap().cleared=true,Err(error)=>{response.state="failed".into();response.recovery_journal.as_mut().unwrap().error=Some(error.to_string());}}
    } else {response.state="failed".into();}
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn fixed_background_args_exclude_caller_flags() {
        let args=fixed_args(Path::new("C:/private/bin"));
        assert_eq!(&args[..6],["--background","--factory-startup","--disable-autoexec","--python-exit-code","1","--python"]);
        assert_eq!(args.len(),9); assert_eq!(args[7],"--");
    }
    #[test] fn runtime_paths_cannot_escape_or_alias() {
        for path in ["../escape","/absolute","a\\b","C:/x","a//b","a/./b","a ","a:stream"] {assert!(relative(path).is_err(),"{path}");}
        assert!(relative("5.2/python/lib/test.py").is_ok());
    }
    #[test] fn malformed_or_empty_glb_is_rejected() {
        for bytes in [vec![],b"glTF".to_vec(),vec![0;100]] {assert!(validate_glb(&bytes).is_err());}
    }
    fn glb(document: &serde_json::Value) -> Vec<u8> {
        let mut json=serde_json::to_vec(document).unwrap(); while json.len()%4!=0 {json.push(b' ');}
        let mut bytes=b"glTF".to_vec();bytes.extend(2u32.to_le_bytes());bytes.extend((28u32+json.len() as u32+36).to_le_bytes());
        bytes.extend((json.len() as u32).to_le_bytes());bytes.extend(0x4e4f534au32.to_le_bytes());bytes.extend(json);
        bytes.extend(36u32.to_le_bytes());bytes.extend(0x004e4942u32.to_le_bytes());bytes.extend([0u8;36]);bytes
    }
    #[test] fn glb_bounds_and_embedded_geometry_are_checked_independently() {
        let valid=serde_json::json!({"asset":{"version":"2.0"},"buffers":[{"byteLength":36}],"bufferViews":[{"buffer":0,"byteLength":36}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"}],"meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}]});
        assert!(validate_glb(&glb(&valid)).is_ok());
        let mut document=valid.clone();document["buffers"][0]["uri"]="outside.bin".into();assert!(validate_glb(&glb(&document)).is_err());
        let mut document=valid.clone();document["accessors"][0]["count"]=4.into();assert!(validate_glb(&glb(&document)).is_err());
        let mut document=valid.clone();document["accessors"][0]["byteOffset"]=u64::MAX.into();assert!(validate_glb(&glb(&document)).is_err());
        let mut document=valid;document["meshes"][0]["primitives"]=serde_json::json!([]);assert!(validate_glb(&glb(&document)).is_err());
    }
    #[test] fn unknown_protocol_keys_are_rejected() {
        assert!(serde_json::from_value::<Request>(serde_json::json!({"command":"arbitrary"})).is_err());
    }
    #[test] fn pinned_inventory_is_complete_and_contains_python_and_exporter() {
        let runtime:RuntimeLock=serde_json::from_str(LOCK).unwrap();
        assert!(runtime.files.len()>6000);
        assert!(runtime.files.iter().any(|f|f.path=="blender.exe"));
        assert!(runtime.files.iter().any(|f|f.path.contains("io_scene_gltf2")));
        assert!(runtime.files.iter().any(|f|f.path.contains("python") && f.path.ends_with(".dll")));
    }
}
