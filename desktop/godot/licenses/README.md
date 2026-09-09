# 离线许可与声明入口（Godot 工具链 / PI-Desktop 基线）

本目录是随包提供的**离线许可入口**的一部分。玩家或审阅者不需要联网即可查看引擎、上游基线、字体和第三方依赖的许可与版权声明。这里只记录可核对的事实和文件位置，不构成法律意见，也不重新授权任何内容。

## 1 目录内容

| 文件 | 覆盖对象 | 许可 | 固定哈希（SHA-256） |
| --- | --- | --- | --- |
| `GODOT_LICENSE.txt` | Godot 引擎 4.7.2-stable | MIT | `b0435e3b3e4e55238f05f4b306f30524a1b2e20147810d436eaa554fa6855c80` |
| `GODOT_COPYRIGHT.txt` | Godot 随引擎分发的第三方组件（单文件汇总） | 各组件原许可 | `cb1980c88089573bcacd7221d777c689bb8bbd778799f24c27fca0fe5f774d6d` |
| `notices.manifest.json` | 本目录的可机读清单 | 元数据 | 由 `desktop/delivery/preflight.mjs` 校验 |

两个文本的哈希同时记录在 `desktop/godot/toolchain.lock.json` 的 `licenses` 字段中。清单与锁文件必须一致；任一侧被改动而另一侧未同步时，预检会失败。

**Godot 的 MIT 许可不能替代 PI-Desktop 的 LGPL 义务。** 两者的来源、覆盖范围和文件位置都不同，详见第 3 节。

## 2 各声明的来源

以下 URL 仅用于说明文件的官方出处。随包交付的是上表中的固定文件，运行时不依赖这些地址。

| 声明 | 官方来源 |
| --- | --- |
| Godot MIT 许可 | <https://godotengine.org/license/> |
| Godot 分发许可说明 | <https://docs.godotengine.org/en/stable/about/complying_with_licenses.html> |
| Godot 4.7.2-stable `LICENSE.txt` | <https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/LICENSE.txt> |
| Godot 4.7.2-stable `COPYRIGHT.txt` | <https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/COPYRIGHT.txt> |
| Godot 商标政策 | <https://godot.foundation/policies-and-procedures/trademark-policy> |
| PI-Desktop 上游 | <https://github.com/vastsa/PI-Desktop> |

## 3 PI-Desktop 的 LGPL 材料（单独核对）

PI-Desktop 基线固定在上游提交 `ed0a75414e775eef4b4ee6c985cc9ddfe146ced2`，声明为 **LGPL-3.0-or-later**，记录在 `desktop/UPSTREAM.json`。

| 材料 | 位置 | 核对方式 |
| --- | --- | --- |
| LGPL 全文 | `vendor/pi-desktop/LICENSE` | 内容必须包含 LGPL-3 与 GPL-3 正文，且**不得**包含 MIT 的 “Permission is hereby granted, free of charge” 段落 |
| 上游来源 | `desktop/UPSTREAM.json` | `license` 字段必须为 `LGPL-3.0-or-later`，`commit` 必须与基线一致 |
| 对应源码 | 包内 `resources/source/CraftmineWorld-source.zip` | 与 `resources/source/build-manifest.json` 记录的哈希一致 |
| 包内许可副本 | 包内 `resources/licenses/PI-Desktop-LICENSE.txt` | 与 `vendor/pi-desktop/LICENSE` 字节一致 |

这些义务不会因为客户端内置了采用 MIT 的 Godot 而消失，也不能用 Godot 的许可文本顶替。`desktop/delivery/preflight.mjs` 的 `lgpl` 与 `package` 检查会强制这些条件。

## 4 打包时必须额外带上的内容

客户端发行包和玩家导出的独立作品需要携带的声明不同：

| 场景 | 必须携带 |
| --- | --- |
| 客户端安装包 | 本目录全部文件、`resources/licenses/PI-Desktop-LICENSE.txt`、`CRAFTMINE-NOTICES.md`、`resources/licenses/third-party/npm-inventory.json` 及其抄录的许可文本、字体许可、对应源码归档 |
| 内置 Godot 时 | 另需在包内 `resources/licenses/godot/` 放置本目录的 `GODOT_LICENSE.txt` 与 `GODOT_COPYRIGHT.txt`，并在 `CRAFTMINE-NOTICES.md` 中说明引擎版本与 MIT 覆盖范围 |
| 玩家导出的独立作品 | 导出目录内的 `licenses/`（引擎 MIT 与第三方汇总），以及作品自身素材的许可 |

当前 `desktop/godot/toolchain.lock.json` 的 `status` 为 `gd0-candidate-not-production-bundled`，即**引擎尚未进入正式发行包**。预检会检查包内是否真的存在引擎可执行文件，只有存在时才要求 Godot 声明，避免用“以后再说”蒙混过关，也避免对尚未内置的版本误报失败。

## 5 素材与底座资源

预设底座和示例的素材来源、作者、版本、许可和再分发条件，逐项记录在 `desktop/delivery/base-assets/*.json`。该清单区分：

- **应用随包资源**（`distribution` 含 `app-bundle`）：随客户端一起分发给玩家；
- **允许用户拆用与导出**（`distribution` 含 `user-export`）：可以进入玩家导出的独立作品；
- **仅开发使用**（`development-only`）：不得进入任何发行物。

Godot 的 MIT 许可不覆盖游戏素材；素材许可必须逐项核对。缺少来源、许可或哈希的条目会让预检失败，而不是被静默跳过。

## 6 如何自行核对

```powershell
# 离线核对许可与声明（只读，不联网）
node desktop/delivery/preflight.mjs licenses

# 核对底座素材清单、来源与哈希
node desktop/delivery/preflight.mjs assets

# 核对 PI-Desktop 的 LGPL 交付材料
node desktop/delivery/preflight.mjs lgpl

# 一次性运行全部检查并写出证据
node desktop/delivery/preflight.mjs all --evidence test-results/delivery-preflight/report.json
```

预检只读取文件、计算哈希并比对清单。它不会下载任何内容、不会运行安装器、不会改动被检查的目录。
