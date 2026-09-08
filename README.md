# 最中幻想 · craftmine world

从一个能走动的空白 3D 世界开始，用自然语言逐步创造内容。

**本地创作 Alpha 0.3 已可以试玩：输入“我想要有树”，由真实 LLM 生成场景候选，应用后进入世界，指向这棵树继续修改。** 当前支持方块场景对象，任意玩法脚本和精细模型生成仍待开发。

## 启动

在 Windows 中双击根目录的 `start.cmd`，保持启动窗口打开，然后用 Chrome 或 Edge 打开：

**[http://127.0.0.1:8787](http://127.0.0.1:8787)**

也可以在根目录运行：

```sh
node app/server.mjs
```

需要 Node.js 22 或更新版本，无需安装运行时 npm 依赖。本机已检测到 Node.js 和已登录的 Codex CLI。其他电脑需要先安装 Codex CLI，并在本机终端执行 `codex login`。模型请求使用已登录账号的额度，生成需要联网；游戏和存档保存在本机。

页面提示“另一个窗口正在使用此项目”时，关闭另一个工作台，等待约 15 秒后刷新。如果本地服务已经启动，直接打开地址即可。

## 第一次体验

1. 点击“进入世界”，WASD 移动，鼠标环顾，Space 跳跃，Shift 冲刺。
2. 按 T 打开对话，或直接在右侧输入：**我想要有树**。
3. 发送后可回到世界继续走动；真实生成任务会显示阶段，并可取消。
4. 候选就绪后，点击“应用并进入世界”。系统先保存最新位置，再载入新场景。
5. 靠近并将准星对准树干，按 T，输入：**把这棵树变高一点**。也可在“素材”工作区选中对象。
6. “开发”工作区可查看实际执行记录、生成的场景内容，以及准备恢复此前的场景版本。

Esc 释放鼠标。浏览器不允许鼠标锁定时，按住画面拖动仍可环顾。“只讨论”不会改变世界；执行期间的讨论会先记录，当前任务结束后可继续发送。

## 存档与恢复

新项目默认保存在根目录的 `.craftmine/`，包含版本、对象、位置、任务记录与对话。位置每约 3 秒自动保存，应用候选时立即读取最新位置并备份。场景回退与恢复完整存档分别处理。

- 右上角“导出存档”导出当前场景和最新位置。
- “开发 → 本地数据与完整存档”中可以导入；导入先形成候选，应用前备份当前世界。
- 游戏更新加载失败时恢复旧窗口；连接中断而无法核对应用状态时，提示刷新后从本地已确认版本恢复。

不要删除 `.craftmine/` 来更新程序；重要作品请主动导出备份。

## 可选配置

配置通过启动 Node 进程的环境变量传入，[.env.example](.env.example) 给出不含密钥的例子；它不会被自动加载。

| 变量 | 用途 |
| --- | --- |
| `CRAFTMINE_PORT` | 默认 `8787` |
| `CRAFTMINE_CODEX_PATH` | 指定本机 `codex.exe`，通常会自动找到 |
| `CRAFTMINE_MODEL` | 可选的可用模型 ID；默认使用 CLI 默认模型 |
| `CRAFTMINE_DATA_DIR` | 为另一个独立本地数据目录启动项目 |

例如 PowerShell 中更换端口：

```powershell
$env:CRAFTMINE_PORT = '8788'
node app/server.mjs
```

应用复用 Codex CLI 的本机登录和结构化输出能力，见[官方非交互执行说明](https://learn.chatgpt.com/docs/non-interactive-mode)。它不会把登录凭据放进页面、场景或导出存档。

## 开发与验证

```sh
node --test tests/core.test.mjs
node tests/browser.mjs
node tests/browser.mjs --live
node tests/legacy-baseline.mjs
```

核心测试仅需 Node.js。浏览器测试需要 Playwright 和 Chrome／Edge；本机可使用已提供的 Playwright 运行库，其他环境可安装 Playwright，或用 `PLAYWRIGHT_MODULE_PATH` 指定模块位置。`CRAFTMINE_BROWSER` 可指定浏览器路径。

`--live` 会实际请求模型，测试从工作台造树、修改同一棵树及取消任务。普通浏览器测试使用明确标识的人工场景夹具，不计为 LLM 验收。所有测试数据在独立的 `test-results/` 下，不使用个人的 `.craftmine/` 世界。

- [实现说明与本轮验证记录](docs/IMPLEMENTATION.md)
- [产品想法](docs/PRODUCT_VISION.md)
- [开发计划](docs/DEVELOPMENT_PLAN.md)

## 项目基线

正式英文名为 **craftmine world**，中文名为 **最中幻想**，替代旧暂名「世界工坊 / World Workshop」。

`app/` 是新工作台主线。`world-workshop-3d/` 保留 0.2「林间起点」原型及原来的存档和卡带约定，新运行器复用其中的渲染与物理基础。`world-workshop-3d.zip` 是原始交接包。旧原型仍可单独打开，不与新项目的数据混用。

整体方向继续保留开发、游玩、素材三个工作区。多人共创、玩法模组、素材生成和社区复用属于后续阶段。
