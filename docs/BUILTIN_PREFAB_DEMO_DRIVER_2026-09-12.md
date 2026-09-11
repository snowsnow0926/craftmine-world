# 预制组件零模型成品演示准备

本轮新增 `tests/builtin-prefab-demo.mjs`，默认只 prepare-only。固定计划为自然日光环境、两棵不同落点的同款橡树、城墙门洞及相邻城墙，共五次安装。报告明确标为“开发者布置预制组件演示，非模型生成”。不使用或伪造 promo-player 报告，不修改原六组作品。

成品运行入口：`node tests/builtin-prefab-demo.mjs --packaged-root <冻结win-unpacked绝对路径> --run`。可选 `--plan <JSON文件>` 只选择成品 catalog 中的准确 assetId/version 和有限位置。运行前校验成品清单、每个 ZIP 与包根哈希；不接收工程脚本或模型配置。

运行流程：全新隔离 profile → 正常创建 creation-sandbox → 将成品中固定 ZIP 原字节复制到该测试目录的 component.zip（现有 headless 文件选择器）→ 正常 `worldPanel/package.request/importSource` → 等真实检查 → 按同 checkJobId 查找候选 → 预览、采用 → 继续安装 → 保存 → 干净退出 → 冷重开 → 比较正式 build 和独立实例身份 → 截图。

正常原生 `importSource/repeatImportSource` 路由补充可选 position，沿用三项有限数、各绝对值不超过 80 的校验。坐标进入 operation 的重试身份及已有 installSource；同一 operation 改坐标会冲突，不绕过选择文件、固定哈希 grant 或检查采用。模型入口、任意脚本、旧任务恢复、真实鼠标键盘和 Pointer Lock 均不在驱动允许调用集合内。

已完成：8 项原生路由测试（含坐标冻结及篡改拒绝）、3 项演示合同测试；静态语法检查通过。对 root 构建的 17 项素材 catalog 只读 prepare，成功找到五个计划引用并核验 ZIP/root 哈希。**尚未启动测试成品，尚无画面/安装成功结论**。等待 root 冻结新包后执行。

输出位于新建 `test-results/desktop-native-complete-*`，包含独立 `craftmine.builtin-prefab-demo/1` 报告和 before/after/reopened 实机 PNG。检查通过仅代表其断言范围；场景观感仍须目视截图，不能由 ZIP 验证或开发者布置推断模型选材能力。
