# FB04-003：免安装包的新玩家入口

`START-NEW-PLAYER.cmd` 每次生成新的 GUID，资料目录为 `%LOCALAPPDATA%\CraftmineWorld-NewPlayers\player-<GUID>`。不复制任何旧账号、密钥、模型设置或世界，不清空、不覆盖已有资料。应用仍使用产品正常的首次启动流程，七份示例可以从包内 `examples` 按原流程导入。

启动器会显示资料路径，并在包内生成 `NEW-PLAYER-SESSIONS\CONTINUE-<GUID>.cmd`。这个入口固定恢复同一玩家；使用前验证资料身份标记，不在标记丢失或身份不符时悄悄建立新档。包内入口使用相对路径，整包移动后仍可恢复本机同一资料。换电脑需要另行迁移资料，不自动复制。

`START-PLAYER-PREVIEW.cmd` 保留本版本日常试玩入口；`CONTINUE-PREVIEW27.cmd` 使用原 preview.27 资料目录，方便已有玩家继续。不要同时打开多个实例操作同一份资料。

导出器直接生成这些入口，并随 ZIP 逐文件校验；不放开 extras 的可执行根文件白名单。PowerShell 脚本拒绝非法 ID、不存在或不匹配的身份标记，以及资料或入口路径中的目录链接。清理继承的 `CRAFTMINE_*`、`PI_DESKTOP_*`、`NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE` 后，仅传入本次资料目录。

定向测试在独立临时目录编译无界面的假 EXE，真实执行 CMD / PowerShell 启动链，验证两次启动产生不同资料、继续入口恢复同一资料、已有玩家资料不变、环境清理和错误身份拒绝。路径包含中文、空格、`!`、`&` 和括号；不启动生产 GUI，不操作鼠标键盘。这一测试验证启动及隔离语义，不能替代产品首次启动的完整体验验收。
