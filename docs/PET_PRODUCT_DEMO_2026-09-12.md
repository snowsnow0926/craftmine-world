# preview.15 宠物成品验收记录

冻结包内 `cw.module.pet-companion` 已完成真实安装、源码检查、候选预览和正常采用。首轮脚本曾错误把 installer 的 instance id 当作 sourceList 的实体 id，已保留原失败报告并在 `dac2fd10` 修正。续验脚本 `tests/pet-product-continue.mjs` 只读取原 profile/world，禁止重装、重检和重复采用，继续验证跟随、实际朝向互动、HUD 反馈、保存及冷重开完整状态。
