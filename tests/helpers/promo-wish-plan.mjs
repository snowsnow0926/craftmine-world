// Evaluator-only preparation data. Nothing in this module starts the product,
// reads credentials, generates game content, or certifies a model result.
import {createHash} from 'node:crypto';

export const PROMO_SUITE = 'craftmine.promo-wish-plan/1';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const step = (id, kind, source, text, observe) => ({id, kind, source, text, observe});
const wish = (id, source, text, observe) => step(id, 'wish', source, text, observe);
const play = (id, text, observe) => step(id, 'play', 'test-extension', text, observe);
const reopen = id => step(id, 'save-reopen', 'test-extension', '保存、正常退出并冷重开；再实际使用已完成内容。', ['真实保存回执', '新运行实例', '同一世界及约定持久状态', '重开后的真实互动']);

// Prompts remain player language. Observations are evaluator requirements, NOT
// extra product tools or instructions to inject into the player's prompt.
const groups = [
  {id:'environment', title:'树与花草', sourceShots:['A02','A03'], steps:[
    wish('ENV01','A02','我想生成一些树。',['树真实存在于正式世界', '可绕行观察，不是背景图']),
    wish('ENV02','A03','我希望地上有花草。',['花与草分别可辨识', '原树和最新游玩进度保留']),
    reopen('ENV03'),
  ], variants:['左边那棵高一点，其余别动。','花太密了，给我留条能走的小路。']},
  {id:'pet', title:'同一只宠物持续创作', sourceShots:['A04','A05'], steps:[
    wish('PET01','A04','我希望有条宠物狗。',['真实多机位画面', '持久逻辑宠物身份，不按节点名判断形态']),
    wish('PET02','test-extension','叫它团子吧，我走的时候让它跟着我。',['名称与同一宠物绑定', '真实转向、走开、停下后的跟随，不是镜头挂件']),
    wish('PET03','A05','我希望狗换成白色博美犬。',['同一逻辑宠物且数量不变', '形态与颜色分别复核', '仅检查已经实际建立的名称和行为是否保留']),
    play('PET04','走开、转弯、停下，再回头看团子。',['通过正常运动逻辑驱动', '跟随与碰撞结果', '不得直接写宠物坐标']),
    reopen('PET05'),
  ], variants:['颜色保留，体型小一点。','跟得太近了，离我稍微远一点。']},
  {id:'combat', title:'巨大怪物与游戏内枪械', sourceShots:['A06','A07','A08','A09','A10'], steps:[
    wish('COM01','A06','给我生成一些怪物。',['正式出现怪物', '既有世界保持', '实际已有行为与未实现行为分列']),
    wish('COM02','A07','我想玩怪猎。',['通过普通澄清明确巨大怪物挑战范围', '怪物身份、尺度与战斗状态']),
    play('COM03','用已有能力尝试应对；记录实际遭遇，不强迫玩家必输。',['真实攻击与受击', '没有攻击能力时记录缺口，不补写武器', '已经打赢时不能伪造打不过']),
    wish('COM04','A09','给我一个 AK47。',['可装备和开火的游戏内武器', '原巨怪身份、规则与当前伤害不被暗中重置']),
    play('COM05','先打偏，再瞄准；尝试击败之前那只巨怪。',['未命中不扣血', '真实命中、伤害和死亡的因果', '不直接设置血量或定时死亡']),
    reopen('COM06'),
  ], variants:['别改怪物，给我换个更清楚的准星。','这把枪的颜色换一下，其他别动。']},
  {id:'rain', title:'雨停并倒流技能', sourceShots:['B01'], steps:[
    wish('RAIN01','B01','我想要《惊天魔盗团》经典场景中让雨停在半空、然后倒流向上的技能。',['正常下雨、悬停、向上运动、恢复', '技能入口与实际触发']),
    play('RAIN02','使用技能时继续走动，换位置和方向后再用一次。',['玩家未被全局暂停', '运动轨迹与多帧画面交叉核对', '不是一次性倒放视频']),
    reopen('RAIN03'),
  ], variants:['停住3秒再往上飞，最后恢复下雨。','我再按一次就取消，别卡住不动。']},
  {id:'flight', title:'玩家驾驶飞机', sourceShots:['B02'], steps:[
    wish('FLIGHT01','B02','我想要驾驶歼20。',['机体辨识度另行复核', '实际驾驶入口与输入控制', '不隐藏追加专业模拟器要求']),
    play('FLIGHT02','交错尝试转向、爬升、下降、变速，然后松开控制。',['实际输入影响飞机轨迹，不只移动镜头', '记录动作顺序', '不是固定航线']),
    wish('FLIGHT03','test-extension','转弯太猛了，温和一点，其他别改。',['可比条件下转向响应变化', '其余控制保留']),
    reopen('FLIGHT04'),
  ], variants:['换个驾驶视角，我想看清前面。','我想飞慢一点，好看看下面。']},
  {id:'city', title:'可步行探索和局部修改的城市', sourceShots:['B03'], steps:[
    wish('CITY01','B03','我想复刻奥格瑞玛。',['相似度、范围与可玩性分列', '范围缩小时保留原目标未满足部分']),
    play('CITY02','从入口走进主路、广场、侧路，转身并贴近建筑。',['实际相连可走空间', '不是远景贴图或固定机位布景']),
    wish('CITY03','test-extension','这条路太窄了，拓宽一点，城门和旁边那片别改。',['正确局部修改', '其他区域和通路保持']),
    reopen('CITY04'),
  ], variants:['天色改成傍晚，我再逛一圈。','刚才的广场别动，只改我选的这条街。']},
];

