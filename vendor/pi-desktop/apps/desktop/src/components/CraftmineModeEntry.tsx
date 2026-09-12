import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe2, PanelsTopLeft, ArrowLeft } from "lucide-react";
import { useCraftmineWorlds } from "../hooks/use-craftmine-worlds";
import { craftmineLang, isWorldPlayable } from "../lib/craftmine-worlds";
import { CRAFTMINE_MODE_TEXT } from "../lib/craftmine-mode-text";
import type { CraftmineLayout } from "../lib/craftmine-layout";
import { WorldListPanel } from "./craftmine/WorldListPanel";
import { WindowControls } from "./WindowControls";
import "../styles/craftmine-mode-entry.css";

/** A launch choice, never a saved preference that bypasses the next launch. */
export function CraftmineModeEntry({ onSelect }: {
  onSelect: (mode: CraftmineLayout["mode"]) => void;
}) {
  const { i18n } = useTranslation();
  const lang = craftmineLang(i18n.language);
  const text = CRAFTMINE_MODE_TEXT;
  const worlds = useCraftmineWorlds(lang);
  const [selectingWorld, setSelectingWorld] = useState(false);
  const canEnter = worlds.status === "ready" && !worlds.busy &&
    !!worlds.activeWorld && isWorldPlayable(worlds.activeWorld);
  const enterWorld = () => { if (canEnter) onSelect("play"); };
  return (
    <main className="craftmine-mode-entry" aria-labelledby="craftmine-mode-entry-title" data-mode-entry>
      <header className="craftmine-mode-entry-titlebar"><span>CRAFTMINE WORLD</span><WindowControls /></header>
      <div className="craftmine-mode-entry-content no-drag">
        <h1 id="craftmine-mode-entry-title">{text[selectingWorld ? "chooseWorld" : "chooseMode"][lang]}</h1>
        {selectingWorld ? (
          <div className="craftmine-mode-worlds">
            <button type="button" className="craftmine-mode-back" onClick={() => setSelectingWorld(false)}>
              <ArrowLeft size={16} aria-hidden />{text.chooseMode[lang]}
            </button>
            <WorldListPanel controller={worlds} lang={lang} onOpenWorld={enterWorld} />
            <button type="button" className="craftmine-mode-enter-world" data-mode="play"
              data-active-world={canEnter ? worlds.activeWorldId : undefined} disabled={!canEnter} onClick={enterWorld}>
              {text.enterWorld[lang]}
            </button>
          </div>
        ) : (
          <div className="craftmine-mode-choices">
            <button type="button" className="craftmine-mode-choice craftmine-mode-choice-world" data-mode="play"
              data-active-world={canEnter ? worlds.activeWorldId : undefined}
              onClick={() => canEnter ? enterWorld() : setSelectingWorld(true)}>
              <Globe2 className="craftmine-mode-icon" size={48} aria-hidden />
              <h2>{text.immersive[lang]}</h2>
              <p>{text.immersiveDescription[lang]}</p>
              {canEnter && <span className="craftmine-mode-current-world">{worlds.activeWorld!.title}</span>}
              <span className="craftmine-mode-choice-action">{text.enter[lang]} →</span>
            </button>
            <button type="button" className="craftmine-mode-choice craftmine-mode-choice-workbench" data-mode="create"
              onClick={() => onSelect("create")}>
              <PanelsTopLeft className="craftmine-mode-icon" size={48} aria-hidden />
              <h2>{text.workbench[lang]}</h2>
              <p>{text.workbenchDescription[lang]}</p>
              <span className="craftmine-mode-choice-action">{text.enter[lang]} →</span>
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
