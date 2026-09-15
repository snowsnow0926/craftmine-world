# 评委一键启动说明

完整解压评委专用 ZIP 后，双击根目录的 `START-REVIEWER.cmd`。

首次启动会读取同目录的 `评委用apikey.txt`，通过应用内置配置服务添加 DeepSeek，并设置：

- 服务：DeepSeek 官方，`https://api.deepseek.com`
- 模型：`deepseek-flash`（本次评审使用的 Flash 模型）
- 默认推理等级：最高
- 上下文长度：1,000,000 tokens（1M）
- 最大输出长度：384,000 tokens（384K）
- 世界创作后端：应用内置模型服务

配置成功后会自动打开应用。返回工作台，在输入框下方看到 `deepseek-flash · 最高` 即表示模型选择正确。新建造物世界或导入示例后，即可输入创作需求。

## 以后如何继续

以后仍双击 `START-REVIEWER.cmd`。它使用同一份独立评委资料，保留已创建的世界、对话和修改过的模型设置，不会每次创建一个新玩家。

评委资料位置：`%LOCALAPPDATA%\CraftmineWorld-Reviewers\Tencent-20260915-preview28`。

它与普通入口、新玩家入口、preview.27 旧档入口互相独立。请持续使用此评委入口，避免切换到另一份尚未配置 AI 的资料。

## 首次启动失败

请确认 ZIP 已完整解压，`START-REVIEWER.cmd`、`START-REVIEWER.ps1`、`评委用apikey.txt` 与 `output` 文件夹位于同一根目录。修正缺失文件后再次双击即可；失败的初始化不会启动应用或覆盖已有玩家资料。

也可参照随包的图文教程，在正常应用界面手动添加服务。API key 不写在脚本中；首次配置在评委本人 Windows 用户下生成加密凭据。本脚本不会向模型发送测试请求或消费模型额度。

## 验证与源码

本脚本适配本包 preview.28 的内置配置服务，使用 Windows 自带 PowerShell 5.1，不需要安装 Node.js、Python 或 Codex CLI。脚本明文即对应源码，使用 AGPL-3.0-only，许可证随应用提供。
