import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CRAFTMINE_AUX_SECTIONS, auxSummaryText, loadAuxSummary, type CraftmineAuxSurface } from "../../lib/craftmine-aux";
import type { CraftmineAuxSummary, CraftmineLang } from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import { loadCraftmineLayout, rememberCraftmineAux } from "../../lib/craftmine-layout";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";

/**
 * Auxiliary surfaces (works, assets, checks, memory, tasks, backups) stay
 * collapsed until asked for. Expanding one reads its real host summary; the
 * full surface is opened inside the world panel rather than duplicated here.
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
  const [summaries, setSummaries] = useState<Record<string, CraftmineAuxSummary | null>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const sync = () => setExpanded(loadCraftmineLayout(localStorage).aux);
    window.addEventListener("craftmine-layout-changed", sync);
    return () => window.removeEventListener("craftmine-layout-changed", sync);
  }, []);

  const load = useCallback(
    async (id: string) => {
      const worldId = controller.activeWorldId;
      if (!controller.bridge || !worldId) {
        setSummaries((current) => ({ ...current, [id]: null }));
        return;
      }
      setPending((current) => ({ ...current, [id]: true }));
      try {
        const summary = await loadAuxSummary(controller.bridge, worldId, id as never);
        setSummaries((current) => ({ ...current, [id]: summary }));
      } catch {
        setSummaries((current) => ({ ...current, [id]: null }));
      } finally {
        setPending((current) => ({ ...current, [id]: false }));
      }
    },
    [controller.activeWorldId, controller.bridge],
  );

  const toggle = (id: string) => {
    const next = !expanded[id];
    rememberCraftmineAux(localStorage, id, next);
    setExpanded((current) => ({ ...current, [id]: next }));
    window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
    if (next && !(id in summaries)) void load(id);
  };

  return (
    <section className="craftmine-aux" aria-label={CRAFTMINE_WORLD_TEXT.auxTitle[lang]} data-aux-sections="true">
      <span className="craftmine-world-list-title">{CRAFTMINE_WORLD_TEXT.auxTitle[lang]}</span>
      <ul className="craftmine-aux-items">
        {CRAFTMINE_AUX_SECTIONS.map((section) => {
          const open = expanded[section.id] === true;
          return (
            <li key={section.id} className="craftmine-aux-item" data-aux-section={section.id}>
              <button
                type="button"
                className="craftmine-aux-toggle"
                aria-expanded={open}
                aria-controls={`craftmine-aux-body-${section.id}`}
                data-aux-toggle={section.id}
                onClick={() => toggle(section.id)}
              >
                <ChevronRight size={14} aria-hidden className={`craftmine-aux-chevron${open ? " is-open" : ""}`} />
                <span className="craftmine-aux-label">{section.label[lang]}</span>
                <span className="craftmine-aux-summary" data-aux-summary={section.id}>
                  {pending[section.id] ? "..." : auxSummaryText(summaries[section.id] ?? null, lang)}
                </span>
              </button>
              <div id={`craftmine-aux-body-${section.id}`} className="craftmine-aux-body" hidden={!open}>
                <p className="craftmine-aux-note">{section.note[lang]}</p>
                <button
                  type="button"
                  className="craftmine-aux-open"
                  data-aux-open={section.id}
                  onClick={() => onOpenSurface(section.surface, section.id)}
                >
                  {CRAFTMINE_WORLD_TEXT.auxOpen[lang]}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}