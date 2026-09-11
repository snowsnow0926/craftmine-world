# 普通犬资源检查：官方 Drive 下载配额阻断

本轮仅检查首选 Quaternius Ultimate Animated Animal Pack 的普通犬候选，遵循项目 `docs/LICENSING_STRATEGY.md` 的第三方素材许可与再分发来源核对要求。没有改用方块犬，没有制作或冒称白色博美，没有改成品、素材库、模型作品或用户档案。

## 已确认的来源信息

[官方资源页](https://quaternius.com/packs/ultimateanimatedanimals.html) 标注 CC0、12 种动物、每种 12+ 动画及 glTF/FBX/Blend/OBJ 格式。页面的实际 Download 按钮指向 [官方 Google Drive 文件夹](https://drive.google.com/drive/folders/1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk)。匿名正常访问可看到 Blends、FBX、glTF、OBJ 子目录，以及 License.txt、预览图/视频，**没有看到作者发布的原 ZIP**。

[glTF 子目录](https://drive.google.com/drive/folders/1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry) 确有 `ShibaInu.gltf` 和 `Husky.gltf` 条目。这只证明官方目录发布了这些文件名，不能据此确认它们当前实际动画、材质、尺寸或可用性。

## 下载失败及检查边界

从 [License.txt 的官方文件页面](https://drive.google.com/file/d/1F2uy8T2fRpdc6gZ4mnS02_C2E63WvKtn/view) 取得正常 Download 地址，请求自动跳转后返回 HTTP 200，但内容类型为 `text/html; charset=utf-8`，标题为 **Google Drive - Quota exceeded**。页面明确表示近期访问/下载过多，当前无法下载，需要稍后再试。下载器拒绝该 HTML，没有把配额提示保存成许可证或素材。

截至停止时，**没有取得任何模型、原许可文件或原 ZIP 字节**，因此没有可记录的素材 SHA-256。未检查真实 Idle/Walk 名称、动画通道、骨骼、网格、纹理、尺寸、朝向；没有运行 Godot 导入或 Compatibility/Web 验证。官方 CC0 声明与目录信息仍保留，不能把它们写成实际文件检查通过。

没有尝试登录、代理、镜像、配额绕过或继续下载其他动物包；没有安装工具，也没有调用模型。根据总控本轮范围，到此结束；实际资源核验需等官方正常下载恢复后另行继续。

机器记录：`D:/cm-capture-product-acceptance-0912/test-results/quaternius-canine-ee6c5996-cf2b-4a81-9a7f-b78ec1c713f5/report.json`，状态 `blocked-upstream-download-quota`，包含官方来源链、发现的三个文件 ID、实际错误响应信息以及所有未执行项。没有伪造原文件哈希或兼容性结果。
