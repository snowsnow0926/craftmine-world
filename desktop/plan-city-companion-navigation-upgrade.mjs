import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const cityNavigationRepairPins = Object.freeze({
  'scripts/pet_companion.gd': 'dea83bab172b60bb5d146bf46d207484e874d6fb29aa9603493129d2e2f7f19c',
  'scripts/orgrimmar_world.gd': 'ec672a201d877cd251daf28e8796a05350cb1134be34aceb478c94555fbd6a6e',
  'scripts/orgrimmar_runtime.gd': '0bdd6f163d8f28452c53e2377ce36efba58b41f2d44c16156d631af230ee1c00',
  'scenes/creation.tscn': 'ac97e7fb90e0e8d3f2a19c48295ecf0ef9212f2bb7d75d3a63e6c6e51ec2c925',
});

/** A read-only developer repair plan for the retained failed demo source.
 * The caller must apply through ordinary source CAS, check and adoption. */
export function planCityCompanionNavigationUpgrade({repository, files}) {
  if (!Array.isArray(files) || files.length !== Object.keys(cityNavigationRepairPins).length)
    throw Error('CITY_NAVIGATION_SOURCE_INVALID');
  for (const [name, expected] of Object.entries(cityNavigationRepairPins)) {
    const matches = files.filter(file => file.path === name);
    if (matches.length !== 1 || typeof matches[0].text !== 'string' || sha(matches[0].text) !== expected)
      throw Error('CITY_NAVIGATION_SOURCE_CHANGED:' + name);
  }
  return {
    format: 'craftmine.city-navigation-repair-plan/1',
    operations: [{op: 'put', path: 'scripts/pet_companion.gd', expectedHash: cityNavigationRepairPins['scripts/pet_companion.gd'],
      text: fs.readFileSync(path.join(repository, 'desktop/godot/repairs/city-pomeranian-navigation-v1.gd'), 'utf8').replace(/\r\n/g, '\n')}],
    progressMutation: false, identityPreserved: true,
    nextAction: 'ordinary-source-patch-check-adopt',
    note: 'Source-local city repair. Do not overwrite released packages. Verify actual movement and persistence before publishing a new template.',
  };
}
