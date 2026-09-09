# Independent copied-world runtime identity

Private godotWorld.prepareCopyRuntime({worldId}) now follows prepareRebuildSource. Non-copy or independently applied targets return copied:false. Inherited copies preserve the protected exact copied-formal parent, then derive a protected copied-runtime child. Each read verifies its Git parent and every expected file byte; replay cannot accept a modified ref as an identity transformation.

Only fixed metadata tokens change:

- project.godot: the single [craftmine] runtime/world_id string.
- Top-down: world.json root worldId.
- Side-view: worlds/default.json instanceId, worlds/<template>/world.json root worldId, optional MATERIALIZED.json root worldId and instanceId. The default worldId is a template directory selector and stays unchanged.
- First-person: no additional native identity data file.

JSON replacement preserves all non-token bytes, nested same-named fields, scripts, assets and gameplay data. Foreign identities, duplicate identity keys, unsupported schemas/bases and outer managed-base.json manifests reject. The product initializer excludes its outer managed-base.json from core source, so normal product projects are supported. No game progress is assigned or rewritten.

The receipt contains contentOid, sourceParentOid, transformHash and proof.changedFiles with original/new raw-byte hashes. A fresh main still equal to exact formal parent is CAS-advanced to the same identity child. An existing unpublished main is transformed independently from its own current head and CAS-advanced, preserving its gameplay bytes; draftTransform records that separate parent/child/hash. A target-bound draft is strictly checked and left intact. Mixed or unknown draft identities fail with GODOT_COPY_DRAFT_IDENTITY_REBIND_REQUIRED.

The formal rebuild plan uses only the formal identity child, never the unpublished draft. It exposes identityRebindRequired and identityTransform. Inherited source artifacts cannot serve a copy: runtime.describe rejects GODOT_COPY_REBUILD_REQUIRED and initStatus reports playable:false/rebuildRequired:true until the target completes its own normal build/check/application. Metadata-only access still verifies the source's formal evidence for recovery. The restore service now calls prepareCopyRuntime before reading the final plan; host routing and automatic copy startup remain root-owned.

Evidence: exact-byte transforms cover all three base schemas, including binary and nested identity preservation. Real Git/SQLite/archive regression covers replay, interrupted parent ref, main CAS, unpublished draft preservation, portable recovery with original source unavailable, independent target check/apply, unchanged progress, and copying an independently applied copy. Executor/application evidence in this core regression is deliberately synthetic; actual game execution is the parent client harness's responsibility. Raw fixture setup failures (workspace binding and unavailable executor after restore) are retained in copy-runtime-02/03.log; both were corrected in the fixture without weakening core guards.
