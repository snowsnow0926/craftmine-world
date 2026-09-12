# 内置 Blender 工具链

固定使用 Blender 5.2.1 LTS Windows x64 完整官方便携包。开发缓存默认位于
`desktop/build/blender`（Git 忽略），不依赖玩家安装的 Blender 或 PATH。

```powershell
node desktop/blender/toolchain.mjs
# 也可以使用独立绝对路径缓存：
node desktop/blender/toolchain.mjs --cache 'D:\Toolchains\Craftmine-Blender-5.2.1'
```

准备过程下载官方 ZIP 及源码归档，核对固定 SHA256/大小，拒绝路径穿越、
重复大小写路径和链接，解压后核对全部 6526 个文件。已有缓存不自动覆盖，
文件缺失、修改或多出文件均失败；升级需要重新审查官方校验和及完整文件清单。
`toolchain.lock.json` 的 ZIP SHA256 来自官方发布校验和；源码 SHA256 是从
官方 HTTPS 下载后计算的，元数据明确区分这两种来源。

当前体积：ZIP 404,851,964 字节；解压运行文件 944,579,836 字节；附带的
上游源码归档 93,666,248 字节。许可证重复副本、broker 和作业资产另计。

正常 Windows 打包增加 `-BlenderCache <绝对缓存目录>`；`build-client.ps1`
构建 Blender broker 并把完整工具链纳入普通资源 staging、清单和封装核验。
staging 只读取已准备缓存，不在发版时联网下载。最终路径：

```
resources/blender/runtime/blender.exe
resources/blender/toolchain.lock.json
resources/blender/broker/blender-host-broker.exe
resources/blender/broker/broker-identity.json
resources/blender/bridge/driver.py
resources/blender/source/blender-5.2.1.tar.xz
resources/licenses/blender/README.md
resources/licenses/blender/upstream/...
resources/licenses/gpl/GPL-3.0.txt
```

后台任务必须禁止 Python bytecode 写入、把配置/缓存定向到独立任务目录，
保留原始工具链完整字节。不得弹窗、前置窗口或使用鼠标键盘验收。
沙箱权限、模型参数及玩家体验验证由 broker/工具流负责。

许可证和对应源码交付责任见 [licenses/README.md](licenses/README.md)。
该集成具备本地构建和源码交付记录，不把本地测试描述成公开发行或完整法律审查。
