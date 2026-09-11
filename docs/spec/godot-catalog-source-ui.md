# Godot 作品面板：接受固定资源库 ZIP

现有作品面板增加“从资源库选择 ZIP 并检查”。本层只呈现候选及接受动作；
文件读取授权、资源身份校验、CP0 安装和 source check 仍由宿主负责。不读取模型
聊天内容，不自动接受建议，不使用旧 library bundle 的 `package.install`。

## 交互和固定版本

用户输入名称或 assetId，可按作品类型筛选。每页 20 项，使用服务返回的
`nextOffset`，明确显示截断状态。请求固定 `mediaKind=package`、
`scope=local-library`、`latestOnly=false`，所以模型建议的 v1 在 v2 存在时
仍可选择。列表显示 ID、版本和 catalog hash 前缀；折叠的“核对完整版本哈希”
详情显示 catalog hash 及独立的 ZIP 文件 SHA-256，不把其中任何一个当作包内
resource manifest hash。

列表项只是候选。点击“核对所选版本”后，必须通过 `asset.read` 返回的
`version_` 核对精确 assetId/version/contentHash，并确认 package 类型、一个
文件且 MIME 为 application/zip、有效字节数及 SHA-256，才启用安装。与既有
宿主入口一致，首版限制为 5 MiB。只展示来源和许可原始声明，不推断版权许可或
当前世界兼容性。核对后的提示明确本次安装尚未检查。

搜索、翻页、改变列表选择、隐藏面板或切换世界均清除已核对的选择。分页继续
使用上次已提交的筛选条件，不受尚未提交的输入编辑影响；异步返回还必须匹配
面板 generation、当前 world 和本次 catalog token。宿主负责会话身份复核。

## 真实桥接形状

`view.mjs` 把原始 `bridge.invoke(channel,payload)` 交给 workbench；workbench
直接把该 request 交给 Godot 作品面板。这里不使用会自动注入 worldId 的
workbench.call 包装。

- `asset.search`：`{ownerWorldId,scope,query,mediaKind,kind?,latestOnly,offset,limit}`。
- `asset.read`：`{ownerWorldId,assetId,version}`；不传 worldId、context 或路径。
- `package.request`：`{worldId,method:"importCatalogSource",params:{worldId,operationId,ref:{assetId,version,contentHash}}}`。

只有用户接受安装时才生成 operationId。成功回执必须是原有
`check-queued` 或 `source-saved-check-blocked`，包含有效 job ID、实例列表、
`applied:false`、相同 world/operation/catalogRef，以及等于已核对文件 SHA-256
的 archiveSha256。catalog 入口没有 picker，因此不接受 cancelled 回执。

源码检查使用既有 sourceJob 轮询。queued/running/blocked 及查询失败均禁止新
安装；只有确认同一 job 已终止才解锁。检查通过仍要求到检查记录预览并应用。
catalog 的 opaque grant 不传给 repeatImportSource：用户“再次安装为独立对象”
会使用同一固定 ref 和新的 operationId，重新走 importCatalogSource。

## 未确认结果

传输异常或回执不匹配时保留原 operationId、ref 和预期 ZIP SHA，并提供
“重试确认上次安装”。即使后来核对了另一条资源，重试也只能继续原参数。
不能用另一个资源或新操作编号猜测重试。普通文件导入的原重试路径保留。

只有 UI 自己新生成、此前没有任何未知失败的操作，首次收到以下精确宿主
preflight 错误码时，可确认未派发安装并允许重新选择：
`PACKAGE_CATALOG_IDENTITY_MISMATCH`、`PACKAGE_CATALOG_SINGLE_ZIP_REQUIRED`、
`PACKAGE_CATALOG_ZIP_INVALID`、`PACKAGE_CATALOG_BODY_MISMATCH`、
`PACKAGE_CATALOG_BLOB_MISMATCH`。不使用 substring 或模糊错误文本匹配。

任何 UNKNOWN、timeout、OWNER_CHANGED 或回执错配都会将原 attempt 标为
uncertain。此后即使收到同样的 preflight 错误，也不能推断先前操作未写入，
仍只允许原 operation/ref 重试。底座或 ZIP 解包等 installer 内部错误不在解锁
白名单中。宿主可在原操作授权过期后重新完整核验 ref/body/owner 并取得新 grant，
再通过原 durable intent 恢复；UI 不延长旧 grant，也不生成替代操作。

当前没有安全放弃已不确定安装的独立宿主契约。面板隐藏再打开同一世界保留原
attempt 的 uncertain 标记与待检查 job；切换世界不把旧操作带到新世界。页面或
进程重建不代表旧操作未写入；本实现没有加载外部操作 ID 并把它当作首次操作的
入口，也不宣称跨页面重启的操作恢复。

## 验证

`node --test tests/godot-final-install-assets/catalog-source-ui.test.mjs tests/godot-final-install-assets/package-ui-pending.test.mjs`
覆盖实际 Main gateway → asset panel 的 ownerWorldId 字段与会话检查，以及精确
旧版本、分页、MIME/单文件/大小、哈希错配、原操作重试、pending 与迟到返回边界。
执行器响应是测试替身，不把这些测试当作真实 source check。

`node tests/godot-final-install-assets/catalog-source-ui-headless.mjs` 在独立 headless
浏览器和测试 profile 使用同一真实读网关，以页面脚本和 requestSubmit 验证 DOM。
它验证 v2 存在时选择 v1、明确接受、同操作重试、新独立安装、安全文本，以及零
Pointer Lock/focus；不发送鼠标、键盘或输入事件，不调用模型或 Godot。产出报告和
截图保留在 test-results/catalog-source-ui-*。正式成品中的安装和 core check
由后续完整包验收覆盖。
