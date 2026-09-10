import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CRAFTMINE_AUX_SECTIONS, auxSummaryText, loadAuxSummary, type CraftmineAuxSurface } from "../../lib/craftmine-aux";
import type { CraftmineAuxSummary, CraftmineLang } from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import { loadCraftmineLayout, rememberCraftmineAux } from "../../lib/craftmine-layout";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";

type LoadedSummary = { worldId: string; summary: CraftmineAuxSummary | null };

/**
 * Auxiliary surfaces (works, assets, checks, memory, tasks, backups) stay
 * collapsed until asked for. Expanding one reads its real host summary for the
 * current world; a summary read for another world is never shown here.
 */
export function WorldAuxSections({
  controller,
  lang,
  onOpenSurface,
}: {
  controller: CraftmineWorldsController;
  lang: CraftmineLang;
  onOpenSurface: (surface: CraftmineAuxSurface, section: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    () => loadCraftmineLayout(localStorage).aux,
  );
  const [summaries, setSummaries] = useState<Record<string, LoadedSummary>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const worldId = controller.activeWorldId;
  const worldIdRef = useRef<string | null>(worldId);
  useEffect(() => {
    worldIdRef.current = worldId;
  }, [worldId]);

  useEffect(() => {
    const sync = () => setExpanded(loadCraftmineLayout(localStorage).aux);
    window.addEventListener("craftmine-layout-changed", sync);
    return () => window.removeEventListener("craftmine-layout-changed", sync);
  }, []);

  // A summary belongs to the world it was read from; switching worlds drops it.
  useEffect(() => {
    setSummaries({});
    setPending({});
  }, [worldId]);

  const load = useCallback(
    async (id: string) => {
      const bridge = controller.bridge;
      const readFor = worldIdRef.current;
      if (!bridge || !readFor) {
        setSummaries((current) => ({ ...current, [id]: { worldId: "", summary: null } }));
        return;
      }
      setPending((current) => ({ ...current, [id]: true }));
      try {
        const summary = await loadAuxSummary({...bridge, call: (channel, payload) => bridge.call(channel, channel === "asset.search" ? {...payload, ownerWorldId: readFor} : payload)}, readFor, id as never);
        // A late reply for a world that is no longer active is discarded.
        if (worldIdRef.current !== readFor) return;
        setSummaries((current) => ({ ...current, [id]: { worldId: readFor, summary } }));
      } catch {
        if (worldIdRef.current !== readFor) return;
        setSummaries((current) => ({ ...current, [id]: { worldId: readFor, summary: null } }));
      } finally {
        setPending((current) => ({ ...current, [id]: false }));
      }
    },
    [controller.bridge],
  );

  const toggle = (id: string) => {
    const next = !expanded[id];
    rememberCraftmineAux(localStorage, id, next);
    setExpanded((current) => ({ ...current, [id]: next }));
    window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
    const loaded = summaries[id];
    if (next && (!loaded || loaded.worldId !== worldId)) void load(id);
  };

  return (
    <section className="craftmine-aux" aria-label={CRAFTMINE_WORLD_TEXT.auxTitle[lang]} data-aux-sections="true">
      <span className="craftmine-world-list-title">{CRAFTMINE_WORLD_TEXT.auxTitle[lang]}</span>
      <ul className="craftmine-aux-items">
        {CRAFTMINE_AUX_SECTIONS.map((section) => {
          const open = expanded[section.id] === true;
          const loaded = summaries[section.id];
          const summary = loaded && loaded.worldId === worldId ? loaded.summary : null;
          return (
            <li key={section.id} className="craftmine-aux-item" data-aux-section={section.id}>
              <form style={{display:"contents"}} data-aux-toggle-form={section.id} onSubmit={event => {event.preventDefault(); toggle(section.id);}}>
              <button
                type="submit"
                className="craftmine-aux-toggle"
                aria-expanded={open}
                aria-controls={`craftmine-aux-body-${section.id}`}
                data-aux-toggle={section.id}
              >
                <ChevronRight size={14} aria-hidden className={`craftmine-aux-chevron${open ? " is-open" : ""}`} />
                <span className="craftmine-aux-label">{section.label[lang]}</span>
                <span className="craftmine-aux-summary" data-aux-summary={section.id}>
                  {pending[section.id] ? "..." : auxSummaryText(summary, lang)}
                </span>
              </button></form>
              <div id={`craftmine-aux-body-${section.id}`} className="craftmine-aux-body" hidden={!open}>
                <p className="craftmine-aux-note">{section.note[lang]}</p>
                <form style={{display:"contents"}} data-aux-open-form={section.id} onSubmit={event => {event.preventDefault(); onOpenSurface(section.surface, section.id);}}>
                <button
                  type="submit"
                  className="craftmine-aux-open"
                  data-aux-open={section.id}
                >
                  {CRAFTMINE_WORLD_TEXT.auxOpen[lang]}
                </button></form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}