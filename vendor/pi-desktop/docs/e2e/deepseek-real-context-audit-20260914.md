# Read-only audit of the first retained-task DeepSeek run

The integration run used source `59af14d2`, an independent profile at
`D:/cm-deepseek-player/test-results/desktop-native-product-oUgGvo/profile`, session
`6e7919a4-0c1f-4deb-af6e-2d447b0ea8b8`, and turn
`13f568f7-a73a-4796-8322-d7594c843fa7`. It completed 40 provider requests and
reported 1,100,433 total tokens, including 11 new compactions. This record does
not claim that the subsequent fixes were present in that run.

## Actual thinking configuration

Read the independent profile's provider configuration from SQLite opened with
`readOnly: true`, selecting only provider identity, endpoint and model bindings.
The binding enabled only max, selected `deepseek-flash`, context 500000 and output
384000. The running tree's bundled catalog SHA-256 was
`877e9e0c4dd81f1c44ba9ffc2f0a1887077b215d6934d7ccad81e3c7de280eb2`.
The actual `ModelsDevCatalog.findModel` found no alias match across 7570 models.
The normal `ensureLoaded` path loads only the bundled catalog; the test driver
and operator confirmed no explicit in-memory remote refresh occurred.

Following the real generic-model → model-binding → pre-fix runtime-model path
yielded `reasoning=true`, supported levels `[max]`, and no `thinkingLevelMap`.
The pinned PI SDK therefore clamps the selected max to high. This is a confirmed
configuration-path finding for this run; the localhost wire test separately
proves serialization. It does not claim that HTTP request bodies were logged by
the live run. Commit `6575729b` fixes the missing alias/effort override and must be
present before a subsequent true-max acceptance run.

## Why 11 compactions still occurred

The 96859 complete-input threshold was active. The displayed checkpoint
`tokensBefore` values of 45849–61639 come from PI's separate history estimator;
they are not the Craftmine complete-request estimate used by the guard.

Every new checkpoint retained only the current 20-character user continuation,
141 UTF-8 bytes including its JSON representation. Summaries were approximately
9–11K characters. There was no retained-tail duplication of the entire history.

The persisted UI envelope for the last facts read occupied 112671 characters,
and build read 99971. These include both content and the UI `details` mirror.
They are **not** the transmitted model content size: runtime hydration extracts
content blocks, and the estimator deliberately excludes details. The actual
facts text was 61667 characters / 62525 UTF-8 bytes; build text was 52000
characters / 53588 bytes. Their serialized content alone contributes approximately
33932 and 29163 conservative input tokens, respectively.

Reconstruct each boundary using the actual PI entry hydration, prior checkpoint,
`buildSessionContext`, `convertToLlm` and `estimateCraftmineRequest`. Match all
29 usage-bearing assistant messages, in order and exact reported totals, to the
29 Core creation-request ledger entries. The remaining 11 requests are summaries.
Subtract reconstructed history from each preceding physical reservation to find
the combined system/tool/host contribution: approximately 20.8–21.8K estimated
tokens. Carrying that previous request's overhead forward gives this comparison:

| Checkpoint generation | Reconstructed next input | Same frozen boundary with draft compact tool projection |
| --- | ---: | ---: |
| 9 | 104642 | 104642 |
| 10 | 117731 | 100098 |
| 11 | 104449 | 75557 |
| 12 | 100878 | 71987 |
| 13 | 102299 | 73408 |
| 14 | 100300 | 71408 |
| 15 | 119391 | 90499 |
| 16 | 97297 | 68406 |
| 17 | 97603 | 68711 |
| 18 | 97964 | 69072 |
| 19 | 103835 | 74944 |

This reconstruction uses the preceding request's observed reservation overhead,
not a captured next-request host snapshot. Small subsequent host changes are not
claimed exact. It explains why the guard fires: all old boundary estimates exceed
96859, including repeated facts/build retrieval immediately after summaries.
The first two boundaries also contain substantial real reasoning/source history.

The comparison used the independent driver's draft `compactGodotProjectFacts` /
`compactGodotBuildRead` on exactly the same decoded text blocks, with the runtime
guard unchanged. Nine frozen boundaries cease to cross the threshold. This is
**not a prediction of two compactions for a new complete run**: skipping one
compaction accumulates different subsequent history and changes model behavior.
A real rerun must validate the final committed projection and max effort.

Local audit scripts and numerical reports are retained in this request tree's
ignored `test-results`: `audit-real-deepseek-config.mjs`,
`real-deepseek-config-audit.json`, `audit-real-compaction-input.mjs`, and
`real-compaction-input-audit.json`. They read the independent profile only and
write their reports in the audit tree. No player credentials are selected or
printed, no profile files are edited, and no model/GPU calls occur.
