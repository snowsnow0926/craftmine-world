// Failure taxonomy for task I. The plan requires each failure to be classified
// so a model weakness is never reported as an engine limit and vice versa, and
// so human intervention stays in the denominator.
export const FAILURE_FORMAT = 'craftmine.i.failure-classes/1';

export const FAILURE_CLASSES = Object.freeze({
  'model-format': { zh: '模型格式不合规', blame: 'model', note: '模型产出的结构/字段不符合已冻结的接口' },
  'model-omission': { zh: '模型漏做要求', blame: 'model', note: '需求明确但产物里没有对应实现' },
  'model-wrong-behavior': { zh: '模型实现行为错误', blame: 'model', note: '实现存在但实际行为与需求不符' },
  'model-fabrication': { zh: '模型伪造结果', blame: 'model', note: '用文字/假数据替代真实状态变化' },
  'tool-interface-missing': { zh: '产品工具接口缺失', blame: 'product', note: '模型无法通过已接入工具完成该需求' },
  'tool-interface-misleading': { zh: '工具接口描述误导', blame: 'product', note: '能力文本与真实规则不一致导致模型必然失败' },
  'engine-limit': { zh: '引擎能力边界', blame: 'engine', note: '引擎本身无法表达该需求' },
  'harness-bug': { zh: '验收器缺陷', blame: 'harness', note: '验收驱动/断言自身错误，需修复验收器而不是放宽标准' },
  'environment-permission': { zh: '环境权限拒绝', blame: 'environment', note: '权限/环境阻断，保留原始错误与待执行命令' },
  'product-interface-unavailable': { zh: '产品接口未接通', blame: 'dependency', note: '依赖模块未交付，本轮记为尚未执行' },
  'timeout': { zh: '超时', blame: 'unknown', note: '超出时间预算，需保留现场' },
  'flaky': { zh: '不稳定', blame: 'unknown', note: '同条件重复结果不一致，必须记录重跑次数' },
  'human-intervention': { zh: '人工介入', blame: 'process', note: '人工改了提示/实现/标准，必须单独记账' },
  'evidence-insufficient': { zh: '证据不足', blame: 'process', note: '缺少身份/哈希/画面/前后状态，不能判通过' },
  'assertion-invalid': { zh: '断言无效', blame: 'harness', note: '断言无法被判红或与需求不符' },
  unclassified: { zh: '未归类', blame: 'process', note: '自动分类未命中；必须人工归类，未归类会让 R13.2 判失败' },
});

export const FAILURE_CLASS_IDS = Object.freeze(Object.keys(FAILURE_CLASSES));

export function classifyFailure({ stage = 'unknown', message = '', error = null } = {}) {
  const text = `${message} ${error?.message ?? ''} ${error?.stack ?? ''}`.toLowerCase();
  const match = [
    [/eacces|eperm|permission denied|access is denied|权限/, 'environment-permission'],
    [/product interface|接口未接通|not configured|unavailable|econnrefused|无法连接产品/, 'product-interface-unavailable'],
    [/timed? ?out|timeout|etimedout/, 'timeout'],
    [/invalid json|unexpected token|schema|格式|不是有效 json/, 'model-format'],
    [/not found|missing|未提供|没有实现|absent/, 'model-omission'],
    [/does not match|expected .* got|行为|assertion failed|断言失败/, 'model-wrong-behavior'],
    [/fake|伪造|fabricat|placeholder|stand-in/, 'model-fabrication'],
    [/tool .*not (available|registered)|工具未接入|no such tool/, 'tool-interface-missing'],
    [/engine|godot .*error|gdscript .*parse/, 'engine-limit'],
    [/harness|assertion .*invalid|assertion evaluator/, 'harness-bug'],
  ].find(([pattern]) => pattern.test(text));
  return { class: match ? match[1] : 'unclassified', stage, message: message || error?.message || '', defined: FAILURE_CLASS_IDS.includes(match ? match[1] : 'unclassified') };
}

export function summarizeFailures(failures = []) {
  const byClass = {};
  for (const failure of failures) {
    const id = failure.class ?? 'unknown';
    byClass[id] = (byClass[id] ?? 0) + 1;
  }
  return {
    total: failures.length,
    byClass,
    model: failures.filter(f => FAILURE_CLASSES[f.class]?.blame === 'model').length,
    product: failures.filter(f => FAILURE_CLASSES[f.class]?.blame === 'product').length,
    harness: failures.filter(f => FAILURE_CLASSES[f.class]?.blame === 'harness').length,
    environment: failures.filter(f => FAILURE_CLASSES[f.class]?.blame === 'environment').length,
    humanInterventions: failures.filter(f => f.class === 'human-intervention').length,
  };
}
