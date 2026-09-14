import type {
  ContextCompactionMark,
  MessageUsage,
  ModelInfo,
  ProviderPublic,
  UiMessage,
} from "@pi-desktop/shared";
import {
  assistantTurnResponseDuration,
  assistantTurnResponseOutputIsEstimated,
  assistantTurnResponseOutputTokens,
  assistantTurnTools,
  assistantTurnUsage,
  buildTranscriptEntries,
  type AssistantTurnEntry,
} from "./assistant-turns";
import { latestMessageUsage, resolveContextWindow } from "./context-usage";
import {codexContextCapacityMarker} from './codex-usage-coverage';

export type LatestTurnContextInspector = {
  usageProviderId?: string;
  usageModelId?: string;
  usage: MessageUsage;
  turnUsage: MessageUsage;
  contextWindow: number;
  tools: UiMessage[];
  responseDurationMs?: number;
  responseOutputTokens?: number;
  responseOutputEstimated: boolean;
};

/**
 * The composer inspector always mirrors the newest assistant turn that
 * reported usage, so a later streaming turn without totals does not steal
 * the previous ring's tools or throughput.
 */
export function latestTurnContextInspector(
  messages: UiMessage[],
  providerModels: Record<string, ModelInfo[]>,
  providers: ProviderPublic[],
  compactions: readonly ContextCompactionMark[] = [],
): LatestTurnContextInspector | undefined {
  // Delegate rows carry their own usage; remaining capacity is a parent-session
  // number, so those snapshots must not steal the composer ring.
  const parentMessages = messages.filter((message) => !message.parentToolCallId);
  const latestUsage = latestMessageUsage(parentMessages);
  if (!latestUsage) return undefined;

  const turns = buildTranscriptEntries(messages, compactions).entries.filter(
    (entry): entry is AssistantTurnEntry => entry.kind === "assistant-turn",
  );
  const latestTurn =
    [...turns].reverse().find((turn) => assistantTurnUsage(turn)) ??
    turns.at(-1);
  const latestUsageMessage = [...parentMessages]
    .reverse()
    .find((message) => message.usage);
  const codex = latestUsageMessage?.providerId === "codex-cli";
  const codexUsage = latestUsageMessage?.codexUsage;
  if(codex&&codexContextCapacityMarker(codexUsage?.lastRequest,codexUsage?.modelContextWindow))return undefined;
  // A turn aggregate cannot stand in for prompt occupancy, and a provider's
  // generic 128k fallback is not the local CLI's actual context window.
  if (codex && (!codexUsage?.lastRequest || !codexUsage.modelContextWindow)) return undefined;

  return {
    usageProviderId: latestUsageMessage?.providerId,
    usageModelId: latestUsageMessage?.modelId,
    usage: codex ? codexUsage!.lastRequest! : latestUsage,
    turnUsage:
      (latestTurn ? assistantTurnUsage(latestTurn) : undefined) ?? latestUsage,
    contextWindow: codex ? codexUsage!.modelContextWindow! : resolveContextWindow(
      latestUsageMessage?.providerId,
      latestUsageMessage?.modelId,
      providerModels,
      providers,
    ),
    tools: latestTurn ? assistantTurnTools(latestTurn) : [],
    responseDurationMs: latestTurn
      ? assistantTurnResponseDuration(latestTurn)
      : undefined,
    responseOutputTokens: latestTurn
      ? assistantTurnResponseOutputTokens(latestTurn)
      : undefined,
    responseOutputEstimated: latestTurn
      ? assistantTurnResponseOutputIsEstimated(latestTurn)
      : false,
  };
}
