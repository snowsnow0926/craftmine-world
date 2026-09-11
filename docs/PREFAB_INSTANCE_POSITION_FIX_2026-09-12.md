# 预制实例位置校验修复

冻结 `9c8a97a1` 成品首次演示在 `D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/report.json` 保留失败：自然环境已真实检查并采用；第一棵橡树在源码写入前报 `PACKAGE_POSITION_REQUIRES_3D_NODE`。三个退出审计数组为空，零模型调用。

原因是新增位置适配读取 `parseScene(...).nodes` 根节点不存在的 `type` 字段。实际解析器保留 `attributes`，该预制场景根明确为 `type="Node3D"`。现改为从已解析根的 attributes 读取类型；没有放宽未知类型或二维组件的拒绝，没有改素材及受测成品。

真实 Rust 回归改用与此次预制包一致的 instance 模式 `.tscn`：实际入库、读取、提案、安装进 Godot 源码并验证 `position = Vector3(3, 0, -4)`，通过。新增二维组件仍在源码写入前拒绝的用例，共 5 项定向测试通过，使用冻结成品中的 Rust core、全新隔离目录，无引擎或模型调用。

下一次成品验收应明确沿原 profile 继续第一棵树，保留已经采用的自然环境和原失败报告，不能重写旧结论或冒充首次全程成功。
