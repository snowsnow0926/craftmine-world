import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, X, RefreshCw } from "lucide-react";
import { VOICE_INPUT_CHANNELS, normalizeVoiceCapability, resolveVoiceLocale, type VoiceCapability, type VoiceTranscriptionResult } from "../../../../packages/shared/src/voice-input";
import { captureVoice } from "../lib/voice-capture";
import { VoiceInputController, type VoiceAdapter, type VoiceState } from "../lib/voice-input-controller";
import "./VoiceInput.css";

export type VoiceInputLabels = {
  hold: string; starting: string; recording: string; transcribing: string; cancel: string;
  unavailable: string; permission: string; microphone: string; empty: string; transcription: string; local: string;
};
const english: VoiceInputLabels = {
  hold: "Hold to talk", starting: "Opening microphone…", recording: "Recording · release to transcribe",
  transcribing: "Transcribing locally…", cancel: "Cancel voice input", unavailable: "Local speech recognition unavailable",
  permission: "Microphone permission denied", microphone: "Microphone unavailable", empty: "No speech recognized",
  transcription: "Could not transcribe. Try again.", local: "Local voice input · 30 seconds maximum",
};
const chinese: VoiceInputLabels = {
  hold: "按住说话", starting: "正在打开麦克风…", recording: "正在录音 · 松开转文字",
  transcribing: "正在本地转文字…", cancel: "取消语音输入", unavailable: "本地语音识别不可用",
  permission: "麦克风权限被拒绝", microphone: "麦克风不可用", empty: "未识别到语音",
  transcription: "转文字失败，请重试", local: "本地语音输入 · 最长 30 秒",
};

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.piDesktop) throw new Error("Desktop bridge unavailable");
  const result = await window.piDesktop.invoke<T>(channel, payload);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
const desktopAdapter: VoiceAdapter = {
  async arm(requestId, contextKey) {
    if (!(await invoke<boolean>(VOICE_INPUT_CHANNELS.arm, { requestId, contextKey }))) {
      const error = new Error("Voice input unavailable"); error.name = "VoiceUnavailableError"; throw error;
    }
  },
  capture: captureVoice,
  transcribe: (input) => invoke<VoiceTranscriptionResult>(VOICE_INPUT_CHANNELS.transcribe, input),
  cancel: async (requestId) => { await invoke(VOICE_INPUT_CHANNELS.cancel, { requestId }); },
};

export type VoiceInputProps = {
  contextKey: string;
  disabled?: boolean;
  onTranscript(text: string): void;
  labels?: VoiceInputLabels;
  adapter?: VoiceAdapter;
};

/** Only appends through onTranscript. The composer remains the sole submission owner. */
export function VoiceInput({ contextKey, disabled = false, onTranscript, labels, adapter = desktopAdapter }: VoiceInputProps) {
  const { i18n } = useTranslation();
  const copy = labels ?? (i18n.language.startsWith("zh") ? chinese : english);
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const [capability, setCapability] = useState<VoiceCapability>();
  const [selectedLocale, setSelectedLocale] = useState("");
  const [discovery, setDiscovery] = useState(0);
  const callback = useRef(onTranscript);
  const key = useRef(contextKey);
  callback.current = onTranscript;
  key.current = contextKey;
  const controller = useMemo(() => new VoiceInputController(adapter, setState, (text) => callback.current(text)), [adapter]);
  const preferredLocale = i18n.language || "en";
  const locale = capability ? resolveVoiceLocale(selectedLocale || preferredLocale, capability.locales) : null;
  const chineseUi = i18n.language.startsWith("zh");

  useEffect(() => {
    let disposed = false;
    setCapability(undefined);
    if (adapter !== desktopAdapter) { setCapability({ available: true, provider: "windows-local", locales: [preferredLocale] }); return; }
    void invoke<VoiceCapability>(VOICE_INPUT_CHANNELS.capability, { refresh: discovery > 0 }).then((value) => { if (!disposed) setCapability(normalizeVoiceCapability(value)); })
      .catch(() => { if (!disposed) setCapability({ available: false, provider: "windows-local", locales: [] }); });
    return () => { disposed = true; };
  }, [adapter, discovery, preferredLocale]);
  useLayoutEffect(() => {
    controller.cancel();
    return () => controller.cancel();
  }, [controller, contextKey, disabled, locale]);
  useEffect(() => {
    const cancel = () => controller.cancel();
    const hidden = () => { if (document.hidden) cancel(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !controller.active) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); document.removeEventListener("visibilitychange", hidden); };
  }, [controller]);
  const active = ["starting", "recording", "transcribing"].includes(state.phase);
  const status = state.phase === "error" ? copy[state.error ?? "transcription"]
    : active ? copy[state.phase as "starting" | "recording" | "transcribing"] : state.locale ? `${chineseUi ? "已转写" : "Transcribed"} · ${state.locale}` : "";
  const unavailable = capability !== undefined && (!capability.available || !locale);
  const missing = capability?.reason === "platform" ? (chineseUi ? "此平台不支持本地语音，请打字输入" : "Local speech is unsupported on this platform. Type instead.")
    : chineseUi ? `未安装 ${selectedLocale || preferredLocale} 识别器。请在 Windows 语言设置中安装对应语音功能后重检，或选择已安装语言、打字输入。`
    : `No ${selectedLocale || preferredLocale} recognizer. Install its Windows speech feature and recheck, choose an installed language, or type.`;
  const start = () => { if (!disabled && capability?.available && locale) void controller.start(key.current, locale); };
  return <span className="voice-input" data-voice-state={state.phase}>
    <button type="button" className="voice-input-button" disabled={disabled || !capability?.available || !locale || state.phase === "transcribing"}
      aria-label={unavailable ? copy.unavailable : copy.hold} aria-pressed={state.phase === "recording"}
      title={unavailable ? missing : `${copy.local}${locale ? ` · ${locale}` : ""}`}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start(); }}
      onPointerUp={() => void controller.release()} onPointerCancel={() => controller.cancel()}
      onLostPointerCapture={() => { if (state.phase === "starting" || state.phase === "recording") void controller.release(); }}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (!event.repeat) start(); } }}
      onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void controller.release(); } }}
      onBlur={() => { if (state.phase !== "transcribing") controller.cancel(); }}>
      <Mic size={16} aria-hidden="true" />
    </button>
    <select className="voice-input-language" aria-label={chineseUi ? "识别语言" : "Speech language"} disabled={active || !capability?.locales.length}
      value={locale ?? ""} onChange={event => setSelectedLocale(event.currentTarget.value)}>
      {!locale && <option value="">{capability ? (chineseUi ? "语言不可用" : "Language unavailable") : (chineseUi ? "检测中" : "Detecting")}</option>}
      {capability?.locales.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
    <button type="button" className="voice-input-button" disabled={active || !capability} title={chineseUi ? "重新检测语音语言" : "Recheck speech languages"}
      aria-label={chineseUi ? "重新检测语音语言" : "Recheck speech languages"} onClick={() => { controller.cancel(); setDiscovery(value => value + 1); }}><RefreshCw size={13} aria-hidden="true" /></button>
    {active ? <button type="button" className="voice-input-button" onClick={() => controller.cancel()} title={copy.cancel} aria-label={copy.cancel}><X size={14} aria-hidden="true" /></button> : null}
    {status ? <span className="voice-input-status" role="status" aria-live="polite">{status}</span> : null}
    {unavailable && !status ? <span className="voice-input-help" role="status">{missing}</span> : null}
  </span>;
}
