export type VoiceTrustedDocument = { ownerId: number; documentUrl: string };
export type VoicePermissionDetails = { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: unknown };
type VoiceArm = VoiceTrustedDocument & { requestId: string; contextKey: string; expiresAt: number };

/** A gesture arms one audio request for one exact trusted main document. */
export class VoiceMicrophonePermissionGate {
  private pending?: VoiceArm;
  private trustedDocument: () => VoiceTrustedDocument | undefined;
  private now: () => number;
  constructor(trustedDocument: () => VoiceTrustedDocument | undefined, now = () => performance.now()) {
    this.trustedDocument = trustedDocument;
    this.now = now;
  }

  arm(ownerId: number, documentUrl: string, isMainFrame: boolean, value: unknown): boolean {
    const trusted = this.trustedDocument();
    if (!trusted || trusted.ownerId !== ownerId || trusted.documentUrl !== documentUrl || !isMainFrame) return false;
    if (!value || typeof value !== "object") return false;
    const input = value as { requestId?: unknown; contextKey?: unknown };
    if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)
      || typeof input.contextKey !== "string" || input.contextKey.length < 1 || input.contextKey.length > 4096) return false;
    this.pending = { ...trusted, requestId: input.requestId, contextKey: input.contextKey, expiresAt: this.now() + 10_000 };
    return true;
  }

  /** Do not grant standing microphone permission, even while a gesture is armed. */
  check(): false { return false; }

  request(ownerId: number | undefined, permission: string, details: VoicePermissionDetails): boolean {
    const pending = this.pending;
    const trusted = this.trustedDocument();
    if (!pending) return false;
    if (pending.expiresAt <= this.now() || !trusted || trusted.ownerId !== pending.ownerId || trusted.documentUrl !== pending.documentUrl) {
      this.pending = undefined; return false;
    }
    if (ownerId !== pending.ownerId || permission !== "media" || details.isMainFrame !== true
      || details.requestingUrl !== pending.documentUrl || !Array.isArray(details.mediaTypes)
      || details.mediaTypes.length !== 1 || details.mediaTypes[0] !== "audio") return false;
    this.pending = undefined;
    return true;
  }

  cancel(ownerId: number, requestId?: string) {
    if (this.pending?.ownerId === ownerId && (!requestId || this.pending.requestId === requestId)) this.pending = undefined;
  }

  dispose() { this.pending = undefined; }
}
