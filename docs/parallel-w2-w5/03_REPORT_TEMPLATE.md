# 完工报告与交付清单模板

每个 Agent 完成后必须创建 `docs/dispatch-reports/<ID>/REPORT_<ID>.md` 和 `DELIVERY_<ID>.json`。不要只在聊天里说“已完成”。下面内容复制到实际文件，并替换占位符；禁止把模板里的示例数值当成测试成绩。

## REPORT_<ID>.md

```markdown
# Agent <ID> 完工报告

日期：
任务提示词版本：W2–W5 派工 v1 / <文件名>
结论：ready_for_integration / blocked / accepted（accepted 仅 G 可给）
一句话说明：

## 1. 用户能得到的功能
用普通中文描述真正新增的行为，注明是否已经接入实际桌面。

## 2. 任务完成情况
| 提示词验收项 | 状态：通过/失败/未验证/依赖未到 | 证据路径 | 说明 |
| --- | --- | --- | --- |

## 3. 改动与 Git 交付
- 仓库、基线 ref + 完整 SHA、分支、工作树路径、HEAD SHA。
- 按逻辑提交列出完整 SHA 与用途。
- 修改文件清单和关键入口，未提交/未跟踪文件是否存在。
- 是否触及约定之外的文件；若有，解释并给出接线补丁，不能隐瞒。
- 是否合并/推送/清理：A–F 应保留分支并等待验收。

## 4. 实际验证
| 类型 | 完整命令与工作目录 | 源码/二进制版本 | 结果、耗时 | 原始证据 |
| --- | --- | --- | --- | --- |
分开列逻辑、契约夹具、组件、原生、真实模型、程序包和人工验证。
包含失败、重试和未运行项。临时接线 overlay 的哈希和成绩单列。

## 5. 真实模型与资源消耗
模型 ID、供应商、思考强度、调用/压缩次数、时间预算、实际 usage。
没有调用就写未调用；没有真实凭据就写未验证。不要包含密钥。

## 6. 接口与依赖交接
导出模块/函数/RPC/数据格式、版本、调用顺序、权限与错误。
与 02 约定的差异、消费者、接线位置、integration.patch 及 SHA256。
哪些结果使用了另一组夹具，哪些已经用了真实实现。

## 7. 数据迁移、取消和故障恢复
真实写入者、版本兼容、幂等/代际、升级或恢复失败后的状态。
个人数据是否接触；测试档案与产物位置。

## 8. 尚未完成、风险和建议下一步
列实质缺口及下一位 Agent 可执行的动作，不写笼统“建议完善”。
原计划 W2/W3/W4/W5 哪些门槛还不能记完成。

## 9. 复现步骤与交付物
从统一基线应用提交/补丁、安装必要依赖、构建和运行的步骤。
报告、DELIVERY JSON、接口文档、证据、可携带 bundle/补丁的路径与哈希。
列明禁止运行的输入测试，说明本次零真实输入验证方式。
```

## DELIVERY_<ID>.json

```json
{
  "format": "craftmine.dispatch-delivery/1",
  "agent": "<A..G>",
  "promptVersion": "w2-w5-v1",
  "status": "ready_for_integration",
  "baseRef": "dispatch/w2-w5-v1",
  "baseCommit": "<full SHA>",
  "codeCommit": "<full SHA of frozen implementation>",
  "branch": "codex/<branch>",
  "worktree": "<absolute path>",
  "commits": [],
  "report": "docs/dispatch-reports/<ID>/REPORT_<ID>.md",
  "interfaces": [],
  "integrationPatches": [],
  "tests": [],
  "evidence": [],
  "dependencies": [],
  "unverified": [],
  "privateDataIncluded": false,
  "mergedToPrimary": false,
  "pushed": false
}
```

`tests` 每项至少含 kind、command、cwd、sourceCommit、result、evidence。`evidence`/`integrationPatches` 每项含 path、sha256、description。依赖列 group、contractVersion、usesFixture、missingWork。

`codeCommit` 指冻结实现提交。报告/证据随后单独提交，最终分支 HEAD 在回传消息中给出，避免报告文件自引用尚未产生的提交哈希。G 必须核对 codeCommit 到最终 HEAD 只包含报告/证据；若仍有产品代码差异，应按新代码重新判断验证是否有效。

同机交付保留分支，报告给出可读路径。异机交付额外生成 Git bundle（注明基线 prerequisite）或二进制友好的 format-patch，并校验能从统一基线应用；附 SHA256。不要提交 node_modules、target、个人 profile、密钥或完整用户世界。无法运行的命令不得补写成功结果。
