# Agent C 完工报告

日期：2026-09-09。任务版本：W2–W5 派工 v1 / C_DESKTOP_EXPERIENCE.md，以及 G 明确追加的真实工作台服务。

结论：ready_for_integration。桌面工作台与真实领域适配器已交付；不把组件测试记作完整原生客户端验收。

## 1. 用户能得到的功能

在现有 PI 桌面中切换创作/游玩布局，分别记住面板宽度，保留聊天与其他标签。世界面板新增作品库、记忆、任务与预算、备份与诊断入口。旧树和玩法按固定版本查看源码、依赖及来源，再加入当前草稿；仍须检查、评审和玩家应用。

玩家规则显示作用世界、证据与验证状态，可停用或替代。中断任务显示已有草稿和累计预算，恢复文案依据宿主真实回执。选中对象显示可移除的上下文标签，检查世界与构建身份。恢复备份明确说明替换客户端全部世界资料。

## 2. 完成情况

| 验收项 | 状态 | 证据与限制 |
| --- | --- | --- |
| PI 原组件中增加布局、宽度持久化 | 通过组件验证 | layout-report.json，6/6；store/i18n 是明确夹具 |
| 实际构建的工作台、深浅主题、360px 窄栏 | 通过 | ui-report.json，26/26；实际 game iframe，业务 bridge 是夹具 |
| 作品固定版本、来源、草稿安装、依赖 | 通过适配器验证 | service-domain.tap，1 个真实 Rust 集成测试；起始应用证据为夹具 |
| 作用域记忆、原文校验、替代、停用 | 通过真实服务验证 | 同上，实际 A validator/Rust；没有虚构 validated |
| 任务停止/恢复、真实模型续作与累计预算 | UI 通过，原生待 G/F | 任务回执夹具；真实模型未调用 |
| 选中对象上下文 | 协议和服务通过 | 验证 source/nonce/world/build/object/revision；实际 raycast 由 D 覆盖 |
| 备份恢复/诊断 | UI 通过，E 原生待合并 | 失败、未知结果与同 operationId 状态查询；没有运行原生文件选择器 |
| 完整可见窗口最终合成、安装包 | 未验证 | 没有抢占用户窗口或控制用户浏览器 |

## 3. Git 交付

基线 dispatch/w2-w5-v1：2f71e128fd9ff9c49ee4e466138f4949b6bce862。分支 codex/parallel-c-20260909，工作树 D:/Craftmine World-worktrees/parallel-c-20260909。

- 5e0486b76eb42f3f7cb6944721a5c15dad12a99d：真实 UI、React 布局与组件测试。
- 405c21060c9ac629c82714cc41c32f9d6dea98b0：真实 A/core 工作台服务与集成测试。
- 0b99c8c21510a3cc727d685f344343efc34e158a：未确认请求保留原 operationId/参数，记忆长度与实际契约对齐；最终代码冻结。

详细文件清单、哈希见 DELIVERY_C.json。除 G 明确追加 workbench-service.cjs 外均在 C 所有权内。没有改 main/manifest/公共协议/构建脚本；由 G 接线。不推送、不合并主项目、不清理工作树。报告与证据随后单独提交，最终 HEAD 以交接消息为准。

## 4. 实际验证

工作目录均为本 C 工作树，React typecheck 在其 vendor/pi-desktop 下。

| 命令 | 结果与源码 |
| --- | --- |
| node desktop/build-world-plugin.mjs | 成功，最终代码 0b99c8c |
| node tests/dispatch/c/ui-headless.mjs | 最终 26/26，含丢失安装回执后同请求重试；ui-report.json 有完整源码和 bundle 哈希 |
| node tests/dispatch/c/layout-headless.mjs | 6/6，冻结于 405c210；此后 React 文件未改 |
| node --test --test-reporter=tap tests/dispatch/c/service-domain.test.mjs | 1/1，实际 Rust/A/compiler，约 200ms；service-domain.tap |
| pnpm --filter @pi-desktop/desktop run typecheck | 成功，约 6.8 秒；最终 React 文件未再改 |
| pnpm run build:js | 成功，安装锁文件依赖后构建完整 vendor JS；未声称 Windows 安装包完成 |

