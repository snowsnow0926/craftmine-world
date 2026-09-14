# Guidance current cohorts and query resource aliases

## 2026-09-14：目录1.8.2的固定包装链扩展

原两个cohort条目和指导正文/必需引用hash完全保留。增加四个独立完整配置：

| profile | 文件数 | picker / engine |
| --- | --- | --- |
| creation-fixed-controller-ray-local/1 | 11 | ray-local picker；原bridge |
| creation-player-collision-ray-local/1 | 13 | ray-local picker；原bridge |
| creation-fixed-controller-engine-preview/1 | 13 | ray-local picker；完整preview包装链 |
| creation-player-collision-engine-preview/1 | 15 | ray-local picker；完整preview包装链 |
| creation-legacy-engine-preview/1 | 10 | 原legacy adapter；完整preview包装链，无v2 picker |

集成`0f01c2e0`后，factory默认在所有creation controller模式加入preview引擎。因此额外登记legacy controller加完整preview链的真实10文件组合，前六个条目不变。历史fixture完整保留旧bridge/旧picker及无wrapper helper的状态；另有测试对当前三种controller的**未改动factory输出**逐一匹配完整preview配置。裸legacy adapter本身不代表engine扩展，已知顶层engine bridge本身却必须触发完整链验证，不能删除两个helper后降为legacy通过。

新增preview桥LF hash为`938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08`；picker LF hash为`09b64ed260b83dd9b3c0559868d6ee3c34ece69876266154b3821ce166865acd`。LF/CRLF各自完整hash在审阅目录中固定；包装链必须包含原bridge的实际继承文件及engine_performance。每个variant是完整组合，不允许旧picker与新包装链混搭。未知受控脚本、受控路径大小写/bytecode/remap别名及缺失成员拒绝；非受控的自定义场景脚本不因此受写入限制。

`referencePaths`仍将必需adapter引用指向确切legacy文件，并标明runtime_bridge对应runtime_bridge_base。所有原必需引用仍逐项读取并核对精确hash及相同source identity；不扩大自定义creation_world/scene_contract的适用条件。

从本版本起，`scripts/refresh-guidance-cohorts.mjs`使用人工审阅的`guidance/interface-cohorts.json`，`--check`检查目录与interfaceHash一致；写入模式拒绝删改已发布profile，**不再从当前materializer覆盖旧条目**。下面关于原刷新器按materializer生成的文字仅描述1.7.0历史实现。

新增`tests/creation-guidance/engine-cohorts.test.mjs`覆盖六个完整组合及反例；`fixtures/city-rev9-interface.json`明确只是实际城市索引中的受控接口子集，非完整manifest或新的运行证明。已有current-cohorts测试仍用真实旧picker存档验证原版，并用当前factory资源验证新增ray-local组合。任何源码刷新必须按版本新增，不得将GUIDANCE_INTERFACE_UNSUPPORTED解释为玩家源码不可改。

The ordinary `863622e9` player turn encountered two read-only discovery failures:
`godot_guidance catalog` rejected the current v2 adapter, and passing summary's
`res://scenes/creation.tscn` unchanged to the scene query failed. The model could
continue reading source, but these responses made advertised tools inconsistent.

## Guidance applicability 1.7.0

The creation skill retains the three existing recipe interface conditions:
`scripts/creation_world.gd`, `scripts/scene_contract.gd`, and the exact original
adapter functions. No accepted hashes for the mutable world/contract are widened.
Legacy guidance behavior is retained. A legitimate unsupported source edit still
means the recipe is inapplicable, not that the source is protected from editing.

For current profiles, the catalog additionally pins the entire materialized
shared-script group and native player/camera scripts: 10 files for
`creation-fixed-controller/1`, 12 for `creation-player-collision/1`. The corpus is
generated from actual `materializeBase` output and checked against the common Main
observer classifier. The guidance condition is explicitly stronger than the
8-file v1 observer gate; neither condition alone supplies runtime evidence.
Each path is unique and its full source SHA-256 must match the LF or CRLF variant.
New adapter only, missing/changed/duplicate members, and mixing a legacy/v1 top
adapter with later profile helpers are rejected. Unrelated authored files remain
allowed. No player script is executed to infer compatibility.

Modern profiles retain the original adapter in `base_adapter_legacy.gd`.
`interfaceMatches` identifies the matched profile and `referencePaths` mapping;
the archived guide/reference text and its SHA-256 remain distinct from the
current top-level adapter. The original required adapter reference is checked
at the inherited path only after the complete modern group matches. Exact skill
version and body/reference hashes remain mandatory. `interfaceHash` covers both
the recipe interface references and the complete cohort declaration; `catalogHash`
covers the published catalog as before.

`scripts/refresh-guidance-cohorts.mjs` is developer-only and not packaged. Its
`--check` mode fails on materialized/cohort or interface-hash drift. Publishing a
different source group still requires review and a versioned guide/corpus update;
the runtime never refreshes pins from the player's source.

All applicable creation catalog/read calls obtain the complete index via pinned
pagination, validate total/unique files and source identity, then read the
required recipe interfaces at the same revision/hash. Activity is checked after
each asynchronous source call. This adds no new write, execution or adoption path.

## Query paths

The structured source query's scene, script, resource, symbol-file selector and
text-reader paths accept either a canonical relative manifest path or an exact
`res://` prefix followed by that path. Responses use canonical relative paths.
Validation rejects empty/dot/dot-dot segments, leading/repeated slashes, backslash,
colon/other schemes, and control characters. It performs no URI percent decoding,
filesystem resolution, drive access or project script execution. A valid-looking
alias still has to exist in the bound source manifest before a scene is read.
Unicode and spaces in legitimate manifest paths remain supported.

Summary preserves `mainScene` as authored in `project.godot`, and adds
`mainSceneSourcePath` only when an explicit resource path resolves to a scene
manifest entry. UID, missing, non-scene and unresolved paths return null. No UID or filesystem lookup
is invented. Write tools, file grants, Core path checks and source CAS are unchanged.

## Validation and limits

`tests/creation-guidance/current-cohorts.test.mjs` uses actual materialized source
through `createWorldTools`, including every modern member's missing/changed
variants, retained legacy references, mixed groups, exact version/hash, CRLF,
multi-page identity/duplicate failures, and summary-to-scene alias roundtrips.
The production packaging test builds an isolated plugin and reruns the same
7 cases against its real broker closure, with an explicit assertion that all
7 child tests ran and passed. Source and packaged host RPCs are test doubles;
this proves source/broker/packaging compatibility, not a model/engine/player turn.
No current sealed build or existing player profile is modified by these tests.

Validation completed: 48 source/parser/guidance/packaging tests passed, including
the real packaging test's additional 7 child tests against its built plugin.
