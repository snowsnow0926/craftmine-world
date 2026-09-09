//! VM0: managed Git adapter.
//!
//! Frozen rules for every Git call in this crate:
//!
//! * The Git program is located through explicit candidate paths, pinned by its
//!   reported version and its file SHA-256, and recorded as bundled or PATH
//!   fallback. A player-installed Git is never required and its global
//!   configuration is never read or written.
//! * Every invocation is an argument array with structured standard input.
//!   There is no shell, no string interpolation and no interactive prompt.
//! * A managed configuration directory replaces system and user configuration.
//!   Hooks, external diff/merge/filter drivers, pagers, credential helpers,
//!   submodule recursion and network protocols are disabled.
//! * Author and committer identity come from host state. No email is required
//!   from the player and no commit ever reads a global identity.
//! * Object IDs are treated as variable-length hex strings. The repository
//!   object format is recorded instead of assuming 40 characters.

use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

use super::contract::{validate_oid, validate_relative_path};

/// Minimum supported Git feature level. `merge-tree --write-tree` and reliable
/// `update-ref` compare-and-swap behaviour need at least this version.
pub const MINIMUM_GIT: (u32, u32) = (2, 38);
const STDOUT_LIMIT: usize = 64 * 1024 * 1024;
const STDERR_LIMIT: usize = 1024 * 1024;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// Subcommands the adapter may run. Anything else is refused before spawning.
const ALLOWED_SUBCOMMANDS: &[&str] = &[
    "init",
    "hash-object",
    "cat-file",
    "ls-tree",
    "mktree",
    "update-index",
    "write-tree",
    "read-tree",
    "commit-tree",
    "update-ref",
    "symbolic-ref",
    "for-each-ref",
    "rev-parse",
    "rev-list",
    "log",
    "show",
    "diff-tree",
    "diff",
    "merge-tree",
    "merge-file",
    "merge-base",
    "mktag",
    "prune",
    "fsck",
    "bundle",
    "config",
    "count-objects",
    "verify-pack",
    "tag",
    "check-ref-format",
];

/// Configuration keys a world repository is not allowed to carry. Command-line
/// `-c` values win over repository config, but hostile keys are rejected
/// outright so a later code path cannot accidentally rely on them.
const FORBIDDEN_CONFIG_PREFIXES: &[&str] = &[
    "core.hookspath",
    "core.fsmonitor",
    "core.pager",
    "core.sshcommand",
    "core.gitproxy",
    "core.editor",
    "core.askpass",
    "core.attributesfile",
    "filter.",
    "diff.external",
    "difftool.",
    "mergetool.",
    "merge.",
    "credential.",
    "include.path",
    "includeif.",
    "alias.",
    "protocol.",
    "url.",
    "http.",
    "remote.",
    "submodule.",
    "uploadpack.",
    "receivepack.",
    "gc.",
    "pager.",
    "safe.",
    "fsmonitor.",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitSource {
    /// Shipped with the client and pinned by hash.
    Bundled,
    /// Found on PATH; recorded so the report never claims a bundled binary.
    PathFallback,
}

/// Provenance record for VM0 and the licensing material handed to K.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgramInfo {
    pub path: String,
    pub version: String,
    pub version_major: u32,
    pub version_minor: u32,
    pub sha256: String,
    pub source: GitSource,
}

/// Host-provided commit identity. The email is derived from the stable local
/// identifier, so the player is never asked for one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
}

impl GitIdentity {
    pub fn local(display_name: &str, stable_id: &str) -> Result<Self> {
        let name = display_name.trim();
        ensure!(
            !name.is_empty()
                && name.len() <= 120
                && !name.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | '\n')),
            "INVALID_GIT_IDENTITY"
        );
        let stable: String = stable_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            .take(64)
            .collect();
        ensure!(!stable.is_empty(), "INVALID_GIT_IDENTITY");
        Ok(Self {
            name: name.to_string(),
            email: format!("{stable}@craftmine.local"),
        })
    }
}

#[derive(Clone, Debug)]
pub struct GitOutput {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl GitOutput {
    pub fn ok(&self) -> bool {
        self.code == 0
    }

    pub fn stdout_text(&self) -> Result<String> {
        String::from_utf8(self.stdout.clone()).context("GIT_OUTPUT_NOT_UTF8")
    }

    pub fn trimmed(&self) -> Result<String> {
        Ok(self.stdout_text()?.trim().to_string())
    }

