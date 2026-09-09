# 任务 H 对外接口说明

所有接口都是新增文件。H 未修改固定引擎版本、A 的隔离代码、B/C 的运行接口、各底座源码或公共打包入口。

## 1 给 I（打包与集成）

### 1.1 需要新增的包内路径

引擎入包时，包内必须出现：

```
resources/licenses/godot/GODOT_LICENSE.txt      # sha256 b0435e3b…5c80
resources/licenses/godot/GODOT_COPYRIGHT.txt    # sha256 cb1980c8…4d6d
```

来源为仓库 `desktop/godot/licenses/` 的同名文件（与 `toolchain.lock.json` 固定一致）。同时 `resources/licenses/CRAFTMINE-NOTICES.md` 必须提到 Godot 与 MIT，否则预检报 `PACKAGE_GODOT_NOTICE_UNDECLARED`。未内置引擎时不要求，也不会误报。

### 1.2 产物路径映射（已实现的隐含契约）

`build-manifest.json` 的 `artifacts[].path` 是构建机相对路径，包内路径不同。预检内置以下映射；若打包入口调整映射，请同步告知：

| `artifacts[].path` | 包内路径 |
| --- | --- |
| `vendor/pi-desktop/target/release/pi-desktop-host-core.exe` | `resources/bin/pi-desktop-host-core.exe` |
| `vendor/pi-desktop/target/release/craftmine-core.exe` | `resources/bin/craftmine-core.exe` |
| `vendor/pi-desktop/packages/agent-runtime/dist-bundle/sidecar.js` | `resources/agent-runtime/sidecar.js` |
| `vendor/pi-desktop/apps/desktop/resources/plugins/craftmine.world/manifest.json` | `resources/plugins/craftmine.world/manifest.json` |
| `desktop/build/CraftmineWorld-source.zip` | `resources/source/CraftmineWorld-source.zip` |

未列出的产物按唯一同名文件匹配；匹配不到即 `PACKAGE_ARTIFACT_UNMAPPED`。

### 1.3 建议接入方式

```powershell
node desktop/delivery/preflight.mjs all --package <win-unpacked> --evidence <report.json>
```

非零退出码应作为发布门禁。`--evidence` 记录可直接并入交付证据。

### 1.4 版本与构建时间证据

预检采集并写入证据的字段：`commit`、`sourceDate`、`appId`、`sourceArchiveHash`、`toolchain.{node,cargo}`、产物数量、第三方包数量与缺文本数量、`lockVersion`、`lockStatus`、`editorSha256`、`webTemplate`、导出 `buildId`/`engineVersion`/`bytes`/`files`。若 I 需要额外字段（例如 NSIS 安装器哈希、签名状态、构建墙钟时间），请提供字段名与来源文件，H 在 `collectBuildFacts` 中补齐。

## 2 给 B/C（底座与运行接口）

- 修改 `desktop/godot/probes/**` 或 `desktop/godot/web/**` 后，`desktop/delivery/base-assets/*.json` 的 `bytes`/`sha256` 会不匹配，预检按设计失败。请在同一个提交中更新对应条目与 `reviewedCommit`，或通知 H 重新核对来源。
- 底座目录内不要放导入缓存、生成物或临时文件；未声明文件会被判为 `ASSET_UNDECLARED_FILE`。
- 新增素材（贴图、模型、音频、字体、插件）时，必须在清单中补齐 `origin`、`author`、`version`、`license`、`licenseFile`、`redistribution`、`distribution`，否则预检失败。Godot 的 MIT 不覆盖素材。
- `development-only` 条目（当前只有 `desktop/godot/web/host.mjs`）不得进入发行包或导出物。

## 3 给 A（隔离）

无需接口变更。预检不读取或修改 `desktop/godot/sandbox/**`，也不把隔离状态作为许可结论。

## 4 给根文档与共享文件

- 建议在根 `.gitattributes` 增加 `desktop/delivery/** text eol=lf`，使工具在 Windows 检出时保持 LF。当前 CRLF 转换不影响任何固定哈希（被哈希的 `desktop/godot/probes/**`、`desktop/godot/licenses/**` 已有规则）。
- 建议在 `package.json` 的测试脚本中增加 `node desktop/delivery/preflight-selftest.mjs`；H 未修改该文件以避免争抢共享入口。

## 5 预检失败码（供 CI 与报告引用）

`NOTICE_*`、`LOCK_NOTICE_*`、`LGPL_*`、`ASSET_*`、`CACHE_*`、`EXPORT_*`、`PACKAGE_*`、`REBUILD_INPUT_MISSING`、`LOCK_INVALID`。完整清单见 `desktop/delivery/README.md` 与 `desktop/delivery/lib/preflight-core.mjs`。
