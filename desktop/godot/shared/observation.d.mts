export function validateObservationEnvelope(envelope: unknown, options?: {expect?: Record<string, string> | null}): {
  ok: boolean; issues: Array<{code: string; at: string; message: string}>;
};
export const TARGET_FEEDBACK_OBSERVATION_FORMAT: 'craftmine.target-feedback-observation/1';
export const TARGET_FEEDBACK_OBSERVATION_LIMIT: 256;
export type TargetFeedbackObservation = {
  format: typeof TARGET_FEEDBACK_OBSERVATION_FORMAT;
  targets: Array<{targetId: string; hitFlashMilliseconds: number}>;
  error?: 'TARGET_FEEDBACK_SCRIPT_UNAVAILABLE' | 'TARGET_FEEDBACK_TOO_MANY_TARGETS' | 'TARGET_FEEDBACK_INVALID_ID' | 'TARGET_FEEDBACK_DUPLICATE_ID' | 'TARGET_FEEDBACK_INVALID_DURATION';
};
export function validateTargetFeedbackObservation(value: unknown): {
  ok: boolean; issues: Array<{code: string; at: string; message: string}>;
};
