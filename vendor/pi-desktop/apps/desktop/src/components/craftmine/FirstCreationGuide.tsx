import {useState} from "react";
import "./first-creation-guide.css";

export type FirstCreationDestination = "worlds" | "assets" | "create" | "play" | "history" | "share";
type Preference = {open: boolean; step: number};
const storageKey = "craftmine.first-creation.guide.v1";
function readPreference(): Preference {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (value && typeof value.open === "boolean" && Number.isInteger(value.step) && value.step >= 0 && value.step < 5)
      return {open: value.open, step: value.step};
  } catch { /* Reading the guide also works without profile storage. */ }
  return {open: false, step: 0};
}
const steps = [
  {title: ["打开世界", "Open a world"], body: ["从世界列表打开示例，或新建一个世界。已有示例无需连接 AI 即可游玩。", "Open an example from the world list, or create a world. Existing examples can be played without connecting AI."], actions: [["worlds", "选择或新建世界", "Choose or create a world"]]},
  {title: ["加入素材", "Add an asset"], body: ["选择素材的确切版本，点击“检查并准备加入”，等检查通过后再“加入世界”。直接使用不调用 AI；不支持的素材可以保留完整需求让 AI 修改。", "Choose an exact asset version, check and prepare it, then add it after its check passes. Direct use makes no AI calls. Unsupported assets can be adapted by AI using your full request."], actions: [["assets", "打开素材库", "Open asset library"]]},
  {title: ["做一次修改", "Make a change"], body: ["进入创作，从“最近结果”选回支持编辑的对象，在“编辑对象”修改尺寸或颜色，再“检查并应用”。未提供参数的对象可在对话中提出修改。", "Enter Create, select a supported object from Recent results, edit its size or color in Edit object, then check and apply. For objects without editable parameters, describe your change in the conversation."], actions: [["create", "进入创作", "Enter Create"], ["history", "查看版本", "View versions"]]},
  {title: ["保存并重开", "Save and reopen"], body: ["回到正式世界，点击“保存”并确认“已保存”。关闭应用后，再从世界列表打开同一世界，检查修改和游玩进度。", "Return to the formal world, use Save and confirm Saved. After closing the app, open the same world from the list and check your changes and progress."], actions: [["play", "回到世界", "Return to world"], ["worlds", "打开世界列表", "Open world list"]]},
  {title: ["分享成果", "Share your world"], body: ["在素材库保存世界模板，确认把已保存进度作为新世界起点，再导出该模板的 ZIP。朋友导入素材库后，从模板创建独立世界；未采用草稿不包含在内。", "Save a world template in the asset library, confirm saved progress as its starting state, then export its ZIP. Your friend can import it and create an independent world. Unapplied drafts are excluded."], actions: [["share", "保存世界模板", "Save world template"]]},
] as const;

/** A reading bookmark only. Navigation never records task completion. */
export function FirstCreationGuide({lang, worldId, onNavigate}: {
  lang: "zh" | "en"; worldId: string | null; onNavigate: (destination: FirstCreationDestination) => void;
}) {
  const [preference, setPreference] = useState(readPreference);
  const locale = lang === "zh" ? 0 : 1, step = steps[preference.step];
  const remember = (next: Preference) => {
    setPreference(next);
    try {localStorage.setItem(storageKey, JSON.stringify(next));} catch { /* This preference is optional. */ }
  };
  return <section className="first-creation-guide" data-first-creation-guide>
    <form data-first-guide-toggle onSubmit={event => {event.preventDefault(); remember({...preference, open: !preference.open});}}>
      <button type="submit" aria-expanded={preference.open}>{lang === "zh" ? "首次创作指引" : "First creation guide"}<span aria-hidden>{preference.open ? "−" : "+"}</span></button>
    </form>
    {preference.open && <div className="first-creation-guide-body">
      <div className="first-creation-guide-pages" aria-label={lang === "zh" ? "阅读步骤" : "Guide pages"}>
        {steps.map((item, index) => <form key={index} data-first-guide-step={index} onSubmit={event => {event.preventDefault(); remember({...preference, step: index});}}>
          <button type="submit" aria-current={preference.step === index ? "step" : undefined} title={item.title[locale]}>{index + 1}</button>
        </form>)}
      </div>
      <strong data-first-guide-title>{step.title[locale]}</strong><p>{step.body[locale]}</p>
      <div className="first-creation-guide-actions">{step.actions.map(([destination, zh, en]) => <form key={destination} data-first-guide-action={destination} onSubmit={event => {
        event.preventDefault(); if (worldId || destination === "worlds") onNavigate(destination);
      }}><button type="submit" disabled={!worldId && destination !== "worlds"}>{lang === "zh" ? zh : en}</button></form>)}</div>
      {!worldId && preference.step > 0 && <p>{lang === "zh" ? "请先选择一个世界。" : "Choose a world first."}</p>}
      <form data-first-guide-dismiss onSubmit={event => {event.preventDefault(); remember({...preference, open: false});}}><button type="submit">{lang === "zh" ? "收起指引" : "Hide guide"}</button></form>
    </div>}
  </section>;
}
