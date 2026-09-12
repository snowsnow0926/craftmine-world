# 林间入口：真实产品安装与行走验收

本样本是开发者组合的预制场景，不是模型自主作品，也不是和旧环境任务相同输入的 A/B 对照。

固定产品源提交为 `fcf0ece21abf53a52e42530dccb3a00716694713`，版本 `0.14.4-preview.12`；完整目录为 `D:/cm-promo-loop-0912/desktop/build/releases/fcf0ece21abf-a621cd20-365e-4f45-8470-587075b12da5/output/win-unpacked`。包 inventory SHA256：`b610bc0b338d50f9f84c7e69eec163f952816290136c7e7cdd619433ce517bb6`。

最终新隔离档案：`D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9`，世界 `world-dd7fa4f8fff6`。正式 UI 使用的导入接口依次安装自然日光与 `cw.scene.forest-gateway`，场景根位置为 `(0,0,0)`。两个包各 6 项正式检查通过，再经过预览、采用、保存和冷重开。没有模型配置/请求，没有修改生成作品或产品资源；两次启动的输入、页面错误与退出审计均为空。

通过既有有限步行接口，玩家从 z=6 后退到约 12，再到 16.50 获取完整正面；接着实际前进到约 5.65 靠近门洞，继续到 0.02389 穿过门后。没有写入玩家位置或模拟位移。门洞中心为 z≈2.833，过程中玩家保持落地。保存后启动新进程，玩家位置、朝向及俯仰完全相同；源码 revision=3、manifestHash 与采用 build 同样保持一致。

已经查看四张真实原图：正面可以看出高低不同的橡树、松树、门楼与两侧地被；近景可以看到门洞保留了真实开口；穿门后能看到林内通道及树、花、石，冷重开画面复现。局限也明确：它仍是较小的低多边形场景，叶色偏青，阴影较深，门楼没有连接围墙，外围平地与世界边界仍明显。它提供更完整的素材和布局起点，不能据此宣称已得到自然森林或模型自主复用成功。

原始结果与图片：

- [完整报告](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/report.json)，SHA256 `5ab06cd678b69ac2a0e214c4bb35efcc6cee4e283e4694b42e73c298cb250661`。
- [完整正面](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/forest-front.png)
- [靠近门洞](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/forest-approach.png)
- [穿门后](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/forest-inside.png)
- [冷重开](D:/cm-forest-product-demo-0912/test-results/desktop-native-complete-qQcut9/reopened.png)
- [本地对比页](D:/Craftmine-Prefab-Preview-20260912/index.html)，包含旧模型原创环境图与上述四图，原字节复制；`manifest.json` 保留原路径与 SHA256，`report.json` 是未改写的验收报告。未自动打开浏览器、未上传。

第一次新档案 `desktop-native-complete-WyFDUn` 已完成两包检查和采用，但驱动追加单步 140 帧被正常接口的 120 帧上限拒绝；报告保留，不计为完整成功。修正为 120+20 的既有有限动作后，在另一个全新档案完成上述验收。没有为了通过而修改接口限制、清理失败档案或修改原报告。

复验命令为 `node tests/builtin-prefab-demo.mjs --packaged-root <固定产品绝对目录> --plan tests/fixtures/forest-gateway-demo-plan.json --forest-walkthrough --run`。省略 `--run` 先检查实际包身份。4 项既有驱动契约测试通过；最终另行对原报告验证冷重开姿态、源码 hash/revision、build 与审计记录一致。
