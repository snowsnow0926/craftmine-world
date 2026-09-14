import {useEffect, useRef, useState} from "react";
import {Button, Input} from "../../ui";
import type {AssetVersion} from "./asset-library-model";
import type {AssetLibraryBridge} from "./use-asset-library";
import {currentDirectAttempts, directErrorMessage, directIsTerminal, parseDirectInspection, requestDirectOperation, retainDirectAttempt, useDirectAttempts, type DirectAttempt, type DirectInspection, type DirectStatus} from "./direct-library-state";

const stageCopy: Record<DirectStatus, [string, string]> = {
  preparing: ["正在准备素材", "Preparing asset"], checking: ["正在检查世界", "Checking the world"],
  ready: ["检查通过，等待加入", "Checks passed — ready to add"], applying: ["正在加入世界", "Adding to the world"],
  applied: ["已加入世界", "Added to the world"], cancelled: ["已取消", "Cancelled"],
  failed: ["未能加入", "Could not add"], interrupted: ["操作已中断", "Operation interrupted"],
};
const checkStageCopy = {
  claimed: ["检查任务已接收", "Check accepted"], import: ["正在导入模型与资源", "Importing models and resources"],
  export: ["正在构建世界", "Building the world"], "reuse-export": ["正在复用已验证构建", "Reusing a verified build"],
  "stage-artifacts": ["正在准备运行文件", "Preparing runtime files"], check: ["正在运行世界检查", "Running world checks"],
};

