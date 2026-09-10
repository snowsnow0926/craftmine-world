# Exact restore conflict recognition through production IPC

The complete-client runner at source `ae32974eed097c9b3308ae53c95ca7533e03532a`
passed 50 steps and stopped at the deliberate stale-backup restore. The product
returned `BACKUP_CURRENT_HASH_CONFLICT`, wrapped by Electron's
`pi-plugin-panel-invoke` error serialization. The test expected an unwrapped error.
This was a test failure, not proof that restore or progress preservation passed.

The helper now unwraps only the observed `Error: ` prefix and exact Electron
channel prefix before requiring equality with the product error code. A timeout,
another channel, a suffix, or a multiline message cannot satisfy the assertion.
The subsequent complete progress comparison and fresh archive inspection remain
mandatory. The correction does not change the application or restore behavior.

Original evidence remains immutable in the release run
`ae32974eed09-f8b7f079-cede-45ab-814d-9df632e7b101/delivery/acceptance/complete/`
and the independent private profile
`C:/cm-release-test-20260910/test-results/desktop-native-complete-UqYcKp`.
Its result is failed, with 50 passed steps and seven clean shutdown audits.
Normal restore and the final restart were not reached in that run.

Validation: `node --test tests/player-product/complete-exit-contract.test.mjs`.
The original failing production message is exercised alongside rejection cases.
A corrected actual-client run must be recorded separately; this unit test does
not turn the preserved failure into a passing acceptance record.
