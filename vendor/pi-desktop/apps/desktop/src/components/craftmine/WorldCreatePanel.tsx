import { useState } from "react";
import {
  CRAFTMINE_WORLD_TITLE_MAX,
  normalizeWorldTitle,
  validateWorldTitle,
  type CraftmineLang,
} from "../../lib/craftmine-worlds";
import { CRAFTMINE_WORLD_TEXT } from "../../lib/craftmine-worlds-text";
import type { CraftmineWorldsController } from "../../hooks/use-craftmine-worlds";

/**
 * Create flow: base, start point, name. Only options the host reports as
 * delivered are selectable; planned or unreported choices stay visible but
 * disabled so the screen never promises an unavailable base.
 */
export function WorldCreatePanel({
  controller,
  lang,
  onClose,
}: {
  controller: CraftmineWorldsController;
  lang: CraftmineLang;
  onClose: () => void;
}) {
  const bases = controller.capabilities?.bases ?? [];
  const starters = controller.capabilities?.starters ?? [];
  const [baseId, setBaseId] = useState(() => bases.find((base) => base.delivered)?.id ?? "");
  const [starterId, setStarterId] = useState("");
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    const invalid = validateWorldTitle(title, lang);
    if (invalid) {
      setLocalError(invalid);
      return;
    }
    setLocalError(null);
    // Resolve the selection against the current capabilities: a base that
    // arrived late, was removed, or is not delivered must never be sent.
    const chosenBase = bases.find((base) => base.id === baseId && base.delivered)?.id
      ?? bases.find((base) => base.delivered)?.id
      ?? "";
    const chosenStarter = starters.find((starter) => starter.id === starterId && starter.delivered)?.id ?? "";
    const created = await controller.create({
      title: normalizeWorldTitle(title),
      ...(chosenBase ? { baseId: chosenBase } : {}),
      ...(chosenStarter ? { starterId: chosenStarter } : {}),
    });
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
            <label key={base.id} className="craftmine-world-choice" data-world-base-option={base.id}>
              <input
                type="radio"
                name="craftmine-world-base"
                value={base.id}
                checked={baseId === base.id}
                disabled={!base.delivered}
                onChange={() => setBaseId(base.id)}
              />
              <span>{base.label}</span>
              {!base.delivered && <span className="craftmine-world-tag">{CRAFTMINE_WORLD_TEXT.planned[lang]}</span>}
            </label>
          ))
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
        {starters.map((starter) => (
          <label key={starter.id} className="craftmine-world-choice" data-world-starter-option={starter.id}>
            <input
              type="radio"
              name="craftmine-world-starter"
              value={starter.id}
              checked={starterId === starter.id}
              disabled={!starter.delivered}
              onChange={() => setStarterId(starter.id)}
            />
            <span>{starter.label}</span>
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

      {localError && <p className="craftmine-world-error" role="alert">{localError}</p>}

      <div className="craftmine-world-create-actions">
        <button type="submit" data-world-create="submit" disabled={controller.busy}>
          {controller.busy ? CRAFTMINE_WORLD_TEXT.creating[lang] : CRAFTMINE_WORLD_TEXT.createSubmit[lang]}
        </button>
        <button type="button" onClick={onClose} disabled={controller.busy}>
          {CRAFTMINE_WORLD_TEXT.createCancel[lang]}
        </button>
      </div>
    </form>
  );
}