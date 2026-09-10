# Offline Chinese Godot documentation retrieval

Baseline: master `d7ef26b`. This slice changes only the existing `godot_docs`
retriever, its behavior tests, and this specification. It does not implement
Skill loading, change tool permissions, run a model, or establish an efficiency
improvement.

## Behavior

The previous ASCII-only tokenizer rejected every pure Chinese query. The corpus
is still the same 16 English reference digests. Reviewed Chinese search labels
now identify topics actually covered by those documents. Simplified Chinese and
a bounded set of Traditional Chinese aliases are supported; this is not a full
translation or general semantic search service.

Each exact Chinese alias present in the query contributes six ranking points to
its associated document. Contained aliases contribute only once. The response
includes `matchedAliases`, allowing the caller to see which part matched.
Existing English token scoring and deterministic document-ID tie breaking stay
unchanged. Mixed-language queries combine the two scores. A matching fragment
means relevant reference material, not proof that the entire requested feature
is supported. Unknown Chinese/unknown mixed queries return zero matches; empty,
punctuation-only and oversized queries retain validation errors.

Examples verified against real corpus bodies:

| Query | Existing reference |
| --- | --- |
| 如何让准星居中？ | `ui-control` / Crosshair overlay |
| 如何保存玩家进度和恢复存档？ | `state-and-save` / Restore must be total |
| 俯视游戏的瓦片碰撞 | `top-down-2d` / Tile maps and collision |
| Camera3D 准星射线 | `camera3d-and-rays` ranked first |
| 量子纠缠传送系统 | No matches |

`searchVersion: 2` and `searchDigest` identify the retrieval labels independently
from `corpusVersion: 1` and the unchanged `corpusDigest`. The search identity is
available in info/search results. Read pagination, citation, untrusted-reference
markers, engine compatibility checks, query/result limits, and body text remain
unchanged. No network, filesystem-read authority or provider fallback is added.

## Verification

Run:

```text
node --test --test-isolation=none tests/godot-remaining/L/docs.test.mjs tests/godot-remaining/L/docs-chinese.test.mjs
```

The new tests exercise Chinese and mixed search, unknown topics, explicit alias
evidence, unchanged English ranking and corpus hash, topic filters, limits, and
complete paged reconstruction of a retrieved body. These are direct behavior
tests of the production corpus module, not simulated model judgments.

Executed locally on 2026-09-10: **12 passed, 0 failed, 0 skipped** (seven
existing documentation tests plus five new retrieval tests). No provider,
browser, engine or credentials were accessed.
