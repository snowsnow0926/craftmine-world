# ADR 草案（唯一任务标识：`ADR-R6-asset-ui-and-formats-01`，编号由主任务统一分配）

状态：提议（R6 分支已实现，待主任务编号并汇入总表）

## 背景

素材库在第二轮需要同时收尾三件事：把与 R1/M 重复的共享引用实现删掉、给出真正可用的素材
界面、并把“看起来能预览”与“真的能预览”分开。上一轮把 OGG 的容器解析记为 `partial`，
界面侧容易被理解成可播放；GLB 也只有结构解析，没有画面。

## 决策

1. **共享引用只有一份**：`AssetRef`/`FileRef`/`ContentRef`/`BuildRef`/`ProgressRef`/
   `OperationContext`/`AssetLock` 的定义与规范化在 `content_history::contract`（R1/M）。
   素材库只提供 `lock::{entry,build,resolve_closure}` 组装与闭包解析；自建定义已删除。
2. **同一向量、同一结果**：Rust 与 Node 测试都读
   `tests/godot-remaining/M/contract/asset-lock-vectors.json`，任一侧哈希或错误码偏离即失败。
3. **版本是正整数**（CP0），在共享引用里以十进制字符串出现；素材库拒绝 `latest/head` 与
   非整数版本，避免“可移动引用”。
4. **七类内容**：采用 CP0 的 `base/world/module/object/scene/raw/data`；AL 的四种旧名
   仅作为导入别名（`creation→module`、`world-template→world`）。
5. **预览状态必须对应真实解码能力**：
   - 图片 `ok`（真实像素 + 缩略图）、WAV `ok`（真实 PCM）、
   - GLB `partial`（真实 accessor/拓扑解析，`rendered:false`，界面显示“仅结构解析，无画面”）、
   - OGG `failed`（`OGG_PCM_DECODE_NOT_IMPLEMENTED`，`playable:false`，界面永不出现播放器）、
   - Godot 包只做静态引用检查（`executed:false`），真实脚本预览仍走 C/R10 可信执行器。
6. **预览证据强制且可重试**：`ok/partial` 必须有 `decoder` 与 64 位 `digest`，且必须先
   `previewBegin` claim；`failed/timeout/cancelled` 可重跑（`retried:true`），
   `pending/ok/partial` 不重复解码。缩略图只允许 ≤700 KB 的 base64。
7. **界面归 R6、导航归 R2**：素材组件在 `components/craftmine/assets/**`，R2 只做挂载与
   通道白名单；素材服务 `plugins/craftmine-world/asset-service.mjs` 由 R6 提供，R2 注册。
8. **崩溃恢复**：被中断的导入留下 `pending-*` 暂存文件，下次写入前清扫陈旧文件，
   活跃写入者的文件保留；注册事务失败会删除未被任何版本引用的正文。

## 影响

- UI 与宿主之间只需 16 个 `asset.*` 通道；大正文只经 `asset.bodyPath` 走宿主文件读取。
- 预览缓存键含 `contentHash + previewerVersion + engineVersion + settingsHash`，解码器或设置
  变化自动失效。
- 10000 资源检索实测 P50 46–69 ms / P95 62–91 ms、峰值内存 21.1 MB，属于“可检索”而非
  时延承诺；后续若需更低时延应把过滤下推到 SQL。

## 未采用

- 不用 `partial` 表示“容器可解析但不可播放”，避免界面误读。
- 不实现 Vorbis/Opus → PCM 解码（工作量与许可风险未评估），改为严格限定已交付格式。
- 不为模型预览引入离屏渲染器；结构解析与画面渲染分开记账。
