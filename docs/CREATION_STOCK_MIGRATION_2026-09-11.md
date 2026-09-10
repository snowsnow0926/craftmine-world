# preview.10 旧造物世界兼容升级

日期：2026-09-11。适用基线：已发布 `c1660f12` 的 creation-sandbox 底座，兼容其明确
记录的 LF 和 CRLF 字节版本。目标是当前安装随附的正式底座资源。

## 升级边界

旧世界继续创作时，在宿主已绑定真实目标、开始模型或直接编辑工具前准备源码。三个受保护
文件是 `craftmine_shared/base_adapter.gd`、`runtime_bridge.gd` 和 `state_guard.gd`。
需要升级时，连同确定为原版的 `scripts/creation_world.gd`、`scripts/scene_contract.gd`
作为一次原子源码 CAS 提交。已有本版字节不重写；换行形式单独核对 SHA256。

场景 JSON、操作日志、普通自定义脚本和其余文件均不改动。正式世界和玩家进度继续使用原
构建；升级后的工作稿必须经过正常要求检查、候选采用和最新进度迁移才成为正式版本。
不通过修改临时构建副本绕过正式 Git 源码验证。

如果三个受保护文件已是本版，用户修改过的可变 world/contract 源码照常保留，迁移零写入。
如果确实需要升级旧受保护文件，而可变源码存在未知自定义版本，则显示需要手动适配，保留
原始数据。存在额外未采用的草稿改动时同样保守停止，让玩家先处理草稿，不覆盖其内容。
固定 autoload/adapter 入口存在歧义或重复时不能自动升级。

## 中断与恢复

宿主在提交前记录原 task binding、完整 CAS 请求和稳定升级编号。回包丢失只查原 core 回执，
不重发未知结果的写入。升级提交后若目标绑定记录丢失，新任务只有在整棵源码树与“原正式
源码加这次原版替换”完全一致、原持久回执存在时才能恢复升级进度标记；任何额外源码改动
都不接受。模型不能提供此标记，普通 `creation_operation` 只认可宿主返回的精确升级 source pin。

## 验证

- 七项迁移测试通过：LF/CRLF、单次原子 CAS、用户文件不变、本版零写入、本版受保护文件
  配合自定义可变源码放行、未知旧自定义版本与额外草稿拒绝、丢回包/丢绑定跨任务恢复、固定入口校验。
- 桌面 TypeScript 与生产构建通过。独立 NB1 审查重跑迁移测试，确认未知源码与额外工作稿
  都在 patch 前被拒绝。
- `tests/creation-migration-native.mjs` 从 Git 的 c1660f12 导出 479 个旧 Godot 文件，创建
  独立旧世界；关闭后使用新源码同一隔离 profile 继续创作。
- 真实生命周期 **19 项通过**：升级前旧完整快照不变、真实升级回执、新受保护检查通过并采用、
  实际 React 尺寸颜色编辑、删除、撤销、完整进度重开、阶段中断只读核对、跨世界拒绝，模型请求为零。
  三个 Electron 进程均退出 0，关闭审计无违规。
- 首次测试用 junction 复用运行资源，被 broker 的 reparse 保护正确拒绝；随后改成独立复制
  运行资源，未放松产品保护。该失败没有计入成功。

此真实证据使用 736f54a6 受保护观察版本；迁移目标从正式资源读取，后续观察元信息修订不
更改迁移协议。总控最终统一验收应使用最后冻结的资源与 core。证据位于
`docs/evidence/next-batch-20260911/migration/`，包含原始报告、原正式基线、升级 CAS/回执摘要
和真实属性截图。不读取或迁移个人存档，不打开麦克风，不使用真实输入或焦点。

## 固定验收入口

先完成同源码客户端构建、插件 staging、core/host 和运行资源准备，设置可选
`CRAFTMINE_SOURCE_ROOT`、`CRAFTMINE_EVAL_CORE`、`CRAFTMINE_EVAL_HOST`、
`CRAFTMINE_EVAL_BASES`、`CRAFTMINE_ELECTRON_BIN` 后运行：

```powershell
node tests/creation-migration-native.mjs
```

该入口不需要模型密钥；原版数据由 Git 固定提交创建，测试 profile 独立。
