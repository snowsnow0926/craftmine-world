# GU6：从资源检索到源包安装的下一步

2026-09-12，只读审计基于 `09f7443a`。以下是待实施增量，当前未交付。

开发已开始：模型建议、作品界面和宿主接受路径分别在独立工作树实现。主集成的正式产品验收驱动新增显式 `CRAFTMINE_SOURCE_PACKAGE_MODE=catalog`；在客户端启动前用同一包的真实核心向独立库导入两份固定 ZIP，删除仅供测试的下载副本，然后计划走正常 `importCatalogSource`、检查、采用和冷开重放。种子准备、三层身份区分及原流程回归共 12 项测试通过；此时新宿主方法尚未合入，不能把驱动准备称为实际安装成功。

现有 `godot_library` 能检索 ZIP，但其 `proposeInstall` 指向旧 library bundle 的 `package.install`，不是 CP0 ZIP 源安装。不能把这两条路径或三层哈希混用。最小方案沿用现有作品面板和 `createManagedPackageInstaller.installSource`，不增加安装注册表。

1. 模型只提出固定 `{assetId, version, contentHash}` 及宿主绑定 worldId，保持 `applies:false`、`requiresPlayerAction:true`。读回确切版本，确认包含 ZIP；提案不是授权凭证。
2. 在已有 Godot 作品面板增加资源库选择入口，显示版本、来源和未检查状态。玩家选择后生成新的宿主 operationId。原 `ACTIVE_TASK_EXISTS` 阻断继续生效。
3. 为 `package.request` 增加窄入口 `importCatalogSource({worldId, operationId, ref})`。宿主再次 `asset.read`，首版只接受单 ZIP 文件；私有 `asset.bodyPath` 定位库内 blob，逐项校验身份、MIME、字节数和摘要，再交给原 `installSource`。
4. gateway 私下传入 owner，跨异步复核 world/session；不能接受页面传来的 session/context。新 operation/grant 同时绑定固定 ref、ZIP SHA 和 owner，相同 operation 改 ref 应冲突。原始下载文件删除后，仍应能使用已验证的库内 blob。
5. 后续沿用 CP0/CP1 解包、sourceRequirements、计划、源码事务、真实 check，再正常预览和应用。`blobPath`、archiveBase64、私有 context 均不返回页面或模型。

真实建筑样本的三种身份不同：catalog `contentHash` 为 `515544d0…`（ID `kenney-city-building-trial`）；完整 ZIP SHA-256 为 `351f4774…`；包内 resource `contentHash` 为 `0ae7883b…`（ID `kenney-city-building`）。分别校验，不相互替代。

主要实现位置：`plugins/craftmine-world/godot-library.cjs`、`world-tools.cjs` 与工具 schema；`godot-package-ui.mjs`；`vendor/pi-desktop/apps/desktop/electron/main/craftmine-package-service.ts`、`craftmine-panel-gateway.ts`。现有私有 bodyPath 白名单和 `reuse-service.mjs`、`package-turn-lifecycle.cjs` 可复用。

最小验证：提案零写入；三层错误哈希分别拒绝；跨 world/session、过期 grant、同 operation 换 ref、active turn 均拒绝；重试不重复安装；删除原下载文件后从库正常安装。最后在新独立世界使用已审计 Kenney ZIP，走普通 panel 接受、真实 LPAC check、候选预览与采用，核对三层身份与源码版本。此有限开发验证不调用玩家模型；随后普通玩家体验仍沿用确认模型和原产品配置，不额外限额。
