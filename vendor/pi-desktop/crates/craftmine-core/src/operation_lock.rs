//! OS-owned advisory locks. A process exit releases ownership; an old PID or a
//! leftover filename can never authorize recovery of a still-running operation.
use std::{fs::{File, OpenOptions}, path::Path};
use anyhow::{ensure, Context, Result};

#[derive(Debug)]
pub(crate) struct OperationLock { _file: File }
impl OperationLock {
    fn acquire(path: &Path) -> Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000); // FILE_FLAG_OPEN_REPARSE_POINT
        }
        let file = options.open(path).context("OPERATION_LOCK_OPEN_FAILED")?;
        let metadata = file.metadata()?;
        ensure!(metadata.is_file() && !metadata.file_type().is_symlink(), "OPERATION_LOCK_REDIRECT");
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            ensure!(metadata.file_attributes() & 0x400 == 0, "OPERATION_LOCK_REDIRECT");
        }
        file.try_lock().context("OPERATION_BUSY")?;
        Ok(Self { _file: file })
    }
    pub(crate) fn domain(directory: &Path) -> Result<Self> {
        Self::acquire(&directory.join(".craftmine-operation.lock"))
    }
    pub(crate) fn restore_target(target: &Path) -> Result<Self> {
        let parent = target.parent().context("BACKUP_TARGET_REQUIRED")?;
        ensure!(parent.is_dir(), "BACKUP_TARGET_PARENT_MISSING");
        let key = crate::digest(&target.to_string_lossy().to_lowercase());
        Self::acquire(&parent.join(format!(".craftmine-restore-{key}.lock")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn independent_handles_cannot_own_an_operation_together() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let guard = OperationLock::domain(directory.path())?;
        assert!(OperationLock::domain(directory.path()).unwrap_err().to_string().contains("OPERATION_BUSY"));
        drop(guard);
        let _next = OperationLock::domain(directory.path())?;
        Ok(())
    }

    #[test]
    #[ignore = "owned child process; driven by operation_lock_process test"]
    fn operation_lock_child() -> Result<()> {
        let Some(path) = std::env::var_os("CRAFTMINE_LOCK_TEST_ROOT") else { return Ok(()) };
        let root = std::path::PathBuf::from(path);
        let _domain = OperationLock::domain(&root)?;
        let _target = OperationLock::restore_target(&root.join("target"))?;
        std::fs::write(root.join("ready"), b"locked")?;
        std::thread::sleep(std::time::Duration::from_secs(30));
        Ok(())
    }

    #[test]
    fn operation_lock_process_excludes_live_recovery_and_releases_after_kill() -> Result<()> {
        let root = tempfile::tempdir()?;
        struct Child(std::process::Child);
        impl Drop for Child { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
        let mut child = Child(std::process::Command::new(std::env::current_exe()?)
            .args(["--exact", "operation_lock::tests::operation_lock_child", "--ignored", "--nocapture"])
            .env("CRAFTMINE_LOCK_TEST_ROOT", root.path()).spawn()?);
        for _ in 0..200 {
            if root.path().join("ready").exists() { break; }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        ensure!(root.path().join("ready").exists(), "child did not acquire locks");
        assert!(OperationLock::domain(root.path()).is_err());
        assert!(OperationLock::restore_target(&root.path().join("target")).is_err());
        let mut journal = crate::TaskJournal::open(&root.path().join("tasks.sqlite"))?;
        assert_eq!(journal.backup_recover()?, 0);
        assert!(journal.backup_restore_portable(&serde_json::json!({})).unwrap_err().to_string().contains("OPERATION_BUSY"));
        child.0.kill()?;
        child.0.wait()?;
        let _domain = OperationLock::domain(root.path())?;
        let _target = OperationLock::restore_target(&root.path().join("target"))?;
        Ok(())
    }
}