export const PROMO_GROUP_IDS = Object.freeze(groups.map(group => group.id));
const evidenceSlots = ['submission','check','application','liveObservation','beforeApplyProgress','afterApplyProgress','saved','reopened','usage'];
// Order is narrative preference; only these prerequisites are hard dependencies.
const prerequisites = {
  ENV01:[], ENV02:['ENV01'], PET01:[], PET02:['PET01'], PET03:['PET01'], PET04:['PET02','PET03'],
  COM01:[], COM02:['COM01'], COM03:['COM02'], COM04:['COM02'], COM05:['COM02','COM04'],
  RAIN01:[], RAIN02:['RAIN01'], FLIGHT01:[], FLIGHT02:['FLIGHT01'], FLIGHT03:['FLIGHT02'],
  CITY01:[], CITY02:['CITY01'], CITY03:['CITY02'], ENTER01:[],
};

/** Same seed/group gives the same candidate even when only a subset is selected. */
export function createPromoWishPlan({suite='independent', selected, seed=20260911} = {}) {
  if (!['independent','mainline'].includes(suite)) throw Error('UNKNOWN_WISH_SUITE');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error('INVALID_SEED');
  const ids = selected ?? PROMO_GROUP_IDS;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !PROMO_GROUP_IDS.includes(id))) throw Error('INVALID_WISH_GROUPS');
  if (suite === 'mainline' && selected !== undefined) throw Error('MAINLINE_CANNOT_BE_SLICED');
  let stories;
  if (suite === 'independent') {
    stories = ids.map(id => {
      const group = groups.find(item => item.id === id);
      const variant = parseInt(digest([seed,id]).slice(0,8),16) % group.variants.length;
      return {...structuredClone(group), worldGroup:`I-${id}`, sourceMode:'official-blank',
        optionalFollowUp:{text:group.variants[variant], source:'test-extension', activation:'after-success-and-budget-review'},
      };
    });
  } else {
    const included = ['ENV01','ENV02','PET01','PET03','COM01','COM02','COM03','COM04','COM05'];
    const allSteps = groups.flatMap(group => group.steps);
    stories = [{id:'mainline',title:'同一世界宣传主线',worldGroup:'A-mainline',sourceMode:'official-blank',
      sourceShots:['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10'],
      optionalFollowUp:null, steps:[
        step('ENTER01','play','A01','从官方空白3D世界进入游戏内创作入口。',['实际绑定当前世界', '收起后可继续游玩']),
        ...included.map(id => structuredClone(allSteps.find(item => item.id === id))), reopen('A-REOPEN'),
      ]}];
  }
  for (const story of stories) {
    delete story.variants;
    const createdContent = story.steps.filter(item => item.kind === 'wish').map(item => item.id);
    story.steps = story.steps.map(item => ({...item,
      dependsOn:[...(suite === 'mainline' && item.id !== 'ENTER01' ? ['ENTER01'] : []), ...(prerequisites[item.id] ?? [])],
      // A partial story may still verify persistence of its successful content.
      ...(item.kind === 'save-reopen' ? {dependsOnAny:createdContent,persistenceScope:'successful-wishes-only'} : {}),
      outcome:'NOT_RUN',worldId:null,buildId:null,instanceId:null,requestAttempts:null,usageRaw:null,
      submittedAt:null,playableObservedAt:null,completionPath:null,visualReview:'pending',
      evidence:Object.fromEntries(evidenceSlots.map(name => [name,null])),
    }));
  }
  const plan = {format:PROMO_SUITE,suite,seed,visibility:'evaluator-only',
    sourcePlan:'docs/PROMO_WISH_CREATION_TEST_PLAN_V2.md',
    preparation:{status:'PREPARED_NOT_EXECUTED',modelRequests:0,liveAdapterImplemented:false},
    budget:{authorized:false,maxRequests:null},packageIdentity:null,modelIdentity:null,
    blockers:['No live wish adapter is connected by this planner.','Freeze actual package/model and valid budget before execution.','Keep future prompts and evaluator requirements out of product context.'],
    stories,
  };
  return {...plan,planSha256:digest(plan)};
}

