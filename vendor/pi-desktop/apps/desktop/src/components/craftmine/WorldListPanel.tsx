import { useEffect, useState } from "react";
import { Box, Plus, RefreshCw } from "lucide-react";
import {
  sortWorldEntries,
  worldBaseLabel,
  worldBaseState,
  worldCheckLabel,
  worldCheckTone,
  worldRecency,
  type CraftmineLang,
  type CraftmineWorldEntry,
} from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";
import { WorldCreatePanel } from "./WorldCreatePanel";

/**
 * The world list for the left column. Every row is host data: name, reported
 * base, save recency and the latest check. Nothing is derived from a local
 * world store, so an unwired host renders as an explicit unavailable state.
 */
export function WorldListPanel({
  controller,
  lang,
  onOpenWorld,
}: {
  controller: CraftmineWorldsController;
  lang: CraftmineLang;
  onOpenWorld: () => void;
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
    <section className="craftmine-world-list" aria-label={CRAFTMINE_WORLD_TEXT.worldsTitle[lang]} data-world-list-state={controller.status}>
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
          disabled={controller.status === "unavailable" || controller.capabilities?.create === false}
          aria-expanded={creating}
          aria-label={CRAFTMINE_WORLD_TEXT.newWorld[lang]}
          title={CRAFTMINE_WORLD_TEXT.newWorld[lang]}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

      {creating && <WorldCreatePanel controller={controller} lang={lang} onClose={() => setCreating(false)} />}

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
                onSelect={() => {
                  if (entry.id !== controller.activeWorldId) void controller.select(entry.id);
                  else onOpenWorld();
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {controller.notice && (
        <p className="craftmine-world-notice" data-world-notice="info" role="status">{controller.notice}</p>
      )}
      {controller.error && (
        <p className="craftmine-world-error" data-world-notice="error" role="alert">{controller.error}</p>
      )}
    </section>
  );
}

function WorldRow({
  entry,
  lang,
  now,
  active,
  taskHere,
  busy,
  onSelect,
}: {
  entry: CraftmineWorldEntry;
  lang: CraftmineLang;
  now: number;
  active: boolean;
  taskHere: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const check = worldCheckLabel(entry.check, lang);
  return (
    <button
      type="button"
      className={`craftmine-world-item${active ? " is-active" : ""}`}
      data-world-id={entry.id}
      data-world-active={active ? "true" : "false"}
      data-world-base-state={worldBaseState(entry)}
      aria-current={active ? "true" : undefined}
      aria-label={entry.title}
      onClick={onSelect}
      disabled={busy && !active}
    >
      <Box size={15} aria-hidden className="craftmine-world-item-icon" />
      <span className="craftmine-world-item-body">
        <span className="craftmine-world-item-name">{entry.title}</span>
        <span className="craftmine-world-item-base">{worldBaseLabel(entry, lang)}</span>
        <span className="craftmine-world-item-meta">
          <span className="craftmine-world-item-recent">{worldRecency(entry.updatedAt, now, lang)}</span>
          {check && (
            <span className={`craftmine-world-item-check is-${worldCheckTone(entry.check)}`}>{check}</span>
          )}
          {active && <span className="craftmine-world-item-active">{CRAFTMINE_WORLD_TEXT.active[lang]}</span>}
          {taskHere && <span className="craftmine-world-item-task">{CRAFTMINE_WORLD_TEXT.taskHere[lang]}</span>}
        </span>
      </span>
    </button>
  );
}