# 最中幻想 · Craftmine World

**可能是一种全新的游戏方式。**

[English](README.md) · 简体中文

> 开放世界，能有我开放吗？

如果创造游戏，本身就是游玩的一部分，会发生什么？

**最中幻想**，探索 AI + 游戏的全新打开方式。在这里，做游戏与玩游戏的边界开始消失。你可以从一个通用的空白世界出发：它可以是 3D 世界，也可以是 2D 俯视角场景，或是 2D 横版关卡。眼前的世界不必止步于开发者预先写好的内容，而可以随着你的想法继续生长。

想要一棵树，就让它在眼前生根；想要一片花海，就让荒地开满鲜花。想养一只小狗、拿起一把剑，或挑战一头巨兽？用文字或语音说出想法，让 AI 寻找可复用的素材，或制作新的内容。等待检查完成、世界更新，再亲自走进去体验。

我们想带来的，是一种如同造物主般的体验：**让想象成为指令，让创造融入游玩，让“言出法随”成为你与游戏世界相处的方式。**

无限释放玩家的创造力，朝着“想玩什么，就能创造出什么”迈进。

[开始体验](#开始体验) · [创造如何发生](#创造如何发生) · [从源码构建](#从源码构建) · [许可证](#许可证)

## 当前 Demo

**Windows x64 · `0.14.4-preview.27` · 免安装 ZIP**

项目在原有 **PI Desktop** 界面上扩展世界游玩、素材库与 AI 创作流程，以 **Godot** 运行游戏世界，并内置 **Blender** 支持后台建模。最新完整验收集中在空白 3D 世界；仓库也包含 2D 俯视角与横版底座，各底座的能力和验证范围不同。

| 你想做的事 | 当前支持 |
| --- | --- |
| 先玩起来 | 打开示例世界，或从已保存的世界模板创建独立副本。 |
| 从零创造 | 进入空白 3D 世界，用自然语言逐步添加内容与玩法。 |
| 说出想法 | 通过可用的 Windows 本地语音识别，将语音变成可编辑的文字草稿。 |
| 复用已有成果 | 查询 34 类素材、41 个版本，以及 4 个完整参照世界。 |
| 保留自己的进度 | 保存世界、在更新时保留兼容状态，并在下次打开后继续。 |
| 分享世界起点 | 保存到本机素材库、导出模板 ZIP，再由模板创建新世界。 |
| 选择自己的 AI | 使用 PI 连接自己的模型服务，或配置另外安装的 Codex CLI。 |

最新一轮真实 DeepSeek 测试，在同一个空白世界完成了：

**树 → 花草 → 小怪 → 重剑 → 巨兽试炼 → AK47。**

验收包含物体实际显示、小怪攻击、近战伤害、射击、换弹、武器切换、保存和重开。该轮六步创作累计约 **17 分 31 秒**；这是一次实测结果，不是每次生成的耗时承诺。完整配置、失败记录、修复和测试边界见 [Demo 验收记录](docs/DEMO_PREVIEW27_DELIVERY_ZH.md)。

## 开始体验

### 使用 Demo 成品包

1. 向项目维护者取得完整的 Windows 免安装 ZIP。GitHub 的 **Code → Download ZIP** 下载的是源码，不是可直接运行的应用包。
2. 完整解压后，双击 `START-PLAYER-PREVIEW.cmd`。保留 EXE 周围的资源文件，不要只复制一个程序文件。
3. 打开已有示例，或在新建世界中选择 **3D 造物世界 → 空白起点**。界面名称以所选语言和实际版本为准。
4. 需要 AI 创作时，在设置中连接自己的模型服务并选择模型。成品包不包含个人 API key，模型调用使用你自己的账户额度。
5. 先提出一个需求，等待检查与应用完成，再回到世界里走动、观察和试玩。

游玩已有世界、执行受支持的素材库和模板操作，不需要发起 AI 请求。3D 造物世界支持 **WASD** 移动、**E** 互动、**F2** 打开创作对话；其他按键以当前世界的画面提示为准。语音输入需要麦克风权限及对应的 Windows 语音语言组件。

包内 `examples/deepseek-six-step-playtested.zip` 可以直接复现上述六步造物世界，不必重新运行 AI。通过世界入口导入模板，再创建副本即可体验；它保留了实测时的游玩进度。

包名、校验值、资料目录和继续旧版试玩的方法，见 [当前 Windows 交付说明](docs/CURRENT_WINDOWS_DELIVERY.md)。

### 第一次创作可以这样开始

逐条发送，每次完成后先试玩，再继续下一步：

```text
我想要一棵树。
我想地上有些花草。
我想生成一些怪物。
给我一把剑。
我想玩怪猎，给我生成一个大怪物。
给我一把 AK47。
```

然后继续加入自己的想法：改变场景、增加伙伴、调整战斗，或设计另一种目标。把满意的成果保存进素材库，让下一个世界从已有创造出发。

## 创造如何发生

**表达想法 → 查看当前世界 → 查询已有素材 → 创作或调整 → 检查 → 应用 → 游玩。**

Agent 会先了解世界里已有的内容，再查询相关素材及其用法、接口和依赖。合适的物件或玩法可以直接复用，新的想法则可能需要编写源码或调用 Blender 建模。全自动模式下，符合条件的改动会在检查通过后更新到世界；其他流程会先展示安装提案或候选结果，供玩家确认。

模型回复完成、素材安装、检查通过与世界实际更新，是不同的步骤，结果面板会显示对应进度。创造速度与成功率取决于模型、服务状态、需求复杂度及已有素材。兼容进度会被保留，不兼容的修改可能需要先修复再应用。

当前版本重点是本地创造与本机复用。公共素材社区、在线共享检索和多人共创是后续方向。已完成的六步测试，也不代表所有模型、所有开放式需求都能一次成功。

## 从源码构建

Windows 应用开发需要 **Node.js 24**、**pnpm 11**，以及带 **Visual Studio C++ Build Tools 的 Rust MSVC 工具链**。使用成品包的玩家不需要安装这些开发工具。

```powershell
git clone --branch main https://github.com/snowsnow0926/craftmine-world.git
cd craftmine-world
pnpm -C vendor/pi-desktop install --frozen-lockfile
```

按照 [Windows 构建文档](desktop/README.md) 准备固定版本的 Godot、Blender 与 MinGit 输入，然后在干净的 Git 工作区执行：

```powershell
powershell -NoProfile -File desktop/build-client.ps1 `
  -GodotCache '<Godot 缓存的绝对路径>' `
  -BlenderCache '<Blender 缓存的绝对路径>' `
  -GitArchive '<MinGit ZIP 的绝对路径>'
```

构建会生成 `desktop/build/releases/<commit>-<id>/` 目录，包含应用和构建证据；导出免安装 ZIP 是后续步骤。具体输入哈希与命令见构建文档。根目录 `npm start` 启动的是**早期 Web 运行器**，不是 PI Desktop 应用。

| 目录 | 职责 |
| --- | --- |
| `vendor/pi-desktop/` | 基于 PI 的桌面界面、Agent 运行时、原生宿主与 Craftmine 领域服务。 |
| `plugins/craftmine-world/` | 世界创作工具、检查、应用流程及素材复用。 |
| `desktop/godot/` | 世界底座、运行时桥接、组件与引擎工具。 |
| `desktop/blender/` | Blender 接入、Python 适配器与原生代理。 |
| `desktop/delivery/` | 打包、来源记录、许可清单与交付检查。 |
| `app/`、`world-workshop-3d/` | 早期 Web 运行器与原型，作为独立的历史实现保留。 |
| `tests/`、`docs/` | 测试、设计决策、玩家指南与验收证据。 |

近期创作修复的本地 CPU 冒烟检查：

```powershell
node --test tests/operator-world-session.test.mjs tests/world-publication-capture.test.mjs
```

开发与验证请遵循 [AGENTS.md](AGENTS.md)。浏览器自动验收使用独立 headless 进程和测试资料目录，不抢占用户鼠标、键盘或 Pointer Lock。原生和真实模型测试需要相应工具链与明确配置。

## 许可证

项目自有创作软件采用 **AGPL-3.0-only**，明确列出的自有导出运行时代码采用 **MIT**。PI Desktop 及受其许可覆盖的修改保留 **LGPL-3.0-or-later**；Blender 和 Blender Python 适配器保留各自适用的 **GPL** 条款。素材和其他第三方依赖继续适用各自许可。

请从 [许可证正文](LICENSE)、[许可范围与例外](LICENSING.md)、[中文许可说明](LICENSE.zh-CN.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md) 阅读。仅仅使用本工具，不会让你的原创游戏自动变成 AGPL 作品；导出作品实际包含的代码和素材仍须遵守各自条件。符合条件的自有创作代码可与维护者洽谈另一种商业授权，该授权不覆盖第三方权利。

## 更多资料

- [已有素材目录与复用方案](docs/EXISTING_ASSETS_AND_REUSE_FIRST_PLAN_2026-09-15_ZH.md)
- [当前 Demo 验收记录](docs/DEMO_PREVIEW27_DELIVERY_ZH.md)
- [Windows 客户端构建说明](desktop/README.md)
- [许可范围与例外](LICENSING.md)
- [早期 Web 运行器历史说明](docs/legacy/WEB_RUNNER_ALPHA_0_8.zh-CN.md)
- [反馈问题或提出想法](https://github.com/snowsnow0926/craftmine-world/issues)

感谢 PI Desktop、Godot、Blender、Kenney，以及第三方声明中列出的开源项目与工具。
