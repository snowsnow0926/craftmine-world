import {useEffect, useRef, useState} from "react";
import type {AssetLibraryBridge} from "./use-asset-library";
import {compositionPrompt, parseCompositionPlan, validateCompositionRequest, type CompositionPlan, type CompositionRequest} from "../../../../shared/world-composition-contract";

type Recipe = {id: CompositionRequest["recipeId"]; version: 1 | 2 | 3; label: {zh: string; en: string}; description: {zh: string; en: string}; defaults: CompositionRequest["choices"]};
export type CompositionHandoff = {plan: CompositionPlan; text: string};
export function WorldCompositionPanel({bridge, worldId, zh, onUseComposition}: {bridge: AssetLibraryBridge | null; worldId: string; zh: boolean; onUseComposition?: (value: CompositionHandoff) => Promise<void>}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]), [request, setRequest] = useState<CompositionRequest | null>(null);
  const [plan, setPlan] = useState<CompositionPlan | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const epoch = useRef(0), language = zh ? "zh" : "en";
  const call = (method: string, params: Record<string, unknown> = {}) => {
    if (!bridge) throw Error("COMPOSITION_UNAVAILABLE");
    return bridge.call("package.request", {worldId, method, params: {...params, worldId}});
  };
  useEffect(() => {
    const generation = ++epoch.current; setPlan(null); setRequest(null); setError("");
    void call("compositionCatalog").then(value => {
      if (generation !== epoch.current) return;
      const catalog = value as {format?: string; worldId?: string; recipes?: Recipe[]};
      if (catalog.format !== "craftmine.world-composition-catalog/1" || catalog.worldId !== worldId || !Array.isArray(catalog.recipes) || !catalog.recipes.length || catalog.recipes.length > 8) throw Error("COMPOSITION_RECEIPT_INVALID");
      for (const row of catalog.recipes) validateCompositionRequest({recipeId: row.id, recipeVersion: row.version, choices: row.defaults});
      setRecipes(catalog.recipes); const first = catalog.recipes[0];
      setRequest({recipeId: first.id, recipeVersion: first.version, choices: {...first.defaults}, wish: ""});
    }).catch(failure => {if (generation === epoch.current) setError(String(failure instanceof Error ? failure.message : failure));});
    return () => {epoch.current++;};
  }, [bridge, worldId]);
  const update = (next: CompositionRequest) => {epoch.current++; setRequest(next); setPlan(null); setBusy(false); setError("");};
  async function inspect() {
    if (!request || busy) return;
    const generation = ++epoch.current; setBusy(true); setPlan(null); setError("");
    try {const result = parseCompositionPlan(await call("compositionPlan", {request}), worldId); if (epoch.current === generation) setPlan(result);}
    catch (failure) {if (epoch.current === generation) setError(String(failure instanceof Error ? failure.message : failure));}
    finally {if (epoch.current === generation) setBusy(false);}
  }
  async function handoff() {
    if (!plan || busy || !onUseComposition) return;
    const generation = ++epoch.current; setBusy(true); setError("");
    try {
      const current = parseCompositionPlan(await call("compositionPlan", {request: plan.request}), worldId);
      if (epoch.current !== generation) return;
      if (current.planHash !== plan.planHash) {setPlan(current); throw Error(zh ? "世界或素材已变化，请查看更新后的组合，再交给 AI。" : "The world or assets changed. Review the updated composition before handing it to AI.");}
      await onUseComposition({plan: current, text: compositionPrompt(current, zh)});
    } catch (failure) {if (epoch.current === generation) setError(String(failure instanceof Error ? failure.message : failure));}
    finally {if (epoch.current === generation) setBusy(false);}
  }
  const checkNames: Record<string, string[]> = {"preserve-world": ["保留现有作品", "Preserve the world"], placement: ["落点与通行空间", "Placement and clearance"], "controller-camera": ["角色与相机", "Player and camera"], "state-identities": ["独立对象与存档", "Identity and saved progress"], "input-conflicts": ["按键冲突", "Input conflicts"], "weather-owner": ["天气控制冲突", "Weather ownership"], "physical-runway": ["真实跑道与空域", "Physical runway and airspace"], "quest-flight": ["任务完成及实际飞行", "Quest completion and actual flight"]};
  return <section className="library-publish-panel" data-world-composition>
    <p>{zh ? "在当前世界组合已有内容，再由 AI 完成接入和玩法检查。" : "Combine existing content in this world, then let AI integrate and check the gameplay."}</p>
    {request && <form data-composition-plan-form onSubmit={event => {event.preventDefault(); void inspect();}}>
      <label className="asset-library-field">{zh ? "玩法" : "Gameplay"}<select data-composition-recipe value={request.recipeId} disabled={busy} onChange={event => {const recipe = recipes.find(row => row.id === event.target.value)!; update({recipeId: recipe.id, recipeVersion: recipe.version, choices: {...recipe.defaults}, wish: request.wish});}}>{recipes.map(row => <option key={row.id} value={row.id}>{row.label[language]}</option>)}</select></label>
      <p>{recipes.find(row => row.id === request.recipeId)?.description[language]}</p>
      <label className="asset-library-field">{zh ? "场景" : "Scenery"}<select data-composition-scenery value={request.choices.scenery} disabled={busy} onChange={event => update({...request, choices: {...request.choices, scenery: event.target.value as CompositionRequest["choices"]["scenery"]}})}><option value="keep">{zh ? "保留当前场景" : "Keep current scenery"}</option><option value="forest">{zh ? "增加森林入口" : "Add forest gateway"}</option><option value="city-street">{zh ? "增加城市街区片段" : "Add city street fragment"}</option></select></label>
      <label className="asset-library-field"><span><input data-composition-companion type="checkbox" checked={request.choices.companion} disabled={busy} onChange={event => update({...request, choices: {...request.choices, companion: event.target.checked}})}/>{zh ? "加入白色博美伙伴" : "Add the white Pomeranian companion"}</span></label>
      <label className="asset-library-field">{zh ? "天气" : "Weather"}<select data-composition-weather value={request.choices.weather} disabled={busy} onChange={event => update({...request, choices: {...request.choices, weather: event.target.value as "keep" | "rain"}})}><option value="keep">{zh ? "保留当前天气" : "Keep current weather"}</option><option value="rain">{zh ? "加入可操控的雨" : "Add controllable rain"}</option></select></label>
      {request.recipeId === "collect-unlock-flight" && <label className="asset-library-field">{zh ? "收集目标数量" : "Collection target count"}<input data-composition-count type="number" min="1" max="12" value={request.choices.collectionCount} disabled={busy} onChange={event => update({...request, choices: {...request.choices, collectionCount: Number(event.target.value)}})}/></label>}
      <label className="asset-library-field">{zh ? "补充要求" : "Additional wishes"}<textarea data-composition-wish maxLength={3000} value={request.wish ?? ""} disabled={busy} onChange={event => update({...request, wish: event.target.value})}/></label>
      <button type="submit" disabled={busy}>{busy ? zh ? "正在检查…" : "Inspecting…" : zh ? "检查组合" : "Inspect composition"}</button>
    </form>}
    {error && <p role="alert" data-composition-error>{error}</p>}
    {plan && <div data-composition-plan={plan.planHash}>
      <p>{zh ? "组合方案已读取，尚未修改世界。" : "Composition inspected; the world has not been changed."}</p>
      <ul>{plan.components.map(row => <li key={row.archiveRef.assetId} data-composition-component={row.archiveRef.assetId}>{row.displayName} · v{row.archiveRef.version} · {row.sourceRequirements.status === "adaptation-required" ? zh ? "需要适配" : "Needs adaptation" : zh ? "源码依赖匹配，仍需检查玩法" : "Source requirements match; gameplay checks remain"}{row.existingSource === "component-files-present-inspect-instances" && (zh ? " · 已有组件文件，先检查能否复用" : " · Existing files; inspect reuse first")}</li>)}</ul>
      {!!plan.missingLogic.length && <p data-composition-missing>{zh ? "AI 还需要制作：物品收集、任务进度与飞机解锁，并验证起降及存档。" : "AI still needs to build collection, quest progress and flight unlock, then verify flight and saved progress."}</p>}
      {plan.checks.some(row => row.id === "physical-runway") && <p data-composition-runway>{zh ? "飞机需要真实的 2400 米 × 56 米平坦跑道。当前场地是否满足，仍需实际检查；不足时由 AI 扩建并保留现有场景。" : "The aircraft needs a real level 2400 m × 56 m runway. The actual site still needs inspection; AI must expand it while preserving the scene if necessary."}</p>}
      <p>{zh ? "待检查：" : "Checks remaining: "}{plan.checks.map(row => checkNames[row.id]?.[zh ? 0 : 1] ?? row.id).join(" · ")}</p>
      <details><summary>{zh ? "版本、许可与检查详情" : "Versions, licences and check details"}</summary><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{JSON.stringify(plan, null, 2)}</pre></details>
      <form data-composition-handoff-form onSubmit={event => {event.preventDefault(); void handoff();}}><button type="submit" disabled={busy || !onUseComposition}>{zh ? "交给 AI 继续创作" : "Continue with AI"}</button></form>
      <p>{zh ? "填入当前世界的对话，发送后才开始创作。" : "Adds to this world's conversation; creation starts when you send it."}</p>
    </div>}
  </section>;
}