    pub(crate) fn ensure_ok(self, code: &str) -> Result<Self> {
        ensure!(
            self.ok(),
            "{code}: git exited {}: {}",
            self.code,
            self.stderr.trim()
        );
        Ok(self)
    }
}

/// A Git process whose standard output is consumed incrementally.
///
/// `execute` buffers a command's entire stdout and stops storing at
/// `STDOUT_LIMIT`, so it cannot serve a command that legitimately produces more
/// than that (for example `cat-file --batch` over a large repository). A
/// `GitStream` hands the caller the raw pipe instead, so the caller can copy the
/// output into its destination in bounded chunks and the peak memory of the call
/// does not grow with the repository size. The command whitelist, the isolated
/// environment and the timeout apply exactly as they do for `execute`.
pub struct GitStream {
    child: Child,
    stdout: Option<BufReader<ChildStdout>>,
    stdin: Option<ChildStdin>,
    stderr: Option<std::thread::JoinHandle<Vec<u8>>>,
    deadline: Instant,
    subcommand: String,
    timeout: Duration,
    finished: bool,
}

impl GitStream {
    /// Takes the write end of the pipe.
    ///
    /// A caller that feeds the process more input than one pipe buffer must
    /// write from a dedicated thread while reading stdout: otherwise the child
    /// blocks on a full stdout pipe and the caller blocks on a full stdin pipe.
    pub fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.stdin.take()
    }

    /// Waits for the process and fails on a non-zero exit status.
    ///
    /// Standard input is closed first, so a command that reads to end-of-file
    /// can finish, and any output the caller did not read is discarded, so a
    /// command still producing output cannot block on a full stdout pipe while
    /// this waits.
    pub fn finish(mut self) -> Result<()> {
        self.stdin = None;
        let drain = self.stdout.take().map(|mut stdout| {
            std::thread::spawn(move || {
                let mut buffer = [0u8; 64 * 1024];
                while let Ok(read) = stdout.read(&mut buffer) {
                    if read == 0 {
                        break;
                    }
                }
            })
        });
        let mut status = loop {
            if let Some(status) = self.child.try_wait().context("GIT_WAIT_FAILED")? {
                break Some(status);
            }
            if Instant::now() >= self.deadline {
                let _ = self.child.kill();
                let _ = self.child.wait();
                break None;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        self.finished = true;
        if let Some(drain) = drain {
            let _ = drain.join();
        }
        let stderr = self
            .stderr
            .take()
            .and_then(|reader| reader.join().ok())
            .unwrap_or_default();
        let Some(exit) = status.take() else {
            anyhow::bail!(
                "GIT_TIMEOUT: {} exceeded {:?}",
                self.subcommand,
                self.timeout
            );
        };
        ensure!(
            exit.success(),
            "GIT_STREAM_FAILED: {} exited {}: {}",
            self.subcommand,
            exit.code().unwrap_or(-1),
            String::from_utf8_lossy(&stderr).trim()
        );
        Ok(())
    }
}

impl Read for GitStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self.stdout.as_mut() {
            Some(stdout) => stdout.read(buffer),
            None => Ok(0),
        }
    }
}

impl BufRead for GitStream {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
        match self.stdout.as_mut() {
            Some(stdout) => stdout.fill_buf(),
            None => Ok(&[]),
        }
    }

    fn consume(&mut self, amount: usize) {
        if let Some(stdout) = self.stdout.as_mut() {
            stdout.consume(amount);
        }
    }
}

impl Drop for GitStream {
    fn drop(&mut self) {
        if !self.finished {
            // A stream that was not finished must not leave a child behind.
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.finished = true;
        }
        if let Some(reader) = self.stderr.take() {
            let _ = reader.join();
        }
    }
}

