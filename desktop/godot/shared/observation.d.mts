export function validateObservationEnvelope(envelope: unknown, options?: {expect?: Record<string, string> | null}): {
  ok: boolean; issues: Array<{code: string; at: string; message: string}>;
};
