import { CreationObjectEditor } from "./CreationObjectEditor";
import { useTranslation } from "react-i18next";
import type { useCreationTarget } from "../hooks/use-creation-target";

export function CreationTargetContext({ controller }: { controller: ReturnType<typeof useCreationTarget> }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const target = controller.capture?.target;
  return <div className="creation-target-context" data-creation-target={controller.loading ? "loading" : target ? target.surface : "none"}>
    <div className="creation-target-row">
      <span>{controller.loading ? (zh ? "正在读取指向…" : "Reading target…") : target ? `${target.entityId ? (zh ? "这个对象：" : "This object: ") + (target.entityName ?? target.entityId) : (zh ? "这里（地面）" : "Here (ground)")} · ${target.position.map(value => value.toFixed(1)).join(", ")}` : (zh ? "未选中位置" : "No selected location")}</span>
      <button type="button" disabled={controller.loading || !controller.available} onClick={() => void controller.refresh()}>{zh ? "更新指向" : "Refresh target"}</button>
    </div>
    {target && <span className="creation-target-note">{zh ? "本次指向已固定；移动视角后可更新指向。" : "This target is fixed; refresh after moving your view."}</span>}
    {(controller.error || (controller.capture?.reason && !controller.capture.captureId)) && <span className="creation-target-note" title={controller.error || controller.capture?.reason || undefined}>{zh ? "指向暂不可用，可继续输入文字" : "Target unavailable; text input is still available"}</span>}
    {controller.policy && <label className="creation-policy">
      <input type="checkbox" checked={controller.policy.autoApply} disabled={controller.policyBusy} onChange={event => void controller.changePolicy(event.target.checked)} />
      <span>{zh ? "此世界自动应用通过检查的安全改动" : "Automatically apply checked safe changes in this world"}</span>
    </label>}
    <CreationObjectEditor controller={controller} />
    {controller.policyError && <span role="alert" className="creation-target-note">{zh ? "设置未保存，请重试" : "Setting was not saved; try again"}</span>}
  </div>;
}
