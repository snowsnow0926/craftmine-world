# NB3 中文语音与任务状态开发记录

日期：2026-09-11。基线 ef5201c4；分支 `codex/creation-next-voice-20260911`。

## 已实现

- Windows 本地识别不再选取第一个识别器作为回退。简体、繁体和显式区域严格匹配，缺少目标
  语言时禁止录制并给出安装语音功能、重检、选择已有语言或打字路径。
- 语言选择只显示真实枚举结果；重检清除成功缓存；录制开始固定 locale，宿主和控制器均拒绝
  返回其他语言的结果。界面显示实际语言，草稿与附件复用原流程。
- 轻量浮层读取宿主管理的 `godot.creationTaskStatus({sessionId})`。采用、失败、中断、取消及
  恢复状态不依赖模型正在运行，收起重开仍补读真实结果；未知要求不显示愿望已验证。
- 复用世界变化通知及实际直接编辑事件触发补读；实际执行中 2→5→10 秒退避，最长 30 分钟，
  终态停读。异步结果按观察代次隔离，不保留其他世界或会话的旧状态，不创建本地事实数据库。

## 自动验证及限制

- `node --test test/voice-input.test.mjs test/voice-microphone-permission.test.mjs test/composer-voice-draft.test.mjs`：26 项通过。
- `node --test test/creation-task-status.test.mjs`：6 项通过。
- `node tests/creation-voice-status-headless.mjs`：13 项实际 React UI 检查通过。
- 桌面 TypeScript 检查通过；依赖包在独立 worktree 离线安装并构建。
- 实际 Windows 运行了只读语言枚举、合成静音转写和不存在语言的拒绝检查。没有打开真实
  麦克风、发送真实输入、申请 Pointer Lock、置前窗口；没有证明真人语音准确率。
- UI 第一次测试使用 file URL 下 module script，因浏览器加载限制超时；改为自包含 IIFE
  后完整 13 项通过。该首次失败没有计为产品成功证据。

原始 UI 报告及截图见 `docs/evidence/next-batch-20260911/nb3/`。
宿主聚合接口及 capability refresh 的 index.ts 接线由总控集成，独立测试不冒充已验证集成。
