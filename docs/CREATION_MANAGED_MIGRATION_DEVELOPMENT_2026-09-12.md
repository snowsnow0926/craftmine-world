# 托管源码兼容升级开发记录

分支：`codex/managed-migration-20260912`。保留普通源码，增量更新已知固定观察器；完整合同见 [ADR](CREATION_MANAGED_MIGRATION_ADR_2026-09-12.md)。

## 验证范围

Windows 定向测试实际 16 项通过（15 项常规回归＋1 项真实 PET 源码字节回归）；桌面 TypeScript 检查通过。

定向测试覆盖旧 preview.10 联动升级、当前保护文件不动、普通源码修改、精确兼容目标、LF／CRLF、缺失 helper 添加、同名 helper 冲突、未审核 protected 字节、未知目标字节、完整清单比对、CAS 冲突、丢回执／丢绑定记录后的恢复和跨 turn 重试。

实际已采用的 PET 源码读取了根任务提供的构建目录，取项目设置、三个固定文件、`creation_world.gd`、`scene_contract.gd`、`pet_dog.gd` 共七个文件。使用真实文件字节运行迁移服务与模拟 CAS／回执，结果只修改 adapter，其余六个文件 SHA-256 保持不变。其中：

- `creation_world.gd`：`459c4fe1af2d7a93847614bec93a994b7a0772abaf48c15b07b818e57592c1ff`。
- `scene_contract.gd`：`2a8c1b17fef37d5f2d7f754886459402698ef03fa11bc0cd2a2c7622b2bb2551`。
- `pet_dog.gd`：`cccc00c034e046251604622f37a0c77e6227484b864c847082e5e0c8e48f80cd`。

最终原始报告保留在 `test-results/managed-pet-source-RtXbeN/report.json`，不是产品引擎运行证据；没有复制测试 profile、凭据或个人数据进 Git。永久回归使用明确标记的夹具，额外真实字节回归通过 `CRAFTMINE_REAL_MIGRATION_SOURCE` 指向已导出的源码目录执行。

本轮不调用模型、不启动游戏、不修改原 PET 世界，不生成安装包，不改 guidance generator。正式旧宠物世界升级后的真实检查、采用、重开仍由总控集成后验证。
# 最终集成记录

总控将生产记录更新为 `scene-selection-and-input-20260912-v2`：允许已知
940／141 adapter 和原 runtime bridge 的确切字节升级，新增两个固定文件
`headless_play_action.gd`、`scene_mesh_picker.gd` 时要求路径原本不存在。
目标字节对应 `314c27d5` 集成，未知同名内容拒绝覆盖。实际 PET 来源参与
最终迁移测试，普通世界／合同／狗源码保持，只有明确列出的托管文件更新。
26 项迁移及指导回归通过，包含旧五文件联动迁移的独立历史夹具；这是源码
字节和 CAS 回执验证，产品采用验证仍在后续新构建执行。
