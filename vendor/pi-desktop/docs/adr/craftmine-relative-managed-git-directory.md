# Preserve isolation while shortening the explicit managed Git argument

Status: accepted.

Portable restore adds an owned target directory below plugin data. Combined
with the managed repository identity directory, it can exceed Git for Windows'
early explicit-directory argument limit even when normal repository creation
and filesystem operations work.

Keep the existing neutral child working directory and every isolation override.
For repositories under the same private parent, pass the equivalent relative
`--git-dir` instead of the full absolute spelling. This avoids a data-layout
migration, shorter identity hashes, global configuration changes, drive aliases,
filesystem links or repository discovery. Buffered and streamed paths agree.
Unrelated roots retain the old explicit-path behavior.

See `../spec/craftmine-backup-long-git-paths.md` for the actual failure and tests.
