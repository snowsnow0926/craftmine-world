# tests/godot-remaining/J

L3 部件层与 L4 策略层的专属测试。全部为纯逻辑，**不启动 Godot、不启动浏览器、
不发送任何鼠标/键盘事件、不申请 Pointer Lock、不激活窗口**。

## 运行

```powershell
node --test "tests/godot-remaining/J/*.test.mjs"
# 等价写法（Windows 上更稳）
node --test tests/godot-remaining/J/extensions.test.mjs tests/godot-remaining/J/strategy.test.mjs

# 闸门证据（打印每条阻断原因的 JSON）
node tests/godot-remaining/J/gates.mjs
```

## 覆盖范围

`extensions.test.mjs`（13 项）
* 部件包由源文件派生哈希；清单校验拒绝 11 类越界写法；
* 兼容闸门：引擎/底座/状态格式/宿主 ABI/原生验证记录/许可；
* 内容引用必须可解析到哈希；
* 安装前哈希不符即拒绝且不落盘；安装不兼容目标即拒绝；
* 安装→生效→升级→回退→卸载全链路 + journal；生效中不可卸载；篡改文件阻断生效；
* 预算记账：未测量 = `unknown`，永不等于通过；
* L3 候选闸门拦住两条当前候选（缺证据/冻结输入/实测基线/预算）。

`strategy.test.mjs`（9 项）
* 检索按引擎/底座/状态格式/版本/标签/哈希排除，并给出排除原因；
* 两条工具分支的差异（旧分支不看兼容与失败经验）；
* 检索与选择的确定性；
* 实验闸门：未冻结、无适配器、任务集不合法；
* 运行记录：失败留在分母、token/缓存分开记账、被阻断不写结果；
* 对照：跨任务集拒绝、样本不足不宣布改善、回归不可被抵消。

`gates.mjs`
* 可复现地打印 8 条闸门结果，其中 5 条是预期的阻断。

## 明确不覆盖

* 不验证部件代码在 Godot 中真实加载与运行（属于 B/C 的沙箱与执行器范围）。
* 不验证真实模型创作成功率（需要 I 的冻结任务集与 L 的真实适配器）。
* 不验证渲染、手感或可见合成。
