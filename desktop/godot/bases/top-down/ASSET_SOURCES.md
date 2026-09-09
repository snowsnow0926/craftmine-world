# 素材来源与许可（2D 俯视底座）

## 结论

本底座使用的全部像素素材都是**本仓库自己的生成脚本画出来的原创图形**，没有复制
Stardew Valley、RPG Maker、Godot 官方示例或任何第三方素材包的任何像素。

- 生成器：`tools/make-assets.mjs`
- 输出：`core/assets/**`（并被复制到每个世界工程的 `assets/**`）
- 生成方式：纯程序绘制 + 固定种子的伪随机噪点，PNG 由脚本内的最小编码器写出
  （只用 Node 内置 `zlib`，没有第三方依赖）

因此这些素材的著作权与再分发条件由本项目自行决定；它们不是"可商用的第三方素材"，
也不是"Godot 官方素材"，而是项目自有内容。随客户端分发、被玩家拆用、被导出游戏带走
都不需要额外授权，只需遵守项目整体许可安排。

## 文件清单

| 文件 | 尺寸 | 内容 |
| --- | --- | --- |
| `core/assets/tiles/town_tiles.png` | 128×64 | 8×4 瓦片图集，16×16 一格：草地/路/石路/木地板/砖墙/屋顶/门/窗/牌子/栅栏/草药/柜台/货架/木箱/树干/树冠/阴影等 |
| `core/assets/tiles/town_tileset.tres` | — | 引用上面的图集的 TileSet 资源，由生成器同步写出 |
| `core/assets/characters/player_sheet.png` | 64×64 | 玩家 4 方向 × 4 帧行走图，16×16 一格 |
| `core/assets/characters/npc_sheet.png` | 64×64 | NPC「米拉」，同规格 |
| `core/assets/characters/shopkeeper_sheet.png` | 64×64 | 店主，同规格 |
| `core/assets/ASSET_MANIFEST.json` | — | 每个文件的字节数与 SHA-256 |

重新生成（幂等，固定种子）：

```powershell
node desktop/godot/bases/top-down/tools/make-assets.mjs
```

## 字体、音频与第三方库

- 本底座**没有**引入任何字体、音乐或音效文件。
- 本底座**没有**引入任何 Godot 插件、GDExtension 或第三方 GDScript 库。
- 运行时只依赖 Godot 4.7.2-stable 本身。Godot 的 MIT 许可与版权声明在
  `desktop/godot/licenses/`，Web 导出会随构建带上对应声明。

## 引用 Godot 名称

本项目说明"使用 Godot 引擎"，不使用 Godot 图标暗示官方背书；如需在界面里展示
引擎名称，遵循 Godot 商标政策。
