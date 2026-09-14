# Godot docs API reachability evidence

```powershell
node --test tests/godot-agent/docs-api-tool.test.mjs tests/godot-agent/engine-api.test.mjs tests/godot-remaining/L/docs.test.mjs tests/godot-remaining/L/docs-chinese.test.mjs
```

The API tool test builds its own uniquely named temporary plugin fixture and
removes only that verified owned directory afterwards. No earlier test or
`test-results/docs-api-plugin` preparation is required. To test a specific
existing package, set `CRAFTMINE_DOCS_API_PLUGIN` to its plugin directory; that
explicit directory is read only, never rebuilt or deleted by test setup.

All 24 focused tests pass. The new tests run the actual installed PI SDK's
argument validator using the actual packaged manifest, then execute packaged
`world-tools` against the pinned ClassDB. A frozen copy of the real prior
preview25 manifest tool definition reproduces validation rejection for the same
NavigationServer3D class query.

Measured NavigationMesh, NavigationServer3D and NavigationAgent3D methods retain
their true argument/return types. Tests cover exact continuation pins, distinct
pages, unknown class/member, engine/hash mismatches, forbidden arbitrary fields,
the unchanged digest body hash and explicit zero-match/API guidance. Core and
world-setting callbacks are configured to throw if invoked and remain unused.

The original 7aa4fb707c77 package has the same 6,284,092-byte corpus hash
`8dd5a762b893919963b1256300800e2db2d44c6f624a5488d58568f890a4e2a9`,
with 1,054 classes and 17,008 methods. Its five navigation signatures were
present before this change; only the schema made them unreachable normally.
Local read-only audit: `test-results/navigation-docs-api-audit.json`.
No active application, model, GPU, network or engine process was used; the
ongoing A6 package and original queries were left unchanged.
