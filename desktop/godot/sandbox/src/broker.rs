//! Strict private broker protocol. Trust comes from the host-owned executable
//! and private pipe, never from a request field or a project's self-report.
use crate::{task::{Task, TaskKind, TaskBudget, PinnedInput, EnginePins, TaskState}, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::{Arc, atomic::AtomicBool}};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct SourceBinding { pub world_id: String, pub build_id: String, pub source_revision: u64, pub source_digest: String }
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub enum Operation { Version, Import, ExportWeb }
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Request {
    pub schema_version: u32, pub request_id: String, pub task_id: String,
    pub operation: Operation, pub project_root: Option<PathBuf>, pub tasks_root: PathBuf,
    pub engine_root: PathBuf, pub source_binding: SourceBinding, pub input_hash: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct SourceFile { pub path: String, pub bytes: u64, pub sha256: String }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Cleanup { pub verified: bool, pub profile_hresult: Option<i32>, pub work_removed: bool, pub error: Option<String> }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Response {
    pub schema_version: u32, pub request_id: String, pub task_id: String, pub operation: Operation,
    pub source_binding: SourceBinding, pub input_hash: String, pub source_snapshot_digest: String,
    pub source_files: Vec<SourceFile>, pub state: String, pub exit_code: Option<u32>,
    pub policy_version: String,
    pub process_verification: Option<crate::verification::ProcessVerification>,
    pub network_preflight: Option<crate::preflight::NetworkPreflight>,
    pub artifacts: Vec<SourceFile>, pub artifacts_root: PathBuf, pub logs_root: PathBuf, pub logs: Vec<SourceFile>,
    pub cleanup: Cleanup, pub error: Option<String>, pub broker_sha256: String,
}

fn sha256(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect() }
pub fn file_digest(path: &Path) -> Result<String> {
    let mut input = fs::File::open(path)?; let mut digest = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let count = input.read(&mut buffer)?; if count == 0 { break; } digest.update(&buffer[..count]); }
    Ok(digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}
fn source_digest(path: &Path, expected_bytes: u64) -> Result<String> {
    let mut input = fs::File::open(path)?; let mut digest = Sha256::new(); let mut buffer = [0u8; 65536]; let mut read = 0u64;
    loop {
        let count = input.read(&mut buffer)?; if count == 0 { break; }
        read = read.checked_add(count as u64).ok_or("Source size overflow")?;
        if read > expected_bytes || read > 256 * 1024 * 1024 { return Err("Source changed size while hashing".into()); }
        digest.update(&buffer[..count]);
    }
    if read != expected_bytes { return Err("Source changed size while hashing".into()); }
    Ok(digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}
fn ordinary(path: &Path) -> Result<fs::Metadata> {
    use std::os::windows::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_attributes() & 0x400 != 0 { return Err("Broker path contains a reparse point".into()); }
    Ok(metadata)
}
fn absolute_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() { return Err("Broker directory must be absolute".into()); }
    for ancestor in path.ancestors() { if !ordinary(ancestor)?.is_dir() { return Err("Broker directory ancestor is not ordinary".into()); } }
    Ok(())
}
fn valid_sha(value: &str) -> bool { value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')) }

impl Request {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 { return Err("Unsupported broker request version".into()); }
        crate::task::validate_task_id(&self.request_id)?; crate::task::validate_task_id(&self.task_id)?;
        if !valid_sha(&self.input_hash) || !valid_sha(&self.source_binding.source_digest) { return Err("Binding hashes must be lowercase SHA-256".into()); }
        if [&self.source_binding.world_id, &self.source_binding.build_id].iter().any(|value| value.is_empty() || value.len() > 128 || value.contains('\0')) { return Err("Invalid source binding identity".into()); }
        absolute_directory(&self.tasks_root)?; absolute_directory(&self.engine_root)?;
        match (self.operation, &self.project_root) {
            (Operation::Version, None) => {},
            (Operation::Version, Some(_)) => return Err("Version does not accept a project".into()),
            (_, Some(root)) => absolute_directory(root)?,
            _ => return Err("Build operation requires a project root".into()),
        }
        Ok(())
    }
}

pub fn snapshot(root: Option<&Path>) -> Result<(Vec<SourceFile>, String)> {
    fn visit(root: &Path, directory: &Path, files: &mut Vec<SourceFile>, total: &mut u64) -> Result<()> {
        if !ordinary(directory)?.is_dir() { return Err("Snapshot root is not an ordinary directory".into()); }
        for entry in fs::read_dir(directory)? {
            let path = entry?.path(); let metadata = ordinary(&path)?;
            if metadata.is_dir() { visit(root, &path, files, total)?; }
            else if metadata.is_file() {
                if files.len() >= 4096 || metadata.len() > 256 * 1024 * 1024 { return Err("Source file limit exceeded".into()); }
                *total = total.checked_add(metadata.len()).ok_or("Source size overflow")?;
                if *total > 512 * 1024 * 1024 { return Err("Source total limit exceeded".into()); }
                let relative = path.strip_prefix(root)?.to_str().ok_or("Source path is not UTF-8")?.replace('\\', "/");
                files.push(SourceFile { path: relative, bytes: metadata.len(), sha256: source_digest(&path, metadata.len())? });
            } else { return Err("Source contains a non-regular file".into()); }
        }
        Ok(())
    }
    let mut files = Vec::new();
    if let Some(root) = root { visit(root, root, &mut files, &mut 0)?; }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let digest = sha256(&serde_json::to_vec(&files)?);
    Ok((files, digest))
}

/// Only pinned Godot 4.7.2 and these Web templates may be launched by the CLI.
pub fn fixed_pins(root: &Path) -> EnginePins {
    EnginePins { editor: PinnedInput { source: root.join("editor/Godot_v4.7.2-stable_win64.exe"),
        sha256: "ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424".into(), file_name: "Godot_v4.7.2-stable_win64.exe".into() },
        templates: [("version.txt", "38885c88f75abbc797a1db7559719800279a00cfb9fa8b2e2868a7f6f84bad2e"),
            ("web_nothreads_debug.zip", "08962aefef811b603541d7951ac67ef00413aad2d978855183c28adee98f626a"),
            ("web_nothreads_release.zip", "d3ee2f08cef0cf3cf6678a6355a92a8db48ccdd35cbd2e8bfd5f0e8a0b4032a0"),
            ("web_release.zip", "02f0dca13ed3d8343fa68f8f88ac80295562408d71aa67157e8b96ddebaa67a3")].into_iter()
            .map(|(name, hash)| PinnedInput { source: root.join("templates").join(name), sha256: hash.into(), file_name: name.into() }).collect() }
}

pub fn execute(request: Request, cancel: Arc<AtomicBool>) -> Result<Response> {
    request.validate()?;
    let (source_files, source_snapshot_digest) = snapshot(request.project_root.as_deref())?;
    let executable = std::env::current_exe()?;
    let broker_sha256 = file_digest(&executable)?;
    let broker = PinnedInput { source: executable, sha256: broker_sha256.clone(), file_name: "broker-preflight.exe".into() };
    let kind = match request.operation { Operation::Version => TaskKind::Version, Operation::Import => TaskKind::Import, Operation::ExportWeb => TaskKind::ExportWeb };
    let mut task = Task::prepare(&request.tasks_root, &request.task_id, kind, request.project_root.as_deref(), &fixed_pins(&request.engine_root), TaskBudget::default())?;
    let mut response = Response { schema_version: 1, request_id: request.request_id, task_id: request.task_id,
        operation: request.operation, source_binding: request.source_binding, input_hash: request.input_hash,
        source_snapshot_digest, source_files, state: "failed".into(), exit_code: None,
        policy_version: crate::verification::POLICY_VERSION.into(), process_verification: None, network_preflight: None,
        artifacts: Vec::new(), artifacts_root: task.layout.artifacts.clone(), logs_root: task.layout.logs.clone(), logs: Vec::new(),
        cleanup: Cleanup { verified: false, profile_hresult: None, work_removed: false, error: None }, error: None, broker_sha256 };
    let work = task.layout.work.clone();
    let outcome = (|| -> Result<()> {
        let (_, copied) = snapshot(if matches!(request.operation, Operation::Version) { None } else { Some(task.layout.project.as_path()) })?;
        if copied != response.source_snapshot_digest { return Err("Source changed during broker materialization".into()); }
        let status = task.run_with_preflight(&broker, cancel)?.clone();
        response.state = match status.state { TaskState::Succeeded => "succeeded", TaskState::Cancelled => "cancelled", _ => "failed" }.into();
        response.exit_code = status.exit_code;
        response.process_verification = task.process_verification().cloned();
        response.network_preflight = task.network_preflight().cloned();
        if status.state != TaskState::Succeeded { response.error = Some(status.message); }
        if matches!(request.operation, Operation::ExportWeb) && status.state == TaskState::Succeeded {
            response.artifacts = task.hand_off_artifacts()?.into_iter().map(|artifact| SourceFile { path: artifact.name, bytes: artifact.bytes, sha256: artifact.sha256 }).collect();
        }
        Ok(())
    })();
    if let Err(error) = outcome { response.state = "failed".into(); response.error = Some(error.to_string()); }
    let logs_result = (|| -> Result<()> { for name in ["preflight.json", "task.log"] {
        let path = task.layout.logs.join(name);
        if path.exists() {
            let metadata = ordinary(&path)?;
            if !metadata.is_file() || metadata.len() > 4 * 1024 * 1024 {
                response.state = "failed".into(); response.error = Some("Task diagnostic log exceeds its 4 MiB limit".into());
            } else {
                response.logs.push(SourceFile { path: name.into(), bytes: metadata.len(), sha256: file_digest(&path)? });
            }
        }
    } Ok(()) })();
    if let Err(error) = logs_result { response.state = "failed".into(); response.error = Some(format!("Log collection failed: {error}")); }
    match task.finish() {
        Ok(code) => response.cleanup = Cleanup { verified: code >= 0 && !work.exists(), profile_hresult: Some(code), work_removed: !work.exists(), error: None },
        Err(error) => response.cleanup.error = Some(error.to_string()),
    }
    if !response.cleanup.verified { response.state = "failed".into(); }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_cannot_claim_trust_or_supply_command_arguments() {
        let request = r#"{"schemaVersion":1,"requestId":"r","taskId":"t","operation":"version","tasksRoot":"D:/x","engineRoot":"D:/e","sourceBinding":{"worldId":"w","buildId":"b","sourceRevision":0,"sourceDigest":"x"},"inputHash":"x","trusted":true}"#;
        assert!(serde_json::from_str::<Request>(request).is_err());
        assert!(serde_json::from_str::<Operation>("\"shell\"").is_err());
    }
    #[test]
    fn empty_snapshot_has_canonical_compact_json_hash() {
        let (files, digest) = snapshot(None).unwrap();
        assert!(files.is_empty()); assert_eq!(digest, sha256(b"[]"));
    }
    #[test]
    fn snapshot_orders_paths_and_binds_content_changes() {
        let root = std::env::temp_dir().join(format!("cm-g6-snapshot-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("z.txt"), "last").unwrap(); fs::write(root.join("a.txt"), "first").unwrap();
        let (files, first) = snapshot(Some(&root)).unwrap();
        assert_eq!(files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), vec!["a.txt", "z.txt"]);
        assert_eq!(first, sha256(&serde_json::to_vec(&files).unwrap()));
        fs::write(root.join("a.txt"), "other").unwrap();
        assert_ne!(first, snapshot(Some(&root)).unwrap().1);
        fs::remove_file(root.join("z.txt")).unwrap(); fs::remove_file(root.join("a.txt")).unwrap(); fs::remove_dir(root).unwrap();
    }
}