/** A scheduler hint only; the eventual runner must verify evidence independently. */
export function nextWishStep(plan, storyId, results = {}) {
  if (plan?.format !== PROMO_SUITE) throw Error('INVALID_WISH_PLAN');
  const story = plan.stories.find(item => item.id === storyId);
  if (!story) throw Error('UNKNOWN_WISH_STORY');
  const passed = new Set(), seen = new Set(), blockedSteps = [], ready = [];
  for (const item of story.steps) {
    if (!item.id || seen.has(item.id) || !Array.isArray(item.dependsOn) ||
        [...item.dependsOn,...(item.dependsOnAny ?? [])].some(id => !seen.has(id))) throw Error('INVALID_WISH_DEPENDENCIES');
    seen.add(item.id);
    const result = Object.hasOwn(results,item.id) ? results[item.id] : undefined;
    const missing = item.dependsOn.filter(id => !passed.has(id));
    const anyMissing = item.dependsOnAny?.length && !item.dependsOnAny.some(id => passed.has(id));
    if (missing.length || anyMissing) {
      blockedSteps.push({stepId:item.id,reason:result === 'PASS' ? 'PASS_WITH_UNMET_DEPENDENCIES' : 'UNMET_DEPENDENCIES',
        dependencies:[...missing,...(anyMissing ? item.dependsOnAny : [])]});
    } else if (result === 'PASS') passed.add(item.id);
    else if (result === undefined || result === 'NOT_RUN') ready.push(item);
    else blockedSteps.push({stepId:item.id,reason:'STEP_NOT_PASSED',result});
  }
  const next = ready[0];
  if (next) return {status:'PENDING',stepId:next.id,blockedSteps,
    ...(next.kind === 'save-reopen' ? {preservedStepIds:next.dependsOnAny.filter(id => passed.has(id))} : {})};
  if (blockedSteps.length) return {status:'DEPENDENCY_BLOCKED',stepId:blockedSteps[0].stepId,blockedSteps};
  return {status:'REVIEW_REQUIRED',stepId:null,blockedSteps};
}