/** Read-only eligibility precedes the explicitly requested native preparation. */
export function DirectLibraryUse({bridge, worldId, asset, zh}: {bridge: AssetLibraryBridge | null; worldId: string | null; asset: AssetVersion; zh: boolean}) {
  const [inspection, setInspection] = useState<DirectInspection | null>(null), [error, setError] = useState("");
  const [custom, setCustom] = useState(false), [coordinates, setCoordinates] = useState({x: "0", y: "0", z: "0"});
  const [refresh, setRefresh] = useState(0);
  const started = useRef(false), alive = useRef(true);
  const attempts = useDirectAttempts();
  const active = attempts.some(row => row.request.worldId === worldId && !directIsTerminal(row.operation?.status));
  const isResource = ["world", "raw", "base", "data"].includes(asset.kind) || asset.mediaKind !== "package";
  useEffect(() => {
    let current = true; alive.current = true; started.current = false;
    setInspection(null); setError(""); setCustom(false); setCoordinates({x: "0", y: "0", z: "0"});
    if (bridge && worldId && !isResource) void bridge.call("library.direct", {action: "inspect", worldId,
      ref: {assetId: asset.assetId, version: asset.version, contentHash: asset.contentHash}})
      .then(raw => {if (current) setInspection(parseDirectInspection(raw));})
      .catch(failure => {if (current) setError(failure instanceof Error ? failure.message : String(failure));});
    return () => {current = false; alive.current = false;};
  }, [bridge, worldId, asset.assetId, asset.version, asset.contentHash, isResource, refresh]);
  const invalidPosition = custom && Object.values(coordinates).some(value => !value.trim() || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 80);
  const submit = () => {
    if (!bridge || !worldId || !inspection?.eligible || inspection.configurationRequired || active || started.current || invalidPosition) return;
    started.current = true;
    const attempt = retainDirectAttempt(worldId, {assetId: asset.assetId, version: asset.version, contentHash: asset.contentHash}, asset.displayName,
      custom && inspection.positionSupported ? {x: Number(coordinates.x), y: Number(coordinates.y), z: Number(coordinates.z)} : undefined);
    void requestDirectOperation(bridge, attempt, "start").finally(() => {if (alive.current) started.current = false;});
  };
  return <div className="asset-direct-use" data-direct-use={asset.assetId}>
    <h4 className="asset-library-section">{zh ? "直接使用" : "Use directly"}</h4>
    {!worldId ? <p>{zh ? "先打开一个世界，再从这里使用素材。" : "Open a world before using an asset here."}</p>
      : isResource ? <p data-direct-unavailable>{asset.kind === "world" ? (zh ? "世界模板用于新建独立世界。" : "World templates create independent worlds.") : (zh ? "这是原始资源，需要先组装为可放置的对象。可以让 AI 使用它。" : "This is a raw resource. It needs an assembled object before placement; AI can use it.")}</p>
      : !bridge ? <p>{zh ? "素材使用接口尚未就绪。" : "Asset use is unavailable."}</p>
      : error ? <><p role="alert">{directErrorMessage(error, zh)}</p><details><summary>{zh ? "原因" : "Reason"}</summary><p>{error}</p></details><form onSubmit={event => {event.preventDefault(); setRefresh(value => value + 1);}}><Button type="submit" size="sm" variant="secondary">{zh ? "重新读取" : "Read again"}</Button></form></>
      : !inspection ? <p role="status">{zh ? "正在读取使用要求…" : "Reading use requirements…"}</p>
      : !inspection.eligible || inspection.configurationRequired ? <><p data-direct-unavailable>{directErrorMessage(inspection.reason ?? "UNSUPPORTED", zh)}</p>{inspection.reason && <details><summary>{zh ? "原因" : "Reason"}</summary><p>{inspection.reason}</p></details>}</>
      : <form data-direct-start-form onSubmit={event => {event.preventDefault(); submit();}}>
        {inspection.warning && <p data-direct-warning>{directErrorMessage(inspection.warning, zh)}</p>}
        <p className="asset-library-field-hint">{zh ? "无需连接 AI。先检查当前世界，检查通过后再确认加入。" : "No AI connection needed. Check this world first, then confirm the addition."}</p>
        <fieldset disabled={active}>
          <p>{zh ? "素材默认位置" : "Asset default position"}</p>
          {inspection.positionSupported && <>
            <label className="asset-library-check"><input type="checkbox" data-direct-custom-position checked={custom} onChange={event => setCustom(event.target.checked)}/>{zh ? "调整放置坐标" : "Adjust placement coordinates"}</label>
            {custom && <div className="asset-direct-coordinates">{(["x", "y", "z"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<Input type="number" step="0.1" min={-80} max={80} required data-direct-position-axis={axis} value={coordinates[axis]} onChange={event => setCoordinates(value => ({...value, [axis]: event.target.value}))}/></label>)}</div>}
          </>}
          {custom && <p className="asset-library-field-hint">{zh ? "坐标单位为米，Y 为高度。缩略图不代表放置位置。先检查世界兼容性，加入后查看实际位置。" : "Coordinates are in meters; Y is height. The thumbnail does not show placement. Check world compatibility, then inspect the actual position after adding."}</p>}
          {invalidPosition && <p role="alert">{zh ? "请填写 −80 到 80 之间的有效坐标。" : "Enter valid coordinates between −80 and 80."}</p>}
          <Button type="submit" size="sm" disabled={invalidPosition} data-direct-start>{zh ? "检查并准备加入" : "Check and prepare"}</Button>
        </fieldset>
        {active && <p className="asset-library-field-hint">{zh ? "请先完成或取消上方的素材操作。" : "Finish or cancel the asset operation above first."}</p>}
      </form>}
  </div>;
}

/** The activity list is outside asset selection, so closing or browsing cannot hide ownership. */
export function DirectLibraryActivity({bridge, worldId, zh}: {bridge: AssetLibraryBridge | null; worldId: string | null; zh: boolean}) {
  const attempts = useDirectAttempts().filter(row => row.request.worldId === worldId);
  useEffect(() => {
    if (!bridge || !worldId) return;
    let stopped = false; const polling = new Set<string>();
    const poll = (reconcileAll = false) => {
      if (stopped) return;
      for (const attempt of currentDirectAttempts().filter(row => row.request.worldId === worldId && (reconcileAll || !directIsTerminal(row.operation?.status)))) {
        if (polling.has(attempt.request.operationId)) continue;
        polling.add(attempt.request.operationId);
        void requestDirectOperation(bridge, attempt, "status").finally(() => polling.delete(attempt.request.operationId));
      }
    };
    poll(true); const timer = setInterval(poll, 1500);
    return () => {stopped = true; clearInterval(timer);};
  }, [bridge, worldId]);
  if (!attempts.length) return null;
  const newestFirst = [...attempts].reverse();
  const visible = newestFirst.filter((row, index) => index === 0 || !directIsTerminal(row.operation?.status));
  const history = newestFirst.filter(row => !visible.includes(row));
  const renderAttempt = (attempt: DirectAttempt) => {
      const operation = attempt.operation, status = operation?.status, rawError = attempt.error || (operation?.error ? `${operation.error.code}: ${operation.error.message}` : "");
      const run = (action: "start" | "status" | "cancel" | "apply") => {if (bridge) void requestDirectOperation(bridge, attempt, action);};
      return <article key={attempt.request.operationId} data-direct-operation={attempt.request.operationId} data-direct-world={attempt.request.worldId} data-direct-status={status ?? "unknown"}>
        <strong>{attempt.displayName} · v{attempt.request.ref.version}</strong>
        <p role="status">{status ? stageCopy[status][zh ? 0 : 1] : zh ? "正在确认准备状态" : "Confirming preparation status"}</p>
        {status === "checking" && operation?.checkProgress && <p data-direct-native-stage={operation.checkProgress.stage}>{checkStageCopy[operation.checkProgress.stage][zh ? 0 : 1]} · {operation.checkProgress.percent}%</p>}
        {operation?.timings && <p className="asset-library-field-hint" data-direct-timings>
          {operation.timings.preparationMs !== undefined && <span>{zh ? "准备及检查" : "Preparation and checks"}: {(operation.timings.preparationMs / 1000).toFixed(1)}{zh ? " 秒" : " s"}</span>}
          {operation.timings.applyMs !== undefined && <span>{" · "}{zh ? "加入世界" : "Addition"}: {(operation.timings.applyMs / 1000).toFixed(1)}{zh ? " 秒" : " s"}</span>}
        </p>}
        {operation?.draftRetained && status !== "applied" && <p>{zh ? "本次准备保留了草稿，原来的正式世界仍保留。" : "This preparation retained a draft; the original formal world remains available."}</p>}
        {status === "applied" && <p>{zh ? "可以关闭素材库继续游玩。通过原有修改与保存功能继续创作。" : "Close the library to continue playing. Use the existing editing and save controls to continue creating."}</p>}
        {status === "interrupted" && <p>{zh ? "应用重启后不会自动继续加入。请查看原因，再处理保留的草稿。" : "Restarting the app does not automatically add interrupted work. Review the reason and any retained draft."}</p>}
        {rawError && <><p role="alert">{directErrorMessage(rawError, zh)}</p><details data-direct-error><summary>{zh ? "检查原因" : "Reported reason"}</summary><p>{rawError}</p></details></>}
        <div className="asset-library-use-actions">
          {status === "ready" && <form data-direct-action="apply" onSubmit={event => {event.preventDefault(); run("apply");}}><Button type="submit" size="sm" disabled={!bridge || attempt.pending}>{zh ? "加入当前世界" : "Add to this world"}</Button></form>}
          {!status && <form data-direct-action="retry" onSubmit={event => {event.preventDefault(); run("start");}}><Button type="submit" size="sm" variant="secondary" disabled={!bridge || attempt.pending}>{zh ? "重试本次准备" : "Retry this preparation"}</Button></form>}
          {!directIsTerminal(status) && <form data-direct-action="cancel" onSubmit={event => {event.preventDefault(); run("cancel");}}><Button type="submit" size="sm" variant="secondary" disabled={!bridge}>{zh ? "取消本次操作" : "Cancel this operation"}</Button></form>}
          <form data-direct-action="status" onSubmit={event => {event.preventDefault(); run("status");}}><Button type="submit" size="sm" variant="ghost" disabled={!bridge}>{zh ? "刷新状态" : "Refresh status"}</Button></form>
        </div>
      </article>;
  };
  return <section className="asset-direct-activity" aria-label={zh ? "素材操作" : "Asset operations"} data-direct-activity>
    <h3>{zh ? "素材操作" : "Asset operations"}</h3>
    <p className="asset-library-field-hint">{zh ? "关闭素材库后操作仍会保留；返回这里查看结果。" : "Operations remain available after closing the library. Return here to see the result."}</p>
    {visible.map(renderAttempt)}
    {history.length > 0 && <details data-direct-history><summary>{zh ? `此前操作（${history.length}）` : `Earlier operations (${history.length})`}</summary>{history.map(renderAttempt)}</details>}
  </section>;
}
