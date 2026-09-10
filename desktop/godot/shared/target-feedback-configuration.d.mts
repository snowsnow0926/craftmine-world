export type TargetFeedbackConfiguration = {
  format: 'craftmine.interfaces.configuration/1';
  contractId: 'fp.target.feedback/1';
  baseId: 'first-person';
  baseVersion: '0.1.0';
  scope: 'instance';
  identityField: 'target_id';
  parameters: Array<{id: 'hitFlashMilliseconds'; label: string; type: 'integer'; unit: string; default: number; minimum: number; maximum: number}>;
  preview: 'checked-candidate';
  requiredChecks: string[];
};
export function targetFeedbackConfiguration(): TargetFeedbackConfiguration;
export function validateTargetFeedbackConfiguration(value: unknown): TargetFeedbackConfiguration;

export type TargetFeedbackDefaults = {
 format: 'craftmine.target-feedback-default/1';
 values: {hitFlashMilliseconds: number};
 source: {kind: 'packed-scene'|'balance-profile'|'balance-profile-script'|'target-script'; path: string; sha256: string};
};
export function validateTargetFeedbackDefaults(value: unknown): TargetFeedbackDefaults;
