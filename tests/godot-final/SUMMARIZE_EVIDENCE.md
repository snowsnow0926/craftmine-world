# 最终证据汇总

在最终集成树运行，不会启动客户端、引擎、模型或安装程序：

```powershell
node tests/godot-final/summarize-evidence.mjs --root D:/cm-godot-final-20260910
# 只有本轮安装包实际生成并通过既有发行验证后，才附加其真实回执：
node tests/godot-final/summarize-evidence.mjs --root D:/cm-godot-final-20260910 --package-evidence desktop/build/releases/<run>/package-evidence.json
```

生成 `test-results/final-audit-summary.json` 和中文 `final-audit-summary.md`；不提交这两份变化中的生成物。输入只读：

- `test-results/desktop-native-complete-*/report.json`：真实完整客户端。
- `test-results/desktop-native-wx-*/report.json`：真实客户端 Windows 独立游戏导出，包括最终包使用 `--output-parent <root>/test-results` 生成的运行。
- `docs/dispatch-reports/godot-final/**/windows-client/report.json` 与 `first-failure-report.json`：已保留的真实客户端导出成功和首次 profile 拒绝记录。统一类型为 `actual-client-windows-export`，要求原报告格式 `craftmine.windows-client-export/1`；不能用直调导出 service 的报告冒充完整入口。
- `test-results/desktop-native-recovery-gql5Pk/fault-evidence-*/report.json`：真实客户端恢复故障记录。
- `docs/dispatch-reports/godot-final/**/native-final.json` 和 mining 路径下 report JSON：原生固定场景，不称为真模型或完整客户端。
- 同目录 mining 的说明报告：只链接与哈希，不解析自然语言得出通过结论。

每次运行单列原始文件链接、SHA-256、时间（未记录则明确说明）、报告提供的版本/世界构建身份、每项原有判定。失败不被重跑覆盖，不计算跨运行通过率。客户端缺完成时间或尚未写报告为 running；损坏 JSON 为 invalid，保留字节哈希。原生字符串检查项标明是父报告声明，不伪装成独立布尔断言。SHA-256 是读取时的来源校验，不证明全部报告来自同一源码，也不代替重新验收。

Windows 客户端导出分别保留 `frozen-source-client` 与 `packaged-client` 来源口径，并提取原报告的 main、broker 和正式 build 身份。成功报告不会覆盖首次失败；即使当前条目均通过，只要缺结束时间仍为 running。文档副本与运行目录均可列出，不将二者视作额外独立验收或累加通过数。`packaged-client` 只是原报告提供的执行来源，不改变安装包、签名、安装器执行或清洁 Windows 首装结论。

只提取固定摘要字段，不输出 calls、payload、原始 prompt、任意结果体、凭据或完整错误；错误详情用原报告链接定位。文件修改时间不当成运行时间。模型 15 类 / 30 轮 / 141 断言仍单列“本轮授权待确认，未执行”，不生成费用或通过率。后续取得授权并实际执行后必须明确修改该状态处理，不能把固定场景报告自动算成模型验收。

`--package-evidence` 只接受当前 `/2` 回执中的同源码身份、安装器与 blockmap 哈希及提取验证字段；只显示“记录了载荷验证”，不会重做解包或声称清洁 Windows 首装通过。缺回执时安装包未验。签名与首装事实保留回执字段。

定向测试：`node --test --test-isolation=none tests/godot-final/summarize-evidence.test.mjs`。
