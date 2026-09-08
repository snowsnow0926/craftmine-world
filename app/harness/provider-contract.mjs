// 适配器能力声明（P0）：模型后端必须如实说自己会什么。
// 规则：拿不到证据的能力一律是 unavailable，绝不用「OpenAI 兼容」推定兼容。
export const PROVIDER_CONTRACT_FORMAT = 'craftmine.provider-contract/1';

export const PROVIDER_CAPABILITIES = Object.freeze([
  'toolCalls', 'structuredOutput', 'imageInput', 'contextWindow', 'outputLimit',
  'tokenEstimate', 'nativeCompaction', 'resume', 'cancel', 'usageReport',
]);

// 每个值都带来源：measured = 本机实测，user = 用户确认，unknown = 没有证据。
const DEEPSEEK = Object.freeze({
  toolCalls: { value: 'yes', source: 'measured', note: '返回规范 tool_calls（含参数）' },
  structuredOutput: { value: 'partial', source: 'measured', note: '只有 json_object；严格 json_schema 返回 400，schema 必须写进提示并由本地校验兜底' },
  imageInput: { value: 'unavailable', source: 'measured', note: '/models 里有 vision 实验型号，但当前默认模型未验证图像输入' },
  contextWindow: { value: 1000000, source: 'user', note: '用户确认上限 1M；实测 360,033 prompt tokens 返回 200' },
  outputLimit: { value: 384000, source: 'user', note: '用户确认输出上限 384K' },
  tokenEstimate: { value: 'unavailable', source: 'unknown', note: '没有本地分词器，只能按字符估算并标注 estimated' },
  nativeCompaction: { value: 'unavailable', source: 'unknown', note: '无状态 HTTP，没有后端原生压缩' },
  resume: { value: 'unavailable', source: 'unknown', note: '每次请求独立，续接靠宿主检查点' },
  cancel: { value: 'yes', source: 'measured', note: 'AbortSignal 可取消在途请求' },
  usageReport: { value: 'yes', source: 'measured', note: 'prompt/completion/cache_hit 字段齐全' },
});

const CODEX = Object.freeze({
  toolCalls: { value: 'yes', source: 'unknown', note: 'CLI 结构化输出路径' },
  structuredOutput: { value: 'yes', source: 'unknown', note: '--json-schema 严格结构' },
  imageInput: { value: 'unavailable', source: 'unknown', note: '本产品未验证' },
  contextWindow: { value: 'unavailable', source: 'unknown', note: 'CLI 不回报窗口' },
  outputLimit: { value: 'unavailable', source: 'unknown', note: 'CLI 不回报输出上限' },
  tokenEstimate: { value: 'unavailable', source: 'unknown', note: '无本地分词器' },
  nativeCompaction: { value: 'yes', source: 'unknown', note: 'CLI 自带会话压缩' },
  resume: { value: 'yes', source: 'unknown', note: 'CLI 会话可续接' },
  cancel: { value: 'yes', source: 'unknown', note: '宿主可结束子进程' },
  usageReport: { value: 'partial', source: 'unknown', note: '仅在 turn.completed 事件里回报' },
});

const PROFILES = Object.freeze({ deepseek: DEEPSEEK, codex: CODEX });

export function providerContract(provider, { model = null } = {}) {
  const profile = PROFILES[provider] || null;
  const capabilities = {};
  for (const name of PROVIDER_CAPABILITIES) {
    capabilities[name] = profile ? { ...profile[name] } : { value: 'unavailable', source: 'unknown', note: `未登记的后端 ${provider}，不能推定它支持任何能力` };
  }
  return {
    format: PROVIDER_CONTRACT_FORMAT,
    provider: provider || null,
    model,
    registered: Boolean(profile),
    capabilities,
    summary: providerContractText({ provider, model, capabilities }),
  };
}

export function capabilityStatus(contract, name) {
  if (!PROVIDER_CAPABILITIES.includes(name)) throw Error(`没有这个能力项：${name}；可用：${PROVIDER_CAPABILITIES.join('、')}`);
  return contract?.capabilities?.[name]?.value || 'unavailable';
}

// 调用方在依赖某项能力前必须显式检查，不能靠「接口名字像」就假定可用。
export function assertCapability(contract, name) {
  const value = capabilityStatus(contract, name);
  if (value === 'unavailable' || value === 'no') {
    const note = contract?.capabilities?.[name]?.note || '';
    throw Error(`后端 ${contract?.provider || '未知'} 不支持 ${name}${note ? `（${note}）` : ''}`);
  }
  return value;
}

export function providerContractText(contract) {
  const lines = [`后端 ${contract.provider || '未知'}${contract.model ? ` · 模型 ${contract.model}` : ''}${contract.registered ? '' : '（未登记）'}`];
  for (const name of PROVIDER_CAPABILITIES) {
    const entry = contract.capabilities[name];
    const value = typeof entry.value === 'number' ? entry.value.toLocaleString('en-US') : entry.value;
    lines.push(`- ${name}: ${value}（来源 ${entry.source}）${entry.note ? ' · ' + entry.note : ''}`);
  }
  return lines.join('\n');
}
