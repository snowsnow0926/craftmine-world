// Candidate list records historically exposed both `id` and `candidateId`.
// The coordinator contract is explicitly candidateId, so keep the UI bound to
// that identity while accepting old records during migration.
export function candidateIdentity(candidate) {
  const value = candidate?.candidateId ?? candidate?.id;
  if (typeof value !== 'string' || value.length === 0) throw Error('INVALID_GODOT_CANDIDATE_ID');
  return value;
}
