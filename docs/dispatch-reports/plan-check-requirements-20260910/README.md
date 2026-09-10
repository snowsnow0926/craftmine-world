# Finite check requirement core/executor evidence

Base: 5b74d3a. Own worktree: D:/cm-plan-checks-20260910.

- cargo test -p craftmine-core --offline: 282 passed, 7 existing ignored; one existing doc test ignored.
- cargo test -p craftmine-core --offline finite_requirements -- --nocapture: 5 passed. The log includes actual core job/check/candidate output for 16 negative cases and a successful restart replay. Executor evidence is explicitly authored; no engine is launched by these tests.
- node --test tests/godot-remaining/C/executor-protocol.mjs: 26 passed, including 7 new requirement cases. The real supervisor consumes scripted broker/core fixtures; this is protocol evidence, not native acceptance.

The first development runs failed because the new Rust fixture read candidate.status rather than candidate.candidate.status, and a text edit missed the executor-local required declaration. Both test/implementation mistakes were corrected before these final runs; initial tool outputs remain in the task history. They are not reported as engine or product failures. Existing compiler warnings remain.

The producer and actual native verifier belong to separate coordinated changes. This evidence does not claim native engine, full client, model, release-package, or arbitrary future script behavior verification. No model/provider calls, credentials, OS input, visible windows or Pointer Lock were used.
