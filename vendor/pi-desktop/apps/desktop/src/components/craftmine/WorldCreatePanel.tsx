import { useRef, useState } from "react";
import {
  CRAFTMINE_WORLD_TITLE_MAX,
  normalizeWorldTitle,
  validateWorldTitle,
  worldStartersForBase,
  worldCreationBaseLabel,
  resolveWorldCreationSelection,
  type CraftmineLang,
} from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";
import { createCopiedWorldSession, useAppStore } from "../../stores/app-store";
import { enterCraftmineMode } from "../../lib/craftmine-mode";

/**
 * Create flow: base, start point, name. Only options the host reports as
 * delivered are selectable; planned or unreported choices stay visible but
 * disabled so the screen never promises an unavailable base. Submitting a base
 * that needs initialization closes the form once the host registered the world;
 * the world list then shows the host's real initialization progress, and the
 * world is opened only after the host reports it ready.
 */
export function WorldCreatePanel({
  controller,
  lang,
  onClose,
  onCreated,
}: {
  controller: CraftmineWorldsController;
  lang: CraftmineLang;
  onClose: () => void;
  onCreated?: (worldId: string) => Promise<void>;
}) {
  const bases = controller.capabilities?.bases ?? [];
  const [baseId, setBaseId] = useState(() => bases.find((base) => base.delivered)?.id ?? "");
  const starters = worldStartersForBase(controller.capabilities, baseId);
  const [starterId, setStarterId] = useState("");
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // One stable identity for this dialog. Retrying after a lost reply targets
  // the same world instead of creating a second one.
  const operationId = useRef<string>(
    globalThis.crypto?.randomUUID?.() ?? `create-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const deliveredBase = bases.some((base) => base.delivered);
  const submit = async () => {
    const invalid = validateWorldTitle(title, lang);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    // Resolve the selection against the current capabilities: a base that
    // arrived late, was removed, or is not delivered must never be sent.
    const {baseId: chosenBase, starterId: chosenStarter} = resolveWorldCreationSelection(controller.capabilities, baseId, starterId);
    const created = await controller.create({
      title: normalizeWorldTitle(title),
      operationId: operationId.current,
      ...(chosenBase ? { baseId: chosenBase } : {}),
      ...(chosenStarter ? { starterId: chosenStarter } : {}),
    }, onCreated ?? (async worldId => {
      await createCopiedWorldSession(worldId, useAppStore.getState().activeSessionId);
      enterCraftmineMode("create", { explicit: true });
    }));
    if (created) onClose();
  };

  return (
    <form
      className="craftmine-world-create"
      data-world-create="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="craftmine-world-create-title">{CRAFTMINE_WORLD_TEXT.createTitle[lang]}</span>

      <fieldset className="craftmine-world-create-group" disabled={controller.busy}>
        <legend>{CRAFTMINE_WORLD_TEXT.createBase[lang]}</legend>
        {bases.length === 0 ? (
          <p className="craftmine-world-note-hint" data-world-create="base-unreported">
            {CRAFTMINE_WORLD_TEXT.createBaseNone[lang]}
          </p>
        ) : (
          bases.map((base) => (
            <label
              key={base.id}
              className="craftmine-world-choice"
              data-world-base-option={base.id}
              data-world-base-delivered={base.delivered ? "true" : "false"}
            >
              <input
                type="radio"
                name="craftmine-world-base"
                value={base.id}
                checked={baseId === base.id}
                disabled={!base.delivered}
                onChange={() => { setBaseId(base.id); setStarterId(""); }}
              />
              <span className="craftmine-world-choice-text">
                <span className="craftmine-world-choice-label">{worldCreationBaseLabel(base, lang)}</span>
                {base.description && <span className="craftmine-world-choice-desc">{base.description}</span>}
              </span>
              {!base.delivered && <span className="craftmine-world-tag">{CRAFTMINE_WORLD_TEXT.planned[lang]}</span>}
            </label>
          ))
        )}
        {bases.length > 0 && !deliveredBase && (
          <p className="craftmine-world-note-hint" data-world-create="base-none-delivered">
            {CRAFTMINE_WORLD_TEXT.createBaseMissing[lang]}
          </p>
        )}
      </fieldset>

      <fieldset className="craftmine-world-create-group" disabled={controller.busy}>
        <legend>{CRAFTMINE_WORLD_TEXT.createStarter[lang]}</legend>
        <label className="craftmine-world-choice" data-world-starter-option="blank">
          <input
            type="radio"
            name="craftmine-world-starter"
            value=""
            checked={starterId === ""}
            onChange={() => setStarterId("")}
          />
          <span>{CRAFTMINE_WORLD_TEXT.createStarterBlank[lang]}</span>
        </label>
        {starters.filter(starter => starter.id !== "blank").map((starter) => (
          <label
            key={starter.id}
            className="craftmine-world-choice"
            data-world-starter-option={starter.id}
            data-world-starter-delivered={starter.delivered ? "true" : "false"}
          >
            <input
              type="radio"
              name="craftmine-world-starter"
              value={starter.id}
              checked={starterId === starter.id}
              disabled={!starter.delivered}
              onChange={() => setStarterId(starter.id)}
            />
            <span className="craftmine-world-choice-text">
              <span className="craftmine-world-choice-label">{starter.label}</span>
              {starter.description && (
                <span className="craftmine-world-choice-desc">{starter.description}</span>
              )}
            </span>
            {!starter.delivered && <span className="craftmine-world-tag">{CRAFTMINE_WORLD_TEXT.planned[lang]}</span>}
          </label>
        ))}
      </fieldset>

      <label className="craftmine-world-create-field">
        <span>{CRAFTMINE_WORLD_TEXT.createName[lang]}</span>
        <input
          type="text"
          value={title}
          maxLength={CRAFTMINE_WORLD_TITLE_MAX}
          placeholder={CRAFTMINE_WORLD_TEXT.createNamePlaceholder[lang]}
          data-world-create="name"
          disabled={controller.busy}
          onChange={(event) => {
            setTitle(event.target.value);
            if (localError) setLocalError(null);
          }}
        />
      </label>

      {localError && <p className="craftmine-world-error" role="alert" data-world-create="validation">{localError}</p>}

      <div className="craftmine-world-create-actions">
        <button
          type="submit"
          data-world-create="submit"
          disabled={controller.busy || (bases.length > 0 && !deliveredBase)}
        >
          {controller.busy ? CRAFTMINE_WORLD_TEXT.creating[lang] : CRAFTMINE_WORLD_TEXT.createSubmit[lang]}
        </button>
        <button type="button" data-action="cancel-world-create" disabled={controller.busy && !controller.canCancelCreate} onClick={() => { void Promise.resolve(controller.cancelCreate?.()).then(closed => {if (closed !== false) onClose();}); }}>
          {CRAFTMINE_WORLD_TEXT.createCancel[lang]}
        </button>
      </div>
    </form>
  );
}
