import { useEffect, useState } from "react";
import { AlertTriangle, Box, Loader, Plus, RefreshCw } from "lucide-react";
import {
  creationActions,
  creationProgressText,
  creationStageText,
  isWorldPlayable,
  sortWorldEntries,
  worldBaseLabel,
  worldBaseState,
  worldCheckLabel,
  worldCheckTone,
  worldRecency,
  worldStateLabel,
  type CraftmineCreationAction,
  type CraftmineLang,
  type CraftmineWorldEntry,
} from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";
import { WorldCreatePanel } from "./WorldCreatePanel";

/**
 * The world list for the left column. Every row is host data: name, reported
 * base, save recency, the latest check and the real initialization state.
 * Nothing is derived from a local world store, so an unwired host renders as an
 * explicit unavailable state. A world that has not finished initializing is
 * listed with its host-reported stage but cannot be opened, and recovery
 * buttons appear only for actions the host says it can perform.
 */
export function WorldListPanel({
  controller,
  lang,
  onOpenWorld,
  onCreated,
}: {
  controller: CraftmineWorldsController;
  lang: CraftmineLang;
  onOpenWorld: () => void;
  onCreated?: (worldId: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = sortWorldEntries(controller.worlds, controller.activeWorldId);
  const taskWorldId = controller.activeTask?.worldId ?? null;

  return (
    <section
      className="craftmine-world-list"
      aria-label={CRAFTMINE_WORLD_TEXT.worldsTitle[lang]}
      data-world-list-state={controller.status}
    >
      <div className="craftmine-world-list-head">
        <span className="craftmine-world-list-title">{CRAFTMINE_WORLD_TEXT.worldsTitle[lang]}</span>
        <button
          type="button"
          className="craftmine-world-icon-btn"
          onClick={() => void controller.refresh()}
          disabled={controller.busy || controller.status === "unavailable"}
          aria-label={CRAFTMINE_WORLD_TEXT.refresh[lang]}
          title={CRAFTMINE_WORLD_TEXT.refresh[lang]}
        >
          <RefreshCw size={14} aria-hidden />
        </button>
        <button
          type="button"
          className="craftmine-world-icon-btn"
          data-action="new-world"
          onClick={() => setCreating((open) => !open)}
          disabled={controller.busy || controller.status === "unavailable" || controller.capabilities?.create === false}
          aria-expanded={creating}
          aria-label={CRAFTMINE_WORLD_TEXT.newWorld[lang]}
          title={CRAFTMINE_WORLD_TEXT.newWorld[lang]}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {creating && <WorldCreatePanel controller={controller} lang={lang} onClose={() => setCreating(false)} onCreated={onCreated} />}

      {controller.status === "loading" && (
        <p className="craftmine-world-note" data-world-state="loading">{CRAFTMINE_WORLD_TEXT.loading[lang]}</p>
      )}
      {controller.status === "unavailable" && (
        <div className="craftmine-world-note" data-world-state="unavailable">
          <p>{CRAFTMINE_WORLD_TEXT.unavailable[lang]}</p>
          <p className="craftmine-world-note-hint">{CRAFTMINE_WORLD_TEXT.unavailableHint[lang]}</p>
        </div>
      )}
      {controller.status === "ready" && rows.length === 0 && (
        <div className="craftmine-world-note" data-world-state="empty">
          <p>{CRAFTMINE_WORLD_TEXT.empty[lang]}</p>
          <p className="craftmine-world-note-hint">{CRAFTMINE_WORLD_TEXT.emptyHint[lang]}</p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="craftmine-world-items">
          {rows.map((entry) => (
            <li key={entry.id}>
              <WorldRow
                entry={entry}
                lang={lang}
                now={now}
                active={entry.id === controller.activeWorldId}
                taskHere={entry.id === taskWorldId}
                busy={controller.busy}
                createActionsSupported={controller.capabilities?.createActions === true}
                onDelete={entry.state === "failed" && controller.capabilities?.archiveFailed ? () => void controller.removeFailedWorld(entry.id) : undefined}
                onContinuePreparation={controller.capabilities?.switch === true ? () => void controller.continuePreparation(entry.id) : undefined}
                onSelect={() => {
                  // An unfinished world cannot be opened; asking the controller
                  // anyway lets it show the host-independent reason instead of
                  // silently doing nothing.
                  if (!isWorldPlayable(entry)) {
                    void controller.select(entry.id);
                    return;
                  }
                  if (entry.id !== controller.activeWorldId) void controller.select(entry.id);
                  else onOpenWorld();
                }}
                onCreationAction={(action) => {
                  if (action === "choose-base") setCreating(true);
                  else void controller.creationAction(entry.id, action);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {controller.notice && (
        <p className="craftmine-world-notice" data-world-notice="info" role="status">{controller.notice}</p>
      )}
      {(controller.archivedWorlds?.length ?? 0) > 0 && (
        <details className="craftmine-world-item-recovery" data-recently-deleted>
          <summary>{CRAFTMINE_WORLD_TEXT.recentlyDeleted[lang]} ({controller.archivedWorlds.length})</summary>
          <p className="craftmine-world-note-hint">{CRAFTMINE_WORLD_TEXT.removeHint[lang]}</p>
          <ul className="craftmine-world-items">
            {controller.archivedWorlds.map(world => <li key={world.id} data-deleted-world-id={world.id}>
              <span>{world.title}</span>{" "}
              <button type="button" data-world-restore={world.id} disabled={controller.busy} onClick={() => void controller.restoreWorld(world.id)}>{CRAFTMINE_WORLD_TEXT.restoreWorld[lang]}</button>
            </li>)}
          </ul>
        </details>
      )}
      {controller.error && (
        <p className="craftmine-world-error" data-world-notice="error" role="alert">{controller.error}</p>
      )}
    </section>
  );
}

const CREATION_ACTION_TEXT: Record<CraftmineCreationAction, keyof typeof CRAFTMINE_WORLD_TEXT> = {
  retry: "createRetry",
  "choose-base": "createChooseBase",
  "discard-draft": "createDiscard",
  details: "createDetails",
};

function WorldRow({
  entry,
  lang,
  now,
  active,
  taskHere,
  busy,
  createActionsSupported,
  onSelect,
  onCreationAction,
  onContinuePreparation,
  onDelete,
}: {
  entry: CraftmineWorldEntry;
  lang: CraftmineLang;
  now: number;
  active: boolean;
  taskHere: boolean;
  busy: boolean;
  createActionsSupported: boolean;
  onSelect: () => void;
  onCreationAction: (action: CraftmineCreationAction) => void;
  onContinuePreparation?: () => void;
  onDelete?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const check = worldCheckLabel(entry.check, lang);
  const playable = isWorldPlayable(entry);
  const stage = creationStageText(entry.creation, lang);
  const progress = creationProgressText(entry.creation, lang);
  // Only the actions the host reported are rendered; an unsupported recovery
  // path is not shown as a button that would fail on click.
  const actions = createActionsSupported ? creationActions(entry.creation) : [];
  return (
    <div className="craftmine-world-item-wrap">
      <button
        type="button"
        className={`craftmine-world-item${active ? " is-active" : ""}`}
        data-world-id={entry.id}
        data-world-active={active ? "true" : "false"}
        data-world-base-state={worldBaseState(entry)}
        data-world-state={entry.state}
        data-world-playable={playable ? "true" : "false"}
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        disabled={busy && !active}
      >
        {playable ? (
          <Box size={15} aria-hidden className="craftmine-world-item-icon" />
        ) : entry.state === "failed" ? (
          <AlertTriangle size={15} aria-hidden className="craftmine-world-item-icon is-failed" />
        ) : (
          <Loader size={15} aria-hidden className="craftmine-world-item-icon is-busy" />
        )}
        <span className="craftmine-world-item-body">
          <span className="craftmine-world-item-name">{entry.title}</span>
          <span className="craftmine-world-item-base">{worldBaseLabel(entry, lang)}</span>
          <span className="craftmine-world-item-meta">
            {playable ? (
              <span className="craftmine-world-item-recent">{worldRecency(entry.updatedAt, now, lang)}</span>
            ) : (
              <span
                className={`craftmine-world-item-creation is-${entry.state}`}
                data-world-creation-stage={entry.creation?.stage ?? ""}
              >
                {worldStateLabel(entry.state, lang)}
                {stage ? ` · ${stage}` : ""}
                {progress ? ` · ${progress}` : ""}
              </span>
            )}
            {check && (
              <span className={`craftmine-world-item-check is-${worldCheckTone(entry.check)}`}>{check}</span>
            )}
            {active && <span className="craftmine-world-item-active">{CRAFTMINE_WORLD_TEXT.active[lang]}</span>}
            {taskHere && <span className="craftmine-world-item-task">{CRAFTMINE_WORLD_TEXT.taskHere[lang]}</span>}
          </span>
        </span>
      </button>

      {!active && entry.state === "initializing" && onContinuePreparation && (
        <button type="button" className="craftmine-world-item-actions" data-world-continue={entry.id}
          disabled={busy} onClick={onContinuePreparation}>
          {lang === "zh" ? "继续准备世界" : "Continue preparing world"}
        </button>
      )}
      {onDelete && <button type="button" className="craftmine-world-item-actions" data-world-delete={entry.id}
        title={CRAFTMINE_WORLD_TEXT.removeHint[lang]} disabled={busy} onClick={onDelete}>{CRAFTMINE_WORLD_TEXT.deleteWorld[lang]}</button>}

      {!playable && (actions.length > 0 || entry.creation?.error) && (
        <div className="craftmine-world-item-recovery" data-world-recovery={entry.id}>
          {entry.creation?.error && (
            <p className="craftmine-world-error" data-world-recovery-error="true">
              {entry.creation.error.message || entry.creation.error.code}
            </p>
          )}
          {actions.length > 0 && (
            <div className="craftmine-world-item-actions">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  data-world-recovery-action={action}
                  disabled={busy}
                  onClick={() => {
                    if (action === "details") setDetails((open) => !open);
                    else onCreationAction(action);
                  }}
                >
                  {CRAFTMINE_WORLD_TEXT[CREATION_ACTION_TEXT[action]][lang]}
                </button>
              ))}
            </div>
          )}
          {details && entry.creation && (
            <dl className="craftmine-world-creation-detail" data-world-creation-detail="true">
              <dt>{CRAFTMINE_WORLD_TEXT.creationStage[lang]}</dt>
              <dd>{stage || entry.creation.stage || "—"}</dd>
              <dt>operationId</dt>
              <dd>{entry.creation.operationId || "—"}</dd>
              {entry.creation.stages.length > 0 && (
                <>
                  <dt>{CRAFTMINE_WORLD_TEXT.creationStage[lang]}</dt>
                  <dd>
                    <ul className="craftmine-world-creation-steps">
                      {entry.creation.stages.map((item) => (
                        <li
                          key={item.id}
                          data-creation-step={item.id}
                          data-creation-step-status={item.status}
                        >
                          {item.label} · {item.status}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              )}
              {entry.creation.error && (
                <>
                  <dt>error</dt>
                  <dd>{entry.creation.error.code}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
