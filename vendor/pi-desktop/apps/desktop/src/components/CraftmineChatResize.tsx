import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CRAFTMINE_CHAT_DEFAULT_WIDTH, CRAFTMINE_CHAT_MAX_WIDTH, CRAFTMINE_CHAT_MIN_WIDTH, clampCraftmineChatWidth, rememberCraftmineChatWidth } from "../lib/craftmine-layout";

/** Resize the conversation independently of retained PI resource-panel widths. */
export function CraftmineChatResize({ width }: { width: number }) {
  const { i18n } = useTranslation();
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const update = (value: number) => {
    rememberCraftmineChatWidth(localStorage, clampCraftmineChatWidth(value));
    window.dispatchEvent(new CustomEvent("craftmine-layout-changed"));
  };
  useEffect(() => {
    if (resizing) document.documentElement.setAttribute("data-work-panel-resizing", "true");
    return () => document.documentElement.removeAttribute("data-work-panel-resizing");
  }, [resizing]);
  return <div className="craftmine-chat-resize no-drag" role="separator" aria-orientation="vertical"
    aria-label={i18n.language.startsWith("zh") ? "调整对话宽度" : "Resize conversation"}
    title={i18n.language.startsWith("zh") ? "拖动调整，双击恢复默认" : "Drag to resize; double-click to reset"}
    aria-valuemin={CRAFTMINE_CHAT_MIN_WIDTH} aria-valuemax={CRAFTMINE_CHAT_MAX_WIDTH} aria-valuenow={width} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      drag.current = { id: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    }}
    onPointerMove={event => {
      if (drag.current?.id === event.pointerId) update(drag.current.width + drag.current.x - event.clientX);
    }}
    onPointerUp={event => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      setResizing(false);
    }}
    onLostPointerCapture={() => { if (drag.current) update(drag.current.width); drag.current = null; setResizing(false); }}
    onPointerCancel={() => { if (drag.current) update(drag.current.width); drag.current = null; setResizing(false); }}
    onDoubleClick={() => update(CRAFTMINE_CHAT_DEFAULT_WIDTH)}
    onKeyDown={event => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        const previous = drag.current; drag.current = null;
        update(previous.width); setResizing(false);
        if (event.currentTarget.hasPointerCapture(previous.id)) event.currentTarget.releasePointerCapture(previous.id);
        return;
      }
      const value = event.key === "ArrowLeft" ? width + 20 : event.key === "ArrowRight" ? width - 20 : event.key === "Home" ? CRAFTMINE_CHAT_MIN_WIDTH : event.key === "End" ? CRAFTMINE_CHAT_MAX_WIDTH : undefined;
      if (value === undefined) return;
      event.preventDefault(); update(value);
    }} />;
}
