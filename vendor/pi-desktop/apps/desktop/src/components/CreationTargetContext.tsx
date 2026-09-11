import { CreationObjectEditor } from "./CreationObjectEditor";
import { useTranslation } from "react-i18next";
import type { useCreationTarget } from "../hooks/use-creation-target";

export function CreationTargetContext({ controller }: { controller: ReturnType<typeof useCreationTarget> }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const target = controller.capture?.target;
  const sceneObject=controller.capture?.sceneObjectTarget;
  const recent=controller.capture?.recent??[];
  const fromRecent=controller.capture?.source==='recent';
  return <div className="creation-target-context" data-creation-target={controller.loading ? "loading" : sceneObject ? "scene-object" : target ? target.surface : "none"}>
    <div className="creation-target-row">
      <span>{controller.loading ? (zh ? "正在读取指向…" : "Reading target…") : sceneObject ? (zh?"这个场景对象：":"This scene object: ")+sceneObject.nodePath.split('/').at(-1) : target ? `${target.entityId ? (zh ? "这个对象：" : "This object: ") + (target.entityName ?? target.entityId) : (zh ? "这里（地面）" : "Here (ground)")} · ${target.position.map(value => value.toFixed(1)).join(", ")}` : (zh ? "未选中位置" : "No selected location")}</span>
      <button type="button" disabled={controller.loading || !controller.available} onClick={() => void controller.useRay()}>{zh ? (fromRecent?"使用当前指向":"更新指向") : (fromRecent?"Use current aim":"Refresh target")}</button>
    </div>
    {target && <span className="creation-target-note">{fromRecent?(zh?"已选中最近结果；移动视角不会切换对象。":"Recent result selected; moving your view will not change the object."):(zh ? "本次指向已固定；移动视角后可更新指向。" : "This target is fixed; refresh after moving your view.")}</span>}
    {sceneObject&&<span className="creation-target-note">{zh?"本次对象已固定，可描述希望如何修改；重开世界后请重新选中。":"This object is fixed for your request; select it again after reopening the world."}</span>}
    {(controller.error || controller.capture?.reason) && <span className="creation-target-note" title={controller.error || controller.capture?.reason || undefined}>{zh ? (fromRecent?"先前选择的对象暂不可用，请选择其他结果或使用当前指向。":"指向暂不可用，可继续输入文字") : "Target unavailable; select another result or use current aim."}</span>}
    {recent.length>0&&<details className="creation-recent-results"><summary>{zh?"最近结果":"Recent results"} · {recent.length}</summary>
      <div role="list" aria-label={zh?"最近采用的对象":"Recently adopted objects"}>{recent.map(item=><div role="listitem" key={item.entityId}>
        <button type="button" disabled={controller.loading||!item.available} aria-pressed={fromRecent&&target?.entityId===item.entityId} title={item.entityId} onClick={()=>void controller.selectRecent(item.entityId)}>{item.entityName} · {item.entityId}{!item.available?(zh?(item.reason==='CREATION_RECENT_HIDDEN'?"（暂不可见）":"（已移除或不可用）"):" (unavailable)"):''}</button>
      </div>)}</div>
    </details>}
    {controller.policy && <label className="creation-policy">
      <input type="checkbox" checked={controller.policy.autoApply} disabled={controller.policyBusy} onChange={event => void controller.changePolicy(event.target.checked)} />
      <span>{zh ? "此世界自动应用通过检查的安全改动" : "Automatically apply checked safe changes in this world"}</span>
    </label>}
    <CreationObjectEditor controller={controller} />
    {controller.policyError && <span role="alert" className="creation-target-note">{zh ? "设置未保存，请重试" : "Setting was not saved; try again"}</span>}
  </div>;
}
