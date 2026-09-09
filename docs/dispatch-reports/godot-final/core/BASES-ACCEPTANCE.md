# Fixed town / ruins client acceptance helper

The new craftmine-godot-bases-acceptance.ts module exports:

- createGodotBasesAcceptance({observe, action, capture, save?}) returning a function accepting only godotPlayTown or godotPlayRuins.
- godotPersistentProgress(snapshotOrBareState) extracts complete native progress.
- compareGodotPersistentProgress(before, after) returns equal, hashes and JSON-pointer differences. It ignores transport wrappers, never native-body fields, including unknown extensions, savedAt, placement, facing, health and timer fields. Ordinary observations cannot replace complete saves.

The caller must provide an actual selected, freshly initialized town or ruins runtime. The module pauses, snapshots, resumes, follows the existing cycle06 controlled movement route, collects live observations and 1280x720 PNG captures, pauses and optionally saves. Town additionally talks to Mira, then verifies gathering, delivery, shop transition, purchase and facing. Ruins verifies the actual room transition, ability pickup and attack target health. No snapshot assignment, teleport, OS input, model or private test state mutation is sent.

The trusted action callback must support snapshot/pause/resume via the actual host plus existing move/gather/talk/deliver/buy/control operations. The save callback returns the actual persisted core receipt. The module returns ok=false and partial raw evidence on rejected operations or assertions; callers must inspect ok, not just RPC success. Both success and failure leave the runtime paused. A failing capture may still retain its raw bytes.

The caller owns actual process restart, backup rebuild and pixel-content inspection. Capture checks here prove only PNG prefix, dimensions and runtime viewport correspondence. This helper does not claim model acceptance, live execution, backup restore or a release.

Validation: standalone strict TypeScript check passed; tests/godot-bases-acceptance.mjs passed 5 pure helper/failure-fixture checks, including complete native field differences, observation refusal, fake successful actions failing inventory checks, and runtime identity changes. No engine/client run occurred in this subtask. Real integration is assigned to root.
