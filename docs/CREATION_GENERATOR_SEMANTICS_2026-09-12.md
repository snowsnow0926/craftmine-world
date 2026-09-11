# 底座生成器与已安装素材的语义澄清

真实使用暴露了一个选择错误：模型已看到安装的素材树，却调用 `creation_operation(place, kind=tree)` 新建底座默认几何树。其类别同为树，不表示引用或复用了已有 GLB 外观。

本轮优先修正每次工具调用前可见的信息：`creation_operation` 主描述开头明确只编辑 `world/creation.json` 的底座生成器实体；kind、place、duplicate、targetId 字段同步说明其适用范围。`kind` 不是素材 ID、GLB 名或 PackedScene 选择器，duplicate 不复制任意 addon 节点。同类或同名、操作成功回执均不足以证明外观相同。

要求同款外观时，应读取实际已安装场景引用，为新实例设置独立 entity_id，通过普通源码 patch 新增实例；或读取真实 source-library 引用后走正常安装提案。不能猜路径、继承另一实例的可变进度，或修改共享资源冒充独立新增。指南澄清区块从正文第 1079 个字符开始，位于前 8000 字符内，不仅依赖后部说明。

动作、参数约束、生成器、回执与玩家现有内容均未修改；没有放宽 source/target/进度保护。去掉 description 后，修改前后的 operation schema 完全相同；全部指导参考源码及其接口哈希保持相同。本次不增加响应元数据，避免改变既有回执和重放合同。

## 需求解析只读核对

直接执行现有纯函数确认：原句“再放一棵橡树在左边，和已有的树错开”得到 `parseCreationWishIntent=null`、`freezeCreationRequirements.status=unverified`，原因为 `CREATION_REQUIREMENTS_NEED_REVIEW`。它不会预先强制新增 kind=tree 或 creation.json 实体；真实检查仅在宿主要求为 verifiable 时注入 creation requirements。

另外，精确支持句“在这里放一棵树”会产生 kind=tree、数量增加一、可见且有碰撞等结构化断言，现有协议针对底座实体，普通 addon 不自动满足。此为单独的适用范围，本轮未修改解析或断言，不把它归因于上述原句。

## 版本与验证

- 指导目录及 `creation-sandbox.authoring`：`1.6.4`。
- 指导正文 LF SHA-256：`532dea70d23c5724e9d0c062a93c43d22912929b58b6b099fdc1058c4ea08614`。
- 原接口摘要保持：`ba08f612ddb433f95e5f1719efffef79d0603b6e285d2175f30bda56bcc5e8e6`。
- 31 项测试通过：原创建/修改/复制/删除/撤销等合同、真实 broker 指导分页接口，以及生产插件构建后工具描述/schema/指南版本与哈希检查。

未新增模型调用或修改冻结成品。测试证明说明已准确送达实际插件接口，不证明模型复用成功率已经提高；后续需在新冻结包中复验真实选择行为。
