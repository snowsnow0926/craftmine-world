// Part of the immutable released Pom/rain v1 package manifests. A newer host
// bridge must get a new package version, not rewrite this known requirement.
export const RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256 = '593ade6619c31f44ab3c86790a79ea8ebc0fbd0ac6b9a5ffee212ad5f8849270';

// Fixed after the native placement-preview bridge regression. This adds an
// exact source cohort; receiving-world gameplay still requires normal checks.
export const PLACEMENT_PREVIEW_BRIDGE_HASHES = [
  '938c42a578bb37c0590198232448b1391f688b95f15ce7d5fce65d802cca7e08',
  'aaf17d885bfd63125ae850b5d80c40461157c7d7fe074d0433f8653c484d686c',
];
export function componentBridgeProfiles(released, version) {
  if (version === 1) return released;
  if (version !== 2) throw Error('COMPONENT_VERSION_UNSUPPORTED');
  const engine = released.find(profile => profile.id === 'creation-player-collision/1+engine-monitor/1');
  if (!engine || engine.requirements.filter(item => item.path === 'craftmine_shared/runtime_bridge.gd' && item.sha256 === RELEASED_COMPONENT_ENGINE_BRIDGE_SHA256).length !== 1) throw Error('RELEASED_COMPONENT_BRIDGE_PROFILE_REQUIRED');
  return [...released, ...PLACEMENT_PREVIEW_BRIDGE_HASHES.map((sha256, index) => ({
    id: 'creation-player-collision/1+engine-monitor/1+placement-preview/1-' + (index ? 'crlf' : 'lf'),
    requirements: engine.requirements.map(item => item.path === 'craftmine_shared/runtime_bridge.gd' ? {...item, sha256} : {...item}),
  }))];
}
