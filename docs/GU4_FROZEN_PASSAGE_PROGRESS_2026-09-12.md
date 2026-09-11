# GU4：把门通行接入宿主冻结要求和核心判定

基线 `e4f8504f`；工作树 `D:/cm-gu4-frozen-0912`；分支 `codex/gu4-frozen-requirements-20260912`。

本批新增的通行要求进入既有核心需求链，会影响候选是否 ready。前两批的通用 `scenarioDiagnostic` 保持仅诊断，没有被直接提升为通过依据。

## 审计发现与对应处理

| 链路 | 原实现与缺口 | 本批处理/剩余范围 |
|---|---|---|
| 宿主冻结 | `creation-target-service.ts:206` 调用 freezer；原顺序门只有 ID/顺序 | 新冻结要求默认增加 verifyPassage=true，冻结门和机关位置/尺度 |
| 模型工具到作业 | `world-tools.cjs:232` 从宿主捕获插入要求 | 复用原链，不给模型传任意测试 JSON；本批未改工具文件 |
| 核心保存与恢复 | `godot_check_requirements.rs` store/read/attach 已保存哈希；继续任务沿用原要求 | 可选字段纳入原哈希，旧任务无字段继续兼容，无 schema migration |
| 实例试玩 | `creation-door-verifier.ts` 原先仅检查开门状态和机关顺序 | 在同一独立 check 实例追加关闭/开启后的真实 walk，记录实际位置和 physics tick |
| 运行可信边界 | 固定 adapter/bridge 已保护，原 controller/camera 未保护 | 新要求额外校验两份固定源码及别名；自定义控制器明确 unsupported，不修改源码；动态脚本替换等更强对抗仍未覆盖 |
| 核心 finish | 原 doorTrace 无位移要求，只有 doorOpen/interacted | 末项 passage 固定结构，由 Rust独立验位置、实例、目标、帧数；缺证据或伪造通过布尔不能 ready |
| 采用前绑定 | `creation-edit-guards.ts:48` 原来已调用 assertCreationJobRequirements | 保留原始 capture/job 哈希比对，去掉 verifyPassage 后的新哈希不能采用 |
| 通用场景 | 任意 scenario 仍只在诊断接口中 | 没有引入通用核心场景 DSL；本批只完成固定顺序门的通行要求 |

## 实际结果

- 15 项 Rust requirements 回归通过，含真实 SQLite/核心 finish/candidate、旧协议、持久恢复，以及将真实 Web 证据原身份原数值交给 Rust 校验。
- 30 项 TypeScript 冻结、目标服务和通行判定回归通过。
- 完整桌面 TypeScript 检查通过。
- 现有 `creation-requirements-web.mjs` 全部通过，证据：`test-results/creation-requirements-web-RnnrBj/report.json`。
- 新实际 Web 双负例通过，固定引擎 `4.7.2.stable.official.ed1daf0bf`，证据：`test-results/creation-door-passage-web-hIokg6/report.json`。

| 真实变体 | 关闭后位置 Z | 开启后位置 Z | 结果 |
|---|---|---|---|
| 正常门 | 0.550075948238373 | -16.7221946716309 | 通过 |
| 幽灵关门，无阻挡 | -16.7055282592773 | 未继续 | CLOSED_NOT_BLOCKING |
| 开门后保留碰撞 | 0.550075948238373 | 0.550075948238373 | OPENED_NOT_TRAVERSABLE |

两次测量均从独立 setup 的 Z=1.25 开始，随后由实际控制器跨 240 物理帧移动；setup 位移不计作通行。关闭时射线命中同一 door-a，开启阶段必须越过该门原碰撞 AABB 后侧。三变体 Pointer Lock/focus 计数均为 0。

本次冻结需求 SHA-256：`2f4c5e9725e142b88edc60125a9bf45f8390103e0a1fb344a6026f21af82bedf`。真实 Web 证据 fixture 保留原 job/world/build/instance 标识，Rust 没有重写身份来制造通过。另行的核心 candidate 测试明确使用 authored executor 数据，验证正常 ready、缺 passage/幽灵位移/弱化哈希均 rejected，正式世界快照不变。

## 支持边界

支持固定 creation 控制器的顺序门通行，声明过新要求才增加源码约束。自定义 controller/camera、不可达 setup 或不支持的几何明确失败，原源码保留，不能自动换回旧控制器。旧已存任务不追溯加限制。

没有证明玩家能从任意出生点到达机关、钥匙条件、宝箱一次奖励、冷重开、完整导航、截图外观或玩家体验。也没有重跑本批完整 LPAC→真实核心作业→自动采用的单次生产故事/安装包。任意作品脚本动态替换 Player 或额外推动角色的强对抗能力不在当前证明内；固定源码不是整个游戏脚本不可干预物理的保证。

普通玩家原始需求没有被改成纯门状态展示。本次无模型调用、无额外玩家 token/次数/整轮上限，无真实输入或前台窗口操作。

准备记录保留：首次 Node 运行缺 `.ts` 导入扩展名，未启动引擎；首次 Rust 过滤器没命中测试，未算成功验证。首轮 ghost 使用可见网格 AABB，门把手使中心偏移，明确返回 LAYOUT_UNSUPPORTED；随后改用只用于失败采样且永不允许通过的冻结底座门框，实际 walk 证明穿透。早期报告 `creation-door-passage-web-et5gYD` 与 `wBQ69w` 保留；最终报告另外生成。

技术契约：[冻结门通行要求](../vendor/pi-desktop/docs/spec/creation-door-passage-requirements.md)。
