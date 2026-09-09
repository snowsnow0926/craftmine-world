# 第 7 批静态路由核对

协调者审阅了 `app/static-files.mjs` 的完整变化：只新增
`/app/craftmine-acceptance-game.mjs` 这一固定模块路由，供正式游戏导入。
实际测试能力仅在专用独立 headless preload 注入后注册；普通正式世界
仍拒绝 `request-step` 和 `request-observe`，没有新增通用脚本执行接口。

因此只更新该路由表一项冻结哈希：
`f43939cb574ea1236d18aac1bff9476cfde4935eeae793b5f94663fb05babfba`
→ `9360aea8d2fa2a24c8dd228eb20fc12889489c7502a69656013c3d9d5a7915af`。
其余冻结内核、断言和权限清单不变。冻结哈希检查仍检查真实文件字节；
修改一个字节仍须失败。此次调整属于用户已授权的开发和无抢鼠标验收工作，
没有给产品内 LLM 更新冻结哈希的工具或权限。
