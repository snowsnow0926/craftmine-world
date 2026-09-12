# 原城墙源码检查恢复与五组件收尾

使用同一冻结 `bafb5b180bcecbc5f2258a8d1bc032077ddc7eff` 成品、同一 VO4Pki profile、同一 `world-cafb76a24e7c`。全程零模型，不重新安装城墙、不更改源码、不创建第二个墙实例。

正常 UI 已有历史面板“检查当前分支”：通过主窗口 `godot.historyLoad` 读取 main，核对 revision 6 / manifest `4efd8838135d69a8b4f50a8e17584eb14b1e3f3046295d034fd43ba130f0c5fd`；再经 `godot.historyCheck` 创建检查，`godot.historyJob` 读取真实结果。宿主自己创建任务身份并进入原执行器，未使用 rawCore。

新检查 `gjob-6f3eb8b0141465be733d9225634e55830a917c3cf26d0a77b59f79c84460f55a` passed、sourceStale=false。候选 `gcan-948f749bd3407cfa0d490545fc92fd6ba82d6346e61155293955f1b45acf7781` 正常预览并采用。检查前后源码版本与哈希相同，源码对象身份集合相同；城墙继续使用 `ins-cfdeb2e8a8f191e1cc91fd71`。自然环境、两个独立橡树、门洞、城墙合计五个独立组件全部采用。

正式 build 为 `gbd-ac890ed999f24feddb948cfeaf21e3fd89b80f28bae33625ad2f0b60b5c0f29f`。第一次恢复报告已经成功保存和拍图，但第二次启动仅因 runtimeResume 瞬态 WORLD_BUSY 收尾失败，保留该 ok=false 原报告。随后复用已有 until 等待启动事务，**只追加观察、保存、重开验证**，没有再检查或安装。最终两次启动 instanceId 不同、build 相同，保存回执相同 build，三类退出审计数组均为空，ok=true。

完整概览图显示树、纹理草地和城墙组合。建筑仍是小范围静态预制演示，当前门洞朝向不是正对出生视角；侧视图中树冠也遮挡部分建筑。本轮不宣称地图设计、战斗或模型自主选择素材已验收。

证据根目录：`D:/cm-promo-loop-0912/test-results/desktop-native-complete-VO4Pki/`。

| 路径 | 含义 |
| --- | --- |
| `resume-202ec43f-2e20-4467-a9cb-be42fa2a3a42-report.json` | 原城墙安装超时，保留原检查中断和不完整退出 |
| `checked-recovery-325e322b-626c-43e3-a53e-7b5a4ccc3bb5/report.json` | format `craftmine.prefab-check-recovery/1`；墙检查/采用/保存成功，末次启动遇 WORLD_BUSY，原样保留 |
| `checked-recovery-325e322b-626c-43e3-a53e-7b5a4ccc3bb5/adopted-prefix.png` | 五组件实际概览，优先展示图 |
| `checked-recovery-325e322b-626c-43e3-a53e-7b5a4ccc3bb5/oblique.png` | 实际侧视图 |
| `reopen-verified-27e54cac-d45a-450a-82fb-e3720759b252/report.json` | format `craftmine.prefab-reopen-verification/1`；最终成功的冷重开补验，sourceReport 指向检查恢复报告，profileRoot 明确原 profile |
| `reopen-verified-27e54cac-d45a-450a-82fb-e3720759b252/reopened-prefix.png` | 冷重开后的同一正式构建，近处树视角 |

`tests/builtin-prefab-capture.mjs` 本轮加入受限历史面板重检及单独重开验证分支，按实际证据链区分重检、采用与冷重开。每次退出核对源报告/marker 字节和成品清单；旧失败报告没有改写。成功 metadata 可供后续普通玩家入口明确适配，不能伪装为 promo-player 模型成功报告。