/// One tree entry for `write-tree` style commit construction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeEntry {
    pub mode: String,
    pub path: String,
    pub oid: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefEntry {
    pub name: String,
    pub oid: String,
    pub object_type: String,
    pub symref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRecord {
    pub oid: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
    /// `Craftmine-Request` trailer: the player request that grouped this
    /// commit. AI intermediate patches share one request id.
    pub request_id: Option<String>,
    /// `Craftmine-Task` trailer: the bound writing task.
    pub task_id: Option<String>,
    /// `Craftmine-Legacy-Revision` trailer, set only on migrated history.
    pub legacy_revision: Option<u64>,
    /// `Craftmine-Manifest-Hash` trailer of a migrated revision.
    pub legacy_manifest_hash: Option<String>,
}

pub struct GitAdapter {
    info: GitProgramInfo,
    config_dir: PathBuf,
    identity: GitIdentity,
    timeout: Duration,
}

impl Clone for GitAdapter {
    fn clone(&self) -> Self {
        Self {
            info: self.info.clone(),
            config_dir: self.config_dir.clone(),
            identity: self.identity.clone(),
            timeout: self.timeout,
        }
    }
}

impl GitAdapter {
    /// Locate and pin the Git program.
    ///
    /// `bundled` lists the shipped candidates in priority order. When none of
    /// them exists the adapter falls back to PATH and records that fact, so no
    /// report can claim a bundled binary that was not used.
    pub fn discover(config_dir: &Path, bundled: &[PathBuf], identity: GitIdentity) -> Result<Self> {
        let (path, source) = Self::locate(bundled)?;
        let info = Self::probe(&path, source)?;
        let adapter = Self {
            info,
            config_dir: config_dir.to_path_buf(),
            identity,
            timeout: DEFAULT_TIMEOUT,
        };
        adapter.prepare_configuration()?;
        Ok(adapter)
    }

    fn locate(bundled: &[PathBuf]) -> Result<(PathBuf, GitSource)> {
        for candidate in bundled {
            if candidate.is_file() {
                return Ok((candidate.clone(), GitSource::Bundled));
            }
        }
        let name = if cfg!(windows) { "git.exe" } else { "git" };
        if let Some(path) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path) {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok((candidate, GitSource::PathFallback));
                }
            }
        }
        anyhow::bail!("GIT_PROGRAM_NOT_FOUND")
    }

    fn probe(path: &Path, source: GitSource) -> Result<GitProgramInfo> {
        let bytes = std::fs::read(path).context("GIT_PROGRAM_UNREADABLE")?;
        let sha256 = {
            use sha2::{Digest, Sha256};
            Sha256::digest(&bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        let output = Command::new(path)
            .arg("--version")
            .stdin(Stdio::null())
            .output()
            .context("GIT_PROGRAM_UNUSABLE")?;
        ensure!(output.status.success(), "GIT_PROGRAM_UNUSABLE");
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let version = text
            .strip_prefix("git version ")
            .context("GIT_VERSION_UNKNOWN")?
            .split_whitespace()
            .next()
            .context("GIT_VERSION_UNKNOWN")?
            .to_string();
        let mut parts = version.split('.');
        let major: u32 = parts
            .next()
            .and_then(|value| value.parse().ok())
            .context("GIT_VERSION_UNKNOWN")?;
        let minor: u32 = parts
            .next()
            .and_then(|value| value.parse().ok())
            .context("GIT_VERSION_UNKNOWN")?;
        ensure!(
            (major, minor) >= MINIMUM_GIT,
            "GIT_VERSION_TOO_OLD: {version} < {}.{}",
            MINIMUM_GIT.0,
            MINIMUM_GIT.1
        );
        Ok(GitProgramInfo {
            path: path.to_string_lossy().into_owned(),
            version,
            version_major: major,
            version_minor: minor,
            sha256,
            source,
        })
    }

    fn prepare_configuration(&self) -> Result<()> {
        for dir in [
            self.config_dir.clone(),
            self.hooks_dir(),
            self.home_dir(),
            self.work_dir(),
        ] {
            std::fs::create_dir_all(&dir).context("GIT_CONFIG_UNAVAILABLE")?;
        }
        let global = self.config_dir.join("gitconfig");
        if !global.exists() {
            std::fs::write(&global, b"# Managed by Craftmine; never the user's Git configuration.\n")
                .context("GIT_CONFIG_UNAVAILABLE")?;
        }
        // An askpass helper that always fails keeps prompts impossible even if a
        // subcommand we forgot to guard tries to authenticate.
        let askpass = self.config_dir.join(if cfg!(windows) {
            "deny-askpass.cmd"
        } else {
            "deny-askpass.sh"
        });
        if !askpass.exists() {
            let body = if cfg!(windows) {
                "@echo off\r\nexit /b 1\r\n"
            } else {
                "#!/bin/sh\nexit 1\n"
            };
            std::fs::write(&askpass, body).context("GIT_CONFIG_UNAVAILABLE")?;
        }
        Ok(())
    }

    pub fn info(&self) -> &GitProgramInfo {
        &self.info
    }

    pub fn identity(&self) -> &GitIdentity {
        &self.identity
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    fn hooks_dir(&self) -> PathBuf {
        self.config_dir.join("empty-hooks")
    }

    /// Git parses paths itself and does not understand the Windows verbatim
    /// (`\\?\`) prefix that `std::fs::canonicalize` returns. Strip it before any
    /// path is handed to the child process, or Git fails to read the managed
    /// configuration and reports a generic error.
    pub fn plain_path(path: &Path) -> PathBuf {
        Self::plain(path)
    }

    fn plain(path: &Path) -> PathBuf {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
        path.to_path_buf()
    }

    fn home_dir(&self) -> PathBuf {
        self.config_dir.join("home")
    }

    /// Neutral working directory. Every child process runs here so Git cannot
    /// discover a repository (for example the product checkout) by walking up
    /// from the host process's current directory.
    fn work_dir(&self) -> PathBuf {
        self.config_dir.join("work")
    }

    /// Configuration overrides applied to every invocation. They take
    /// precedence over any repository or system configuration.
    fn overrides(&self) -> Vec<String> {
        let hooks = Self::plain(&self.hooks_dir()).to_string_lossy().into_owned();
        [
            ("core.hooksPath", hooks.as_str()),
            ("core.fsmonitor", "false"),
            ("core.autocrlf", "false"),
            ("core.safecrlf", "false"),
            ("core.symlinks", "false"),
            ("core.longpaths", "true"),
            ("core.quotepath", "false"),
            ("core.fileMode", "false"),
            ("core.editor", "false"),
            ("core.pager", "cat"),
            ("credential.helper", ""),
            ("protocol.allow", "never"),
            ("protocol.file.allow", "never"),
            ("protocol.ext.allow", "never"),
            ("fetch.recurseSubmodules", "no"),
            ("submodule.recurse", "false"),
            ("advice.detachedHead", "false"),
            ("gc.auto", "0"),
        ]
        .iter()
        .flat_map(|(key, value)| ["-c".to_string(), format!("{key}={value}")])
        .collect()
    }

    fn build_command(&self, args: &[String], envs: &[(String, String)]) -> Result<Command> {
        // `--git-dir=<path>` is passed as a single option, so the first
        // element that is not an option is always the subcommand.
        let subcommand = args
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .map(String::as_str)
            .unwrap_or("");
        ensure!(
            ALLOWED_SUBCOMMANDS.contains(&subcommand),
            "GIT_SUBCOMMAND_REFUSED: {subcommand}"
        );
        let mut command = Command::new(&self.info.path);
        command.args(self.overrides());
        command.args(args);
        command.current_dir(Self::plain(&self.work_dir()));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", Self::plain(&self.config_dir.join("gitconfig")))
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", Self::plain(&self.config_dir.join(if cfg!(windows) {
                "deny-askpass.cmd"
            } else {
                "deny-askpass.sh"
            })))
            .env("GIT_PAGER", "cat")
            .env("GCM_INTERACTIVE", "never")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("HOME", Self::plain(&self.home_dir()))
            .env("XDG_CONFIG_HOME", Self::plain(&self.home_dir().join(".config")))
            .env("USERPROFILE", Self::plain(&self.home_dir()));
        for (key, value) in envs {
            command.env(key, value);
        }
        Ok(command)
    }

    /// Run a Git command with no repository context.
    pub fn raw(&self, args: &[&str]) -> Result<GitOutput> {
        let owned: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        self.execute(&owned, &[], None)
    }

    /// Run a Git command against a managed repository directory.
    pub fn repo(&self, git_dir: &Path, args: &[&str]) -> Result<GitOutput> {
        self.repo_stdin(git_dir, args, &[])
    }

    pub fn repo_stdin(&self, git_dir: &Path, args: &[&str], stdin: &[u8]) -> Result<GitOutput> {
        self.repo_stdin_env(git_dir, args, &[], stdin)
    }

    fn repo_stdin_env(
        &self,
        git_dir: &Path,
        args: &[&str],
        envs: &[(String, String)],
        stdin: &[u8],
    ) -> Result<GitOutput> {
        let mut full = vec![format!(
            "--git-dir={}",
            Self::plain(git_dir).to_string_lossy()
        )];
        full.extend(args.iter().map(|arg| arg.to_string()));
        self.execute(&full, envs, Some(stdin))
    }

    fn execute(
        &self,
        args: &[String],
        envs: &[(String, String)],
        stdin: Option<&[u8]>,
    ) -> Result<GitOutput> {
        let subcommand = args
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .map(String::as_str)
            .unwrap_or("")
            .to_string();
        let mut command = self.build_command(args, envs)?;
        let mut child = command.spawn().context("GIT_SPAWN_FAILED")?;
        let mut child_stdin = child.stdin.take().context("GIT_SPAWN_FAILED")?;
        let mut child_stdout = child.stdout.take().context("GIT_SPAWN_FAILED")?;
        let mut child_stderr = child.stderr.take().context("GIT_SPAWN_FAILED")?;
        let payload = stdin.map(|bytes| bytes.to_vec());
        let writer = std::thread::spawn(move || {
            if let Some(bytes) = payload {
                let _ = child_stdin.write_all(&bytes);
            }
            let _ = child_stdin.flush();
            drop(child_stdin);
        });
        let (out_tx, out_rx) = mpsc::channel();
        let stdout_reader = std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 64 * 1024];
            loop {
                match child_stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if buffer.len() < STDOUT_LIMIT {
                            let remaining = STDOUT_LIMIT - buffer.len();
                            buffer.extend_from_slice(&chunk[..count.min(remaining)]);
                        }
                    }
                }
            }
            let _ = out_tx.send(buffer);
        });
        let (err_tx, err_rx) = mpsc::channel();
        let stderr_reader = std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 8 * 1024];
            loop {
                match child_stderr.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if buffer.len() < STDERR_LIMIT {
                            let remaining = STDERR_LIMIT - buffer.len();
                            buffer.extend_from_slice(&chunk[..count.min(remaining)]);
                        }
                    }
                }
            }
            let _ = err_tx.send(buffer);
        });
        let deadline = Instant::now() + self.timeout;
        let status = loop {
            if let Some(status) = child.try_wait().context("GIT_WAIT_FAILED")? {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                anyhow::bail!("GIT_TIMEOUT: {subcommand} exceeded {:?}", self.timeout);
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        let _ = writer.join();
        let _ = stdout_reader.join();
        let _ = stderr_reader.join();
        let stdout = out_rx.recv().unwrap_or_default();
        let stderr = err_rx.recv().unwrap_or_default();
        Ok(GitOutput {
            code: status.code().unwrap_or(-1),
            stdout,
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    }

    /// Spawn a Git command against a managed repository directory whose stdout
    /// is read incrementally instead of being buffered and truncated.
    ///
    /// The whitelist check, the managed configuration, the isolated environment
    /// and the timeout are the same as `execute`; only the buffering differs.
    /// The caller must call [`GitStream::finish`]; dropping the stream without
    /// it kills the process.
    pub fn repo_stream(&self, git_dir: &Path, args: &[&str]) -> Result<GitStream> {
        let mut full = vec![format!(
            "--git-dir={}",
            Self::plain(git_dir).to_string_lossy()
        )];
        full.extend(args.iter().map(|arg| arg.to_string()));
        let subcommand = full
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .map(String::as_str)
            .unwrap_or("")
            .to_string();
        let mut command = self.build_command(&full, &[])?;
        let mut child = command.spawn().context("GIT_SPAWN_FAILED")?;
        let stdin = child.stdin.take().context("GIT_SPAWN_FAILED")?;
        let stdout = child.stdout.take().context("GIT_SPAWN_FAILED")?;
        let mut child_stderr = child.stderr.take().context("GIT_SPAWN_FAILED")?;
        let stderr_reader = std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 8 * 1024];
            loop {
                match child_stderr.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if buffer.len() < STDERR_LIMIT {
                            let remaining = STDERR_LIMIT - buffer.len();
                            buffer.extend_from_slice(&chunk[..count.min(remaining)]);
                        }
                    }
                }
            }
            buffer
        });
        Ok(GitStream {
            child,
            stdout: Some(BufReader::new(stdout)),
            stdin: Some(stdin),
            stderr: Some(stderr_reader),
            deadline: Instant::now() + self.timeout,
            subcommand,
            timeout: self.timeout,
            finished: false,
        })
    }

    // ---- typed helpers -------------------------------------------------

    pub fn init_bare(&self, git_dir: &Path, object_format: &str) -> Result<String> {
        ensure!(
            matches!(object_format, "sha1" | "sha256"),
            "GIT_OBJECT_FORMAT_UNSUPPORTED"
        );
        ensure!(!git_dir.exists(), "GIT_REPOSITORY_EXISTS");
        if let Some(parent) = git_dir.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path = Self::plain(git_dir).to_string_lossy().into_owned();
        self.raw(&[
            "init",
            "--bare",
            "--quiet",
            "--object-format",
            object_format,
            "--initial-branch",
            "main",
            &path,
        ])?
        .ensure_ok("GIT_INIT_FAILED")?;
        self.assert_managed_config(git_dir)?;
        self.object_format(git_dir)
    }

    pub fn object_format(&self, git_dir: &Path) -> Result<String> {
        let value = self
            .repo(git_dir, &["config", "--get", "extensions.objectFormat"])?
            .trimmed()?;
        Ok(if value.is_empty() { "sha1".to_string() } else { value })
    }

    pub fn hash_object(&self, git_dir: &Path, bytes: &[u8]) -> Result<String> {
        let output = self
            .repo_stdin(git_dir, &["hash-object", "-w", "--stdin"], bytes)?
            .ensure_ok("GIT_HASH_OBJECT_FAILED")?;
        let oid = output.trimmed()?;
        validate_oid(&oid)?;
        Ok(oid)
    }

    pub fn object_type(&self, git_dir: &Path, oid: &str) -> Result<String> {
        validate_oid(oid)?;
        let output = self
            .repo(git_dir, &["cat-file", "-t", oid])?
            .ensure_ok("GIT_OBJECT_MISSING")?;
        Ok(output.trimmed()?)
    }

    pub fn cat_object(&self, git_dir: &Path, oid: &str) -> Result<Vec<u8>> {
        validate_oid(oid)?;
        let output = self
            .repo(git_dir, &["cat-file", "blob", oid])?
            .ensure_ok("GIT_OBJECT_MISSING")?;
        Ok(output.stdout)
    }

    pub fn write_tree(&self, git_dir: &Path, entries: &[TreeEntry]) -> Result<String> {
        let index = self
            .config_dir
            .join(format!("index-{}-{}", std::process::id(), entries.len()));
        let _ = std::fs::remove_file(&index);
        let mut input = Vec::new();
        for entry in entries {
            ensure!(
                matches!(entry.mode.as_str(), "100644" | "100755" | "120000" | "160000" | "40000"),
                "GIT_TREE_MODE_INVALID"
            );
            validate_oid(&entry.oid)?;
            validate_relative_path(&entry.path)?;
            ensure!(!entry.path.contains('\n'), "INVALID_RELATIVE_PATH");
            input.extend_from_slice(
                format!("{} {}\t{}\0", entry.mode, entry.oid, entry.path).as_bytes(),
            );
        }
        let env = vec![(
            "GIT_INDEX_FILE".to_string(),
            Self::plain(&index).to_string_lossy().into_owned(),
        )];
        let result = (|| -> Result<String> {
            let args = vec!["update-index", "--add", "-z", "--index-info"];
            self.repo_stdin_env(git_dir, &args, &env, &input)?
                .ensure_ok("GIT_INDEX_FAILED")?;
            let output = self.repo_stdin_env(git_dir, &["write-tree"], &env, &[])?;
            let output = output.ensure_ok("GIT_WRITE_TREE_FAILED")?;
            let tree = output.trimmed()?;
            validate_oid(&tree)?;
            Ok(tree)
        })();
        let _ = std::fs::remove_file(&index);
        result
    }

    pub fn commit_tree(
        &self,
        git_dir: &Path,
        tree: &str,
        parents: &[String],
        message: &str,
    ) -> Result<String> {
        validate_oid(tree)?;
        ensure!(
            !message.is_empty() && message.len() <= 64 * 1024 && !message.contains('\0'),
            "GIT_COMMIT_MESSAGE_INVALID"
        );
        let mut args = vec!["commit-tree".to_string(), tree.to_string()];
        for parent in parents {
            validate_oid(parent)?;
            args.push("-p".to_string());
            args.push(parent.clone());
        }
        args.push("-F".to_string());
        args.push("-".to_string());
        let borrowed: Vec<&str> = args.iter().map(|arg| arg.as_str()).collect();
        let env = vec![
            ("GIT_AUTHOR_NAME".to_string(), self.identity.name.clone()),
            ("GIT_AUTHOR_EMAIL".to_string(), self.identity.email.clone()),
            ("GIT_COMMITTER_NAME".to_string(), self.identity.name.clone()),
            (
                "GIT_COMMITTER_EMAIL".to_string(),
                self.identity.email.clone(),
            ),
        ];
        let output = self
            .repo_stdin_env(git_dir, &borrowed, &env, message.as_bytes())?
            .ensure_ok("GIT_COMMIT_TREE_FAILED")?;
        let oid = output.trimmed()?;
        validate_oid(&oid)?;
        Ok(oid)
    }

    /// Compare-and-swap a reference. `expected` of `None` requires that the
    /// reference does not exist yet. The command runs through `update-ref
    /// --stdin`, whose `create`/`update` verbs express both cases without
    /// assuming any OID length.
    pub fn update_ref(
        &self,
        git_dir: &Path,
        name: &str,
        new: &str,
        expected: Option<&str>,
    ) -> Result<()> {
        self.update_refs(git_dir, &[(name, new, expected)])
    }

    /// Atomically apply several reference updates in one transaction.
    pub fn update_refs(&self, git_dir: &Path, updates: &[(&str, &str, Option<&str>)]) -> Result<()> {
        ensure!(!updates.is_empty(), "GIT_REF_UPDATE_EMPTY");
        let mut input = String::new();
        for (name, new, expected) in updates {
            validate_ref_name(name)?;
            validate_oid(new)?;
            match expected {
                Some(old) => {
                    validate_oid(old)?;
                    input.push_str(&format!("update {name} {new} {old}\n"));
                }
                None => input.push_str(&format!("create {name} {new}\n")),
            }
        }
        let output = self.repo_stdin(git_dir, &["update-ref", "--stdin"], input.as_bytes())?;
        ensure!(
            output.ok(),
            "GIT_REF_CAS_FAILED: {}",
            output.stderr.trim()
        );
        Ok(())
    }

    pub fn delete_ref(&self, git_dir: &Path, name: &str, expected: &str) -> Result<()> {
        validate_ref_name(name)?;
        validate_oid(expected)?;
        let input = format!("delete {name} {expected}\n");
        let output = self.repo_stdin(git_dir, &["update-ref", "--stdin"], input.as_bytes())?;
        ensure!(
            output.ok(),
            "GIT_REF_CAS_FAILED: {name}: {}",
            output.stderr.trim()
        );
        Ok(())
    }

    pub fn ref_value(&self, git_dir: &Path, name: &str) -> Result<Option<String>> {
        validate_ref_name(name)?;
        let output = self.repo(git_dir, &["rev-parse", "--verify", "--quiet", name])?;
        if !output.ok() {
            return Ok(None);
        }
        let oid = output.trimmed()?;
        if oid.is_empty() {
            return Ok(None);
        }
        validate_oid(&oid)?;
        Ok(Some(oid))
    }

    pub fn list_refs(&self, git_dir: &Path, prefix: &str) -> Result<Vec<RefEntry>> {
        ensure!(
            prefix.is_empty() || prefix.starts_with("refs/"),
            "GIT_REF_PREFIX_INVALID"
        );
        let output = self
            .repo(
                git_dir,
                &[
                    "for-each-ref",
                    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)",
                    prefix,
                ],
            )?
            .ensure_ok("GIT_LIST_REFS_FAILED")?;
        let text = output.stdout_text()?;
        let mut entries = Vec::new();
        for line in text.lines().filter(|line| !line.is_empty()) {
            let mut parts = line.split('\u{0}');
            let name = parts.next().unwrap_or_default().to_string();
            let oid = parts.next().unwrap_or_default().to_string();
            let object_type = parts.next().unwrap_or_default().to_string();
            let symref = parts.next().unwrap_or_default();
            validate_oid(&oid)?;
            entries.push(RefEntry {
                name,
                oid,
                object_type,
                symref: (!symref.is_empty()).then(|| symref.to_string()),
            });
        }
        Ok(entries)
    }

    pub fn resolve(&self, git_dir: &Path, rev: &str) -> Result<String> {
        let output = self
            .repo(git_dir, &["rev-parse", "--verify", rev])?
            .ensure_ok("GIT_REV_UNKNOWN")?;
        let oid = output.trimmed()?;
        validate_oid(&oid)?;
        Ok(oid)
    }

    pub fn log_page(
        &self,
        git_dir: &Path,
        rev: &str,
        skip: usize,
        limit: usize,
    ) -> Result<Vec<CommitRecord>> {
        ensure!(limit > 0 && limit <= 200, "INVALID_HISTORY_PAGE");
        let format = "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%(trailers:key=Craftmine-Request,valueonly)%x00%(trailers:key=Craftmine-Task,valueonly)%x00%(trailers:key=Craftmine-Legacy-Revision,valueonly)%x00%(trailers:key=Craftmine-Manifest-Hash,valueonly)%x00%x1e";
        let skip = format!("--skip={skip}");
        let count = format!("-n{limit}");
        let output = self
            .repo(
                git_dir,
                &[
                    "log",
                    &format,
                    &skip,
                    &count,
                    "--no-decorate",
                    "--no-color",
                    "--no-renames",
                    rev,
                ],
            )?
            .ensure_ok("GIT_LOG_FAILED")?;
        let text = output.stdout_text()?;
        let mut records = Vec::new();
        // `%x1e` ends each record, so a trailer value that itself contains a
        // newline cannot split a commit in two.
        for record in text.split('\u{1e}') {
            let record = record.trim_matches(|c| c == '\n' || c == '\r');
            if record.is_empty() {
                continue;
            }
            let mut parts = record.split('\u{0}');
            let oid = parts.next().unwrap_or_default().to_string();
            validate_oid(&oid)?;
            let parents: Vec<String> = parts
                .next()
                .unwrap_or_default()
                .split_whitespace()
                .map(|parent| parent.to_string())
                .collect();
            for parent in &parents {
                validate_oid(parent)?;
            }
            records.push(CommitRecord {
                oid,
                parents,
                author_name: parts.next().unwrap_or_default().to_string(),
                author_email: parts.next().unwrap_or_default().to_string(),
                authored_at: parts.next().unwrap_or_default().to_string(),
                subject: parts.next().unwrap_or_default().to_string(),
                request_id: trailer(parts.next().unwrap_or_default()),
                task_id: trailer(parts.next().unwrap_or_default()),
                legacy_revision: trailer(parts.next().unwrap_or_default())
                    .and_then(|value| value.parse().ok()),
                legacy_manifest_hash: trailer(parts.next().unwrap_or_default()),
            });
        }
        Ok(records)
    }

    pub fn commit_count(&self, git_dir: &Path, rev: &str) -> Result<u64> {
        let output = self
            .repo(git_dir, &["rev-list", "--count", rev])?
            .ensure_ok("GIT_REV_UNKNOWN")?;
        output.trimmed()?.parse().context("GIT_REV_UNKNOWN")
    }

    pub fn is_ancestor(&self, git_dir: &Path, ancestor: &str, descendant: &str) -> Result<bool> {
        let output = self.repo(
            git_dir,
            &["merge-base", "--is-ancestor", ancestor, descendant],
        )?;
        match output.code {
            0 => Ok(true),
            1 => Ok(false),
            _ => anyhow::bail!("GIT_MERGE_BASE_FAILED: {}", output.stderr.trim()),
        }
    }

    pub fn bundle_create(&self, git_dir: &Path, target: &Path, refs: &[String]) -> Result<()> {
        for name in refs {
            validate_ref_name(name)?;
        }
        ensure!(!refs.is_empty(), "GIT_BUNDLE_REFS_EMPTY");
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path = target.to_string_lossy().into_owned();
        let mut args = vec!["bundle", "create", path.as_str()];
        args.extend(refs.iter().map(|name| name.as_str()));
        self.repo(git_dir, &args)?.ensure_ok("GIT_BUNDLE_FAILED")?;
        Ok(())
    }

    pub fn bundle_verify(&self, git_dir: &Path, bundle: &Path) -> Result<Vec<String>> {
        let path = bundle.to_string_lossy().into_owned();
        let output = self
            .repo(git_dir, &["bundle", "verify", &path])?
            .ensure_ok("GIT_BUNDLE_INVALID")?;
        let text = output.stdout_text()?;
        Ok(text
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect())
    }

    pub fn fsck(&self, git_dir: &Path, refs: &[String]) -> Result<GitOutput> {
        let mut args = vec!["fsck", "--strict", "--no-progress", "--connectivity-only"];
        args.extend(refs.iter().map(|name| name.as_str()));
        self.repo(git_dir, &args)
    }

    /// Reject hostile repository configuration before any command relies on it.
    ///
    /// Both `key = value` lines and `[section]` headers are examined, because
    /// Git accepts `[filter "evil"] clean = ...` as well as
    /// `filter.evil.clean = ...`. Command-line `-c` values win over repository
    /// config, but a forbidden key is still refused so no later code path can
    /// silently depend on it.
    pub fn assert_managed_config(&self, git_dir: &Path) -> Result<()> {
        let config = git_dir.join("config");
        if !config.exists() {
            return Ok(());
        }
        let text = std::fs::read_to_string(&config).context("GIT_CONFIG_UNREADABLE")?;
        ensure!(text.len() <= 1024 * 1024, "GIT_CONFIG_TOO_LARGE");
        let mut section = String::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }
            if let Some(inner) = trimmed
                .strip_prefix('[')
                .and_then(|rest| rest.strip_suffix(']'))
            {
                section = match inner.split_once(' ') {
                    Some((name, rest)) => {
                        let sub = rest.trim().trim_matches('"');
                        format!("{}.{}.", name.trim().to_ascii_lowercase(), sub.to_ascii_lowercase())
                    }
                    None => format!("{}.", inner.trim().to_ascii_lowercase()),
                };
                continue;
            }
            let key = trimmed
                .split_once('=')
                .map(|(key, _)| key.trim())
                .unwrap_or(trimmed)
                .to_ascii_lowercase();
            if key.is_empty() {
                continue;
            }
            let full = format!("{section}{key}");
            if let Some(prefix) = FORBIDDEN_CONFIG_PREFIXES
                .iter()
                .find(|prefix| full.starts_with(**prefix))
            {
                anyhow::bail!("GIT_CONFIG_FORBIDDEN: {full} (matches {prefix})");
            }
        }
        Ok(())
    }
}

fn trailer(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Validate a reference name without assuming OID or hash lengths.
pub fn validate_ref_name(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty()
            && name.len() <= 240
            && (name == "HEAD" || name.starts_with("refs/"))
            && !name.contains("..")
            && !name.contains("@{")
            && !name.ends_with('/')
            && !name.ends_with(".lock")
            && !name.contains("//")
            && !name.chars().any(|c| {
                c.is_control()
                    || c.is_whitespace()
                    || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
            }),
        "GIT_REF_NAME_INVALID"
    );
    Ok(())
}
