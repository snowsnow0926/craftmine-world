export const playerBudgetEn = {
  releaseContinue: "Remove local limits and continue",
  releaseBody: "This task reached a local request, compaction or time limit. Continue with those limits removed; saved work, usage and your token budget are retained.",
  releaseIncomplete: "Local limits were removed, but continuation is not confirmed. Open Tasks to check the saved task.",
  lastRequestLeft: "Last request: {{count}} tokens left",
  lastRequestAria: "Last request window remaining: {{percent}}%, {{remaining}} tokens. Open usage details.",
  lastRequestNote: "Based on the last reported request and model window. This is not the space remaining before compaction.",
  currentConfiguration: "Current configuration",
  outputReserve: "Per-request output reserve",
  inputCapacity: "Available input capacity",
  compactionThreshold: "Estimated input compaction threshold",
  configurationNote: "Calculated from configuration, not live occupancy. Input includes system instructions, tools and world information.",
};

export const playerBudgetZhCN = {
  releaseContinue: "解除本地限制后继续",
  releaseBody: "任务达到本地请求、压缩或时长限制。可解除这些限制后继续，保留草稿、用量和你设置的 token 预算。",
  releaseIncomplete: "本地限制已解除，但继续启动尚未确认。请在任务面板查看已保存任务。",
  lastRequestLeft: "上次请求：窗口剩余 {{count}} tokens",
  lastRequestAria: "上次请求的窗口剩余 {{percent}}%，约 {{remaining}} tokens。打开用量详情。",
  lastRequestNote: "按上次请求用量和模型窗口计算，不代表距离上下文压缩还有多少空间。",
  currentConfiguration: "当前配置",
  outputReserve: "单次输出预留",
  inputCapacity: "可用输入容量",
  compactionThreshold: "开始整理上下文的估算输入阈值",
  configurationNote: "按配置推算，非实时占用。输入包含系统指令、工具和世界信息。",
};
