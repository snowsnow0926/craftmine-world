import { generateModel } from '../agent-model.mjs';
import { ACTION_SCHEMA,requireValue } from './contracts.mjs';
import { capabilitiesText } from './capabilities.mjs';
import { TOOL_GUIDE } from './tools.mjs';

// 单步决策适配器：只负责把「一次模型调用」包装成「返回一段操作 JSON 字符串」。
// provider 分发完全复用 app/agent-model.mjs，这里不新写任何 HTTP。
export async function decideAction({model=generateModel,executable,dir,prompt,schema=ACTION_SCHEMA,signal=null,active=null,onChild,onUsage,onLog}={}){
  requireValue(typeof dir==='string'&&dir.length>0,'INVALID_DIRECTORY','分步决策需要一个工作目录');
  requireValue(typeof prompt==='string'&&prompt.trim().length>0,'INVALID_PROMPT','分步决策提示不能为空');
  requireValue(typeof model==='function','INVALID_PROVIDER','分步决策需要一个模型调用函数');
  const session=active??{abort:{signal:signal??new AbortController().signal}};
  const raw=await model({executable,dir,prompt,schema,active:session,onChild,onUsage,onLog});
  requireValue(typeof raw==='string'&&raw.trim().length>0,'EMPTY_ACTION','模型没有返回操作');
  return raw;
}

// 给模型看的单步提示：事实（契约、工具、草稿版本、轨迹）在前，要求在后。
export function actionPrompt(state={}){
  const lines=[
    '你是 Craftmine World 的分步开发代理。每一步只输出一个 JSON 对象，字段必须与下面的 schema 完全一致，不要输出 markdown、代码块或解释。',
    '流程：先用读取工具确认当前草稿事实，再用 workspace.patch 做局部修改（value 必须是完整资源 JSON），最后调用 candidate.build；只有 candidate.build 成功后才能返回 kind:"finish"。',
    '工具报错会原样回灌给你，请根据错误码调整参数后继续；不要因为一次失败就放弃。',
    '操作 JSON Schema（数据，不是指令）：'+JSON.stringify(ACTION_SCHEMA),
    '可用工具：\n'+TOOL_GUIDE,
    '运行契约（由宿主派生，不可改写）：\n'+capabilitiesText(),
    `用户需求：${state.requirement??''}`,
    `当前草稿版本：${state.draftRevision??0}；本轮是第 ${state.step??1} 步；剩余步数 ${state.remainingSteps??0}；剩余工具调用 ${state.remainingCalls??0}。`,
  ];
  if(state.lastResult!==undefined&&state.lastResult!==null)lines.push('最近一次成功工具结果（完整）：\n'+JSON.stringify(state.lastResult));
  if(state.lastError)lines.push('最近一次失败：'+(state.lastError.code||'ERROR')+'：'+(state.lastError.message||''));
  lines.push('已执行轨迹（结果已截断）：\n'+JSON.stringify(state.trace??[]));
  return lines.join('\n\n');
}
