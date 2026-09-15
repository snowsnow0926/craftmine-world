# Reviewer launcher source

These are the exact launchers delivered with the September 15, 2026 Windows
preview.28 reviewer bundle. They do not contain an API key.

To assemble that private bundle, copy both launcher files to the extracted
portable package root, alongside `output/win-unpacked`, and separately provide
the authorized reviewer credential as `评委用apikey.txt`. The default public
export does not automatically add a credential or these reviewer launchers.
The launchers are pinned to the validated preview.28 host binary.

`START-REVIEWER.cmd` uses Windows PowerShell 5.1. Its first run configures the
bundled native host through JSON-RPC in a fresh staging profile, checks settings
and Windows DPAPI decryption in two host processes, then publishes the fixed
reviewer profile. Later runs preserve the player's existing settings and worlds.
The script source is distributed directly under AGPL-3.0-only.

Configuration: DeepSeek, `deepseek-flash`, highest (`max`) default reasoning,
1,000,000 context tokens, 384,000 maximum output tokens, and the provider world
backend (`pi`). This is the delivered configuration, not a live capability claim
for another model, account, service, or future version.

The delivered scripts passed ten Windows launcher checks and a separate
headless application check showing `deepseek-flash · 最高` in the creation
workbench. The final private package also completed an initialization-only run
with its supplied credential. No generation request was sent by these checks.

See [the illustrated guide](../../docs/reviewer/CONNECT_AI.zh-CN.pdf),
[the browser version](../../docs/reviewer/CONNECT_AI.zh-CN.html), and
[the submission record](../../docs/SUBMISSION_COMPLETED_2026-09-15.md).