临时测试 overlay 只复制 G 已构建 core.exe/domain.cjs 到 C/test-results/dispatch-c-overlay，哈希见 DELIVERY；独立新建数据目录，无共享 profile。服务测试应用来源由 fixtures/applied-source.mjs 明确填充 durable evidence；不是实际评审/渲染通过的证据。后续作品抽取、编译、入草稿、检查排队、幂等查询、记忆验证/替代/停用都调用真实代码。

失败与修正：初次 headless 用 HTTP 导致 iframe origin 不符合生产 file/null 协议，改为生产 file 加载；处理中提示未清除已修复；React 夹具缺失真实订阅导致一次宽度断言失败，补 useSyncExternalStore 并让组件读取即时 store；服务测试原始树误用了已升级 schema、endTurn fixture 误写 finished，均修正为合法输入后通过。没有改冻结验收断言。历史失败在独立 test-results 留存，不包装成成功。

## 5. 真实模型与资源

模型调用 0；压缩 0；供应商/模型/实际 usage 不适用。测试只有独立 headless 与 Rust 子进程。没有读取凭据、个人聊天或用户正式世界。

## 6. 接口与依赖

详见 INTERFACE_C.md。UI 只调用显式业务通道；真实身份来自 main 私有 host。A 提供库与记忆工厂；B 消费 validatedContext；D 提供实际游戏选择事件；E 提供原生备份/诊断；G 持有 main/manifest/Rust router 接线。没有 integration.patch，因为 G 同步直接接线，新增服务需构建脚本复制，UI 模块已有入口 import 自动 bundle。

## 7. 数据与故障恢复

Rust 是唯一正式数据写入者。浏览器只保存布局偏好和当前面板尚未确定操作的临时 request，不保存第二套世界/记忆。保存失败阻止切换世界；旧异步结果按 epoch/world 丢弃；恢复前一次保存后获取 expectedCurrentHash，确认恢复时不会再次保存使指纹失效。

安装与记忆的同面板失败重试保留原完整请求和 operationId。关闭/重载整个 renderer 会丢失这些临时待确认 ID，须先查任务/作品状态；跨 renderer 的持久待办恢复仍由 G 后续实现。

## 8. 真实缺口与下一步

G/F 仍须实际原生加载所有通道并跑真实模型与恢复预算链，W3/W5 不能依据 C 测试整体记完成。PI 全部旧入口没有逐一人工验收。

library.install 已提交但 verification.submit 失败时，重复请求可恢复安装回执，返回 verificationStatus=query-required；不能宣称检查已恢复。G 应补“查当前草稿并重新提交检查”的宿主动作，且不能再次安装。

memory.findReceipt 新跨短任务幂等接口由 E 实现；C 已按约定调用，但本批复制的二进制尚未含它，跨新 turn 的丢回执记忆查询未验证。不得把此项记绿。

游玩布局使用现有工作面板上限 720px，不是全屏。完整窗口截图需以后由玩家主动查看；本批不置前任何窗口。

## 9. 复现与交付物

从基线应用上述代码提交，pnpm install --frozen-lockfile（vendor）后构建 JS 依赖和世界插件。先运行两个 C headless 脚本；服务测试显式设置 CRAFTMINE_CORE_BIN 与 CRAFTMINE_DOMAIN_MODULE 为合并 A/G 后的自有构建产物，并使用新目录。

报告、DELIVERY、INTERFACE 与 docs/evidence/dispatch/C 下报告/截图供 G 验收。零 mouse/keyboard/click/fill，初始化禁止 Pointer Lock/focus，只通过页面脚本、form.requestSubmit 和纯领域方法验证。禁止运行历史 tests/browser.mjs、tests/modules-browser.mjs。
