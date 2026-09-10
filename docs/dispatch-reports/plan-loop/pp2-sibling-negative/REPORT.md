# PP2 sibling override: negative baseline

Executed at 2026-09-10T01:24:36.941Z against source checkout `D:/cm-plan-loop-20260910`, commit `5b74d3a743b74b4399f8d40c22edea3842ee6ef0`.

**Result: the mismatch was reproduced. Production guard success is NOT verified.** The runner did not enqueue a product build, apply a candidate, or call a model.

| Actual observation | Result |
| --- | --- |
| Configuration parser accepts patch | 500 ms, changed=true |
| Headless editor import | Exit 0, no script/parse error |
| Actual initialized target value | 700 ms |
| Flash started by real `apply_damage(1)` | 700 ms; material changed |
| After `_process(0.501)` | Flash and changed material remain |
| After another `_process(0.2)` | Countdown zero and original material restored |
| Actual target snapshot | target_a, health 49, hitCount 1, damageTaken 1, destroyed false |

The added `SiblingOverride` node is directly under the world root, beside `Targets`; it is not a target ancestor. The current parser already rejects unknown target-ancestor scripts, and still accepts this fixture.

Identities:

- Adapter SHA256: `f4dd6ef7c25f0d836b721bdb93c220358c9a3c81aee331d30abeeecd28c7f83d`
- Pinned editor SHA256: `ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424`
- Patched scene SHA256: `3b893e8279adcb1f353f88838ae91b8450a15dca9b91270d113c65dd137c545d`
- Fixed sibling script SHA256: `e8f5ca1ba0e344aa258d1b6742a910b291bbabf03c760c99cfa3b567c2f54e11`

Raw artifacts: [report.json](D:/cm-plan-docsearch-20260910/test-results/target-sibling-ysPolW/report.json), [import.log](D:/cm-plan-docsearch-20260910/test-results/target-sibling-ysPolW/import.log), [verify.log](D:/cm-plan-docsearch-20260910/test-results/target-sibling-ysPolW/verify.log). The exact generated scene and script remain under that directory's `project` folder. Temporary files are not committed.

The reusable helper and invocation contract are documented in [TARGET_FEEDBACK_SIBLING_NEGATIVE_BASELINE.md](../../../spec/TARGET_FEEDBACK_SIBLING_NEGATIVE_BASELINE.md). The next acceptance must pass this fixture through the real runtime expectation guard and prove the overall check fails and no applicable candidate is produced. It must not reinterpret this baseline as successful enforcement.
