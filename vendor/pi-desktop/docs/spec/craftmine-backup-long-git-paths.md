# Managed Git paths during portable restore

The preview 7 complete-client run passed 51 steps, then portable activation
failed while restoring Git objects. Its durable receipt retained the precise
cause: `BACKUP_OBJECT_RESTORE_FAILED: git exited 128: fatal: '$GIT_DIR' too big`.
The source installation and failed receipt are preserved.

The shipped Git for Windows checks the literal explicit Git-directory argument
length during setup, before repository work proceeds. Setting core.longpaths
does not bypass that check. See the [Git for Windows 2.53.0 setup source](https://raw.githubusercontent.com/git-for-windows/git/v2.53.0.windows.1/setup.c).

GitAdapter now expresses a managed repository under the configuration's private
parent relative to its existing neutral `git-config/work` working directory.
Both buffered and streamed invocations use the same mapping. The destination,
object bytes, repository identity, command allowlist, environment, hooks policy
and neutral process working directory are unchanged. Raw commands do not start
discovering a repository. Paths outside that private parent retain the existing
explicit path behavior. This does not promise arbitrary Windows path lengths.

Two real regressions failed before the change with the exact Git error and pass
after it: object write/read/stream operations under a long managed path, and
portable restoration into a long target followed by reopening the restored
database and checking its content hash. The object test also checks neutral raw
commands and isolation from the host's Git identity. Run
`cargo test -p craftmine-core long_managed_git_paths`, then the full core suite.
