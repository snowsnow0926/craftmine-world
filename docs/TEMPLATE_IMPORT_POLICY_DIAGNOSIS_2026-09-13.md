# Template component republication: missing import policy

The player UI could list an installed Pom in a copied template world, but saving
that component failed with the unsupported-dependency message. The source tree
and metadata in the managed template directory contained all seven declared Pom
files with correct hashes, and the selected collision-runtime profile matched.
The problem was the next stage: the ordinary world initializer filtered by a
suffix allowlist that omitted `.import`.

Read-only comparison of the isolated native profile found the original source
HEAD included `addons/cw.module.approved-pomeranian/model.glb.import`, whereas the
copied source HEAD did not. Parent native verification then confirmed:

- Original `world-c59de7f0f0a1`: source index contains the 81-byte file and native
  read returns SHA-256 `2b69138fb4ba7d7b5703fc7e64b289db89bae9f81741fd971e71107166b6b8e8`.
- Copied `world-4325e4e7d705`: source index omits it and native read fails
  `PROJECT_FILE_NOT_FOUND`.

The exact native diagnostic is retained at
`D:/Craftmine Worktrees/player-library-20260913/test-results/desktop-native-library-ui-EVH75T/sidecar-native-diagnostic.json`.
No SQLite reads, source repairs, model calls or changes to old evidence were
used. The package source exporter correctly rejects the missing managed file;
weakening that declaration check would conceal the initialization defect.

The fix admits only paired authored `.glb.import` policy files into normal
initialization, keeps hash checks and native Core policy validation, and excludes
generated `.godot` directory content and unrelated `.import` files. An orphan
policy is an explicit preparation error. The model is sorted before its policy,
so Core sees it either in the same request or in already committed source when
the serialized request is split into batches. Rust behavior is unchanged.

Validation: 32 initializer tests pass, including the new inclusion/cache/orphan/
batch scenarios and existing cancel, terminal-state and job-stage tests. Those
tests use a controlled domain fixture, not a real engine. Parent integration
will create a fresh template copy through the real PI UI and perform native
index/read, component publication and cross-profile reuse. The previously failed
world remains unchanged and is not counted as a repaired success.
