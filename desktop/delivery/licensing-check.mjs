#!/usr/bin/env node
// Read-only licence inventory check.
//
// Validates licensing/inventory.json, then (optionally) scans a real package or
// export directory and requires every shipped third-party component to have a
// notice entry and its licence text at a path the offline entry names.
//
// It never modifies the inspected tree. Pending-rights-review entries are reported
// as pending and are never a pass. Exit codes: 0 pass, 1 fail, 3 pending-only,
// 2 usage or I/O error.
//
// Usage:
//   node desktop/delivery/licensing-check.mjs --inventory licensing/inventory.json \
//     [--package <dir>] [--export <dir>] [--json] [--evidence <file>] \
//     [--offline-entry <file>] [--notices <file>] [--root <repo root>] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const INVENTORY_FORMAT = 'craftmine.license-inventory/1';
const OFFLINE_FORMAT = 'craftmine.offline-license-entry/1';
const ORIGINS = ['upstream', 'project-authored', 'generated', 'third-party', 'user-content', 'unknown'];
const STATUSES = ['verified', 'pending-rights-review', 'unknown-rightsholder'];
const CHANNELS = ['app-bundle', 'user-export', 'development-only'];
const SHIPPED_CHANNELS = ['app-bundle', 'user-export'];
const USER_ORIGIN = 'user-content';
const MAX_SCAN_ENTRIES = 200000;

const USAGE = `craftmine licensing check (read-only)

Usage: node desktop/delivery/licensing-check.mjs --inventory <file> [options]

Options
  --inventory <file>      licensing/inventory.json to validate (required)
  --package <dir>         win-unpacked client package to scan
  --export <dir>          exported game directory to scan
  --offline-entry <file>  offline-entry.json (default: next to the inventory)
  --notices <file>        notice document expected in a package (default: next to the inventory)
  --root <dir>            repository root used to resolve evidence paths (default: derived)
  --json                  print the machine-readable record
  --evidence <file>       write the record to this path (must be outside the scanned trees)
  --quiet                 print only failures and pending entries

Exit codes: 0 pass, 1 fail, 3 pending-only, 2 usage or I/O error.`;

const argumentsList = process.argv.slice(2);
const option = name => {
  const index = argumentsList.indexOf('--' + name);
  return index === -1 ? null : argumentsList[index + 1];
};
const flag = name => argumentsList.includes('--' + name);

if (flag('help') || argumentsList.includes('help')) {
  console.log(USAGE);
  process.exit(0);
}

const inventoryArgument = option('inventory');
if (!inventoryArgument) {
  console.error('--inventory <file> is required\n\n' + USAGE);
  process.exit(2);
}
const inventoryPath = path.resolve(inventoryArgument);
if (!fs.existsSync(inventoryPath)) {
  console.error('Inventory is absent: ' + inventoryPath);
  process.exit(2);
}
const inventoryDirectory = path.dirname(inventoryPath);
const offlinePath = path.resolve(option('offline-entry') ?? path.join(inventoryDirectory, 'offline-entry.json'));
const noticesPath = path.resolve(option('notices') ?? path.join(inventoryDirectory, 'notices/CRAFTMINE-NOTICES.md'));
const repoRoot = path.resolve(option('root') ?? path.resolve(inventoryDirectory, '..', '..', '..'));
const packageDirectory = option('package') ? path.resolve(option('package')) : null;
const exportDirectory = option('export') ? path.resolve(option('export')) : null;

const failures = [];
const pending = [];
const fail = (code, message, entryId = null) => failures.push({code, entryId, message});
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0;

// ---------------------------------------------------------------- schema checks
function validateInventory(inventory) {
  if (inventory.format !== INVENTORY_FORMAT) fail('INVENTORY_FORMAT', 'Unsupported inventory format: ' + inventory.format);
  if (!Array.isArray(inventory.entries) || !inventory.entries.length) {
    fail('INVENTORY_EMPTY', 'Inventory has no entries');
    return [];
  }
  const ids = new Set();
  for (const entry of inventory.entries) {
    const label = entry && typeof entry.id === 'string' ? entry.id : '<entry without id>';
    if (!entry || typeof entry !== 'object') { fail('INVENTORY_ENTRY_TYPE', 'Entry is not an object'); continue; }
    if (!isNonEmptyString(entry.id)) fail('INVENTORY_ENTRY_ID', label + ' has no id');
    else if (ids.has(entry.id)) fail('INVENTORY_ENTRY_DUPLICATE', 'Duplicate entry id: ' + entry.id);
    else ids.add(entry.id);
    if (!isNonEmptyString(entry.module)) fail('INVENTORY_ENTRY_MODULE', label + ' has no module');
    if (!Array.isArray(entry.paths) || !entry.paths.length || !entry.paths.every(isNonEmptyString)) fail('INVENTORY_ENTRY_PATHS', label + ' must declare a non-empty paths array of strings');
    if (!ORIGINS.includes(entry.origin)) fail('INVENTORY_ENTRY_ORIGIN', label + ' has an unknown origin: ' + entry.origin);
    if (!isNonEmptyString(entry.rightsHolder)) fail('INVENTORY_ENTRY_RIGHTS_HOLDER', label + ' has no rightsHolder');
    if (!isNonEmptyString(entry.observedLicense)) fail('INVENTORY_ENTRY_OBSERVED_LICENSE', label + ' has no observedLicense');
    if (!isNonEmptyString(entry.targetLicense)) fail('INVENTORY_ENTRY_TARGET_LICENSE', label + ' has no targetLicense');
    if (entry.licenseFile !== null && !isNonEmptyString(entry.licenseFile)) fail('INVENTORY_ENTRY_LICENSE_FILE', label + ' licenseFile must be a string or null');
    if (!Array.isArray(entry.deliveryChannels) || !entry.deliveryChannels.length) fail('INVENTORY_ENTRY_CHANNELS', label + ' declares no deliveryChannels');
    else for (const channel of entry.deliveryChannels) if (!CHANNELS.includes(channel)) fail('INVENTORY_ENTRY_CHANNEL', label + ' has an unknown delivery channel: ' + channel);
    if (!Array.isArray(entry.dependencies)) fail('INVENTORY_ENTRY_DEPENDENCIES', label + ' must declare a dependencies array');
    if (!Array.isArray(entry.evidence)) fail('INVENTORY_ENTRY_EVIDENCE', label + ' must declare an evidence array');
    else for (const item of entry.evidence) {
      if (!item || !isNonEmptyString(item.path) || !isNonEmptyString(item.note)) fail('INVENTORY_ENTRY_EVIDENCE_ITEM', label + ' evidence items need path and note');
      if (item && item.commit !== null && !isNonEmptyString(item.commit)) fail('INVENTORY_ENTRY_EVIDENCE_COMMIT', label + ' evidence commit must be a string or null');
    }
    if (!STATUSES.includes(entry.status)) fail('INVENTORY_ENTRY_STATUS', label + ' has an unknown status: ' + entry.status);
    if (!Array.isArray(entry.openQuestions) || !entry.openQuestions.every(value => typeof value === 'string')) fail('INVENTORY_ENTRY_OPEN_QUESTIONS', label + ' must declare an openQuestions array of strings');
    if (entry.licenseTextIds !== undefined && !Array.isArray(entry.licenseTextIds)) fail('INVENTORY_ENTRY_LICENSE_TEXT_IDS', label + ' licenseTextIds must be an array');
    if (entry.packageProbe !== undefined && !Array.isArray(entry.packageProbe)) fail('INVENTORY_ENTRY_PACKAGE_PROBE', label + ' packageProbe must be an array');
  }
  return inventory.entries;
}

function validateOfflineEntry(offline) {
  if (!offline || offline.format !== OFFLINE_FORMAT) {
    fail('OFFLINE_ENTRY_FORMAT', 'Unsupported offline entry format: ' + (offline && offline.format));
    return;
  }
  for (const scope of ['package', 'export']) {
    const section = offline[scope];
    if (!section || !isNonEmptyString(section.root)) { fail('OFFLINE_ENTRY_SCOPE', 'offline entry has no ' + scope + ' root'); continue; }
    if (!Array.isArray(section.required) || !section.required.length) { fail('OFFLINE_ENTRY_REQUIRED', 'offline entry ' + scope + ' declares no required texts'); continue; }
    const ids = new Set();
    for (const item of section.required) {
      if (!item || !isNonEmptyString(item.id) || !isNonEmptyString(item.file)) { fail('OFFLINE_ENTRY_ITEM', scope + ' entry needs id and file'); continue; }
      if (ids.has(item.id)) fail('OFFLINE_ENTRY_DUPLICATE', scope + ' duplicate text id: ' + item.id);
      ids.add(item.id);
      if (path.isAbsolute(item.file) || item.file.split(/[\\/]/).includes('..')) fail('OFFLINE_ENTRY_PATH_ESCAPE', scope + ' ' + item.id + ' path must be relative and must not escape the root: ' + item.file);
      if (item.repoText && (path.isAbsolute(item.repoText) || item.repoText.split(/[\\/]/).includes('..'))) fail('OFFLINE_ENTRY_REPO_PATH', scope + ' ' + item.id + ' repoText must be a repository-relative path');
      if (item.repoText && !fs.existsSync(path.join(repoRoot, item.repoText))) fail('OFFLINE_ENTRY_REPO_TEXT_MISSING', scope + ' ' + item.id + ' repoText is absent: ' + item.repoText);
    }
  }
}

// ---------------------------------------------------------------- tree scanning
function scanTree(directory) {
  const index = {root: directory, files: new Set(), links: [], missing: !fs.existsSync(directory), truncated: false};
  if (index.missing) return index;
  const stack = [{directory, depth: 0}];
  let entries = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.depth > 64 || ++entries > MAX_SCAN_ENTRIES) { index.truncated = true; break; }
    for (const name of fs.readdirSync(current.directory)) {
      const target = path.join(current.directory, name);
      const info = fs.lstatSync(target);
      if (info.isSymbolicLink()) { index.links.push(path.relative(directory, target).replaceAll('\\', '/')); continue; }
      if (info.isDirectory()) stack.push({directory: target, depth: current.depth + 1});
      else if (info.isFile()) index.files.add(path.relative(directory, target).replaceAll('\\', '/'));
    }
  }
  return index;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp('^' + escaped + '$');
}

function matchesProbe(index, patterns) {
  for (const pattern of patterns ?? []) {
    const matcher = globToRegExp(pattern);
    for (const file of index.files) if (matcher.test(file)) return file;
  }
  return null;
}

function resolveEvidencePath(relative) {
  const cleaned = String(relative).replace(/\s*\(.*\)\s*$/, '').trim();
  const absolute = path.resolve(repoRoot, cleaned);
  if (!absolute.startsWith(path.resolve(repoRoot) + path.sep)) return {escaped: true, absolute, cleaned};
  return {escaped: false, absolute, cleaned, directory: cleaned.endsWith('/**')};
}

// ---------------------------------------------------------------- entry checks
function checkEntries(entries, offline, scans) {
  const results = [];
  for (const entry of entries) {
    const reasons = [];
    const shippedByInventory = Array.isArray(entry.deliveryChannels) && entry.deliveryChannels.some(channel => SHIPPED_CHANNELS.includes(channel)) && entry.origin !== USER_ORIGIN;
    const unknownRights = entry.origin === 'unknown' || entry.status === 'unknown-rightsholder' || /unknown/i.test(String(entry.rightsHolder ?? ''));
    if (shippedByInventory && unknownRights) fail('UNKNOWN_RIGHTS_SHIPPED', 'Shipped entry has unknown rights: ' + entry.id + ' (origin=' + entry.origin + ', status=' + entry.status + ')', entry.id);
    if (shippedByInventory && (!Array.isArray(entry.evidence) || !entry.evidence.length)) fail('SHIPPED_COMPONENT_WITHOUT_EVIDENCE', 'Shipped entry has no evidence: ' + entry.id, entry.id);
    for (const item of entry.evidence ?? []) {
      const resolved = resolveEvidencePath(item.path);
      if (resolved.escaped) fail('EVIDENCE_PATH_ESCAPE', entry.id + ' evidence path escapes the repository root: ' + item.path, entry.id);
      else if (!fs.existsSync(resolved.absolute)) fail('EVIDENCE_PATH_MISSING', entry.id + ' evidence path is absent: ' + item.path, entry.id);
    }

    let verdict = entry.status === 'verified' ? 'verified' : 'pending';
    if (entry.status === 'unknown-rightsholder') verdict = 'pending';

    for (const scope of ['package', 'export']) {
      const scan = scans[scope];
      if (!scan || scan.missing) continue;
      const probe = matchesProbe(scan.index, entry.packageProbe);
      if (!probe) continue;
      const section = offline?.[scope];
      const root = section ? path.join(scan.index.root, section.root) : scan.index.root;
      const presentInTree = scope === 'package' ? shippedByInventory : entry.deliveryChannels.includes('user-export');
      if (!presentInTree) continue;

      // Notice entry must mention the component.
      if (entry.origin === 'third-party') {
        const documentName = section?.entryDocument;
        const documentPath = documentName ? path.join(root, documentName) : null;
        if (!documentPath || !fs.existsSync(documentPath)) {
          fail('NOTICE_DOCUMENT_MISSING', scope + ' notice document is absent: ' + (documentName ?? '<unnamed>') + ' under ' + section?.root, entry.id);
          reasons.push('notice document missing');
        } else {
          const text = fs.readFileSync(documentPath, 'utf8');
          const key = String(entry.noticeKey ?? entry.id);
          if (!new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
            fail('NOTICE_ENTRY_MISSING', scope + ' notice document does not mention ' + key + ' (entry ' + entry.id + ')', entry.id);
            reasons.push('notice entry missing');
          }
        }
      }

      // Licence texts named by the offline entry must exist where it says.
      const engineBundled = [...scan.index.files].some(file => /^godot.*\.exe$/i.test(path.basename(file)) || file.toLowerCase().includes('licenses/godot/'));
      for (const textId of entry.licenseTextIds ?? []) {
        const mapping = (section?.required ?? []).find(item => item.id === textId);
        if (!mapping) {
          fail('MISSING_LICENCE_TEXT_MAPPING', entry.id + ' names licence text ' + textId + ' but offline-entry.json has no ' + scope + ' mapping', entry.id);
          reasons.push('no offline mapping for ' + textId);
          continue;
        }
        const expected = path.join(root, mapping.file);
        const relativeExpected = section.root + '/' + mapping.file;
        if (mapping.status === 'conditional') {
          if (mapping.condition === 'covered-entries-verified') {
            // A licence text may only be required once the project can actually grant
            // that licence: if every covered entry is still pending, shipping the text
            // would assert an unestablished right. The moment one covered entry becomes
            // verified, the text becomes mandatory.
            const covered = entries.filter(candidate => (mapping.covers ?? []).includes(candidate.id));
            const applied = covered.filter(candidate => candidate.status === 'verified');
            if (applied.length && !fs.existsSync(expected)) {
              fail('LICENCE_TEXT_ABSENT', entry.id + ' requires ' + relativeExpected + ' because covered entry ' + applied[0].id + ' is verified but the text is absent', entry.id);
              reasons.push('absent ' + relativeExpected);
            } else {
              reasons.push('conditional text ' + textId + ' (' + relativeExpected + '): '
                + (applied.length ? 'a covered entry is verified' : 'all ' + covered.length + ' covered entries are still pending-rights-review'));
            }
          } else {
            reasons.push('conditional text ' + textId + ' (' + relativeExpected + ')');
          }
          continue;
        }
        if (mapping.status === 'required-when-engine-bundled' && !engineBundled) {
          reasons.push('engine not bundled: ' + textId + ' not required');
          continue;
        }
        if (mapping.status === 'missing') {
          const code = entry.origin === 'third-party' ? 'MISSING_LICENCE_TEXT' : 'TARGET_LICENCE_TEXT_MISSING';
          fail(code, entry.id + ' needs ' + relativeExpected + ' (offline-entry id ' + textId + '): ' + (mapping.reason ?? 'not present'), entry.id);
          reasons.push('missing ' + relativeExpected);
          continue;
        }
        if (!fs.existsSync(expected)) {
          fail('LICENCE_TEXT_ABSENT', entry.id + ' requires ' + relativeExpected + ' but it is absent', entry.id);
          reasons.push('absent ' + relativeExpected);
        }
      }
      verdict = reasons.some(reason => reason.startsWith('missing') || reason.startsWith('absent') || reason.startsWith('notice')) ? 'fail' : verdict === 'verified' ? 'verified' : 'pending';
    }
    if (entry.status !== 'verified') pending.push({id: entry.id, status: entry.status, verdict, reason: entry.openQuestions?.[0] ?? 'rights review incomplete'});
    results.push({id: entry.id, status: entry.status, verdict, shippedByInventory, reasons});
  }
  return results;
}

function checkPackageInventory(directory) {
  if (!directory) return;
  const inventoryFile = path.join(directory, 'resources/licenses/third-party/npm-inventory.json');
  if (!fs.existsSync(inventoryFile)) return;
  let installed;
  try {
    installed = readJson(inventoryFile);
  } catch (error) {
    fail('PACKAGE_THIRD_PARTY_INVENTORY_INVALID', 'npm inventory is not valid JSON: ' + error.message);
    return;
  }
  const textRoot = path.join(directory, 'resources/licenses/third-party');
  for (const entry of installed.packages ?? []) {
    if (!entry.license) fail('THIRD_PARTY_LICENCE_UNDECLARED', 'Installed package has no declared licence: ' + entry.package);
    const files = entry.licenseFiles ?? [];
    if (!files.length) {
      fail('MISSING_LICENCE_TEXT', 'Installed package has no bundled licence text: ' + entry.package);
      continue;
    }
    for (const file of files) {
      if (!fs.existsSync(path.join(textRoot, file))) fail('LICENCE_TEXT_ABSENT', 'Installed package licence text is absent: ' + entry.package + ' -> resources/licenses/third-party/' + file);
    }
  }
}

function checkOfflineRequirements(offline, scans) {
  if (!offline) return;
  for (const scope of ['package', 'export']) {
    const scan = scans[scope];
    if (!scan || scan.index.missing || !offline[scope]) continue;
    const section = offline[scope];
    const root = path.join(scan.index.root, section.root);
    const engineBundled = [...scan.index.files].some(file => /^godot.*\.exe$/i.test(path.basename(file)) || file.toLowerCase().includes('licenses/godot/'));
    if (section.entryDocument && !fs.existsSync(path.join(root, section.entryDocument))) {
      fail('NOTICE_DOCUMENT_MISSING', scope + ' offline entry document is absent: ' + section.root + '/' + section.entryDocument);
    }
    for (const item of section.required ?? []) {
      if (item.status === 'required' || (item.status === 'required-when-engine-bundled' && engineBundled)) {
        if (!fs.existsSync(path.join(root, item.file))) {
          fail('LICENCE_TEXT_ABSENT', scope + ' offline entry requires ' + section.root + '/' + item.file + ' (id ' + item.id + ') but it is absent');
        }
      }
    }
  }
}

// ---------------------------------------------------------------- run
let inventory;
try {
  inventory = readJson(inventoryPath);
} catch (error) {
  console.error('Inventory is not valid JSON: ' + error.message);
  process.exit(2);
}
let offline = null;
try {
  offline = readJson(offlinePath);
} catch (error) {
  fail('OFFLINE_ENTRY_UNREADABLE', 'offline entry is not readable: ' + offlinePath + ' (' + error.message + ')');
}
const entries = validateInventory(inventory);
if (offline) validateOfflineEntry(offline);

const scans = {
  package: packageDirectory ? {index: scanTree(packageDirectory), directory: packageDirectory} : null,
  export: exportDirectory ? {index: scanTree(exportDirectory), directory: exportDirectory} : null
};
for (const [scope, scan] of Object.entries(scans)) {
  if (!scan) continue;
  if (scan.index.missing) fail('SCAN_ROOT_MISSING', scope + ' directory is absent: ' + scan.directory);
  if (scan.index.truncated) fail('SCAN_INCOMPLETE', scope + ' scan exceeded the audited bound; results are not complete');
  for (const link of scan.index.links) fail('SCAN_LINK_DENIED', scope + ' contains a link: ' + link);
}

const entryResults = checkEntries(entries, offline, scans);
if (packageDirectory) checkPackageInventory(packageDirectory);
checkOfflineRequirements(offline, scans);

// Deduplicate identical failures produced by both the per-entry and offline-entry checks.
const seenFailures = new Set();
const uniqueFailures = failures.filter(failure => {
  const key = failure.code + '\u0000' + failure.message;
  if (seenFailures.has(key)) return false;
  seenFailures.add(key);
  return true;
});
failures.length = 0;
failures.push(...uniqueFailures);

const shipped = entryResults.filter(result => result.shippedByInventory);
const unknownRightsShipped = shipped.filter(result => result.status === 'unknown-rightsholder' || failures.some(failure => failure.entryId === result.id && failure.code === 'UNKNOWN_RIGHTS_SHIPPED'));
const record = {
  format: 'craftmine.licensing-check/1',
  generatedAt: new Date().toISOString(),
  inventory: {path: inventoryPath, format: inventory.format, entries: entries.length},
  offlineEntry: fs.existsSync(offlinePath) ? offlinePath : null,
  scans: {
    package: packageDirectory ? {directory: packageDirectory, files: scans.package.index.files.size, links: scans.package.index.links.length} : null,
    export: exportDirectory ? {directory: exportDirectory, files: scans.export.index.files.size, links: scans.export.index.links.length} : null
  },
  ok: failures.length === 0 && pending.length === 0,
  status: failures.length ? 'fail' : pending.length ? 'pending' : 'pass',
  counts: {
    entries: entries.length,
    shippedByInventory: shipped.length,
    verified: entryResults.filter(result => result.verdict === 'verified').length,
    pending: pending.length,
    unknownRightsShipped: unknownRightsShipped.length,
    failures: failures.length
  },
  entries: entryResults,
  pending,
  failures,
  limits: [
    'Read-only: nothing inside the scanned package or export is modified.',
    'Pending-rights-review and unknown-rightsholder entries are reported as pending and are never a pass.',
    'A present licence text proves the file exists at the declared path; it is not a legal sufficiency opinion.',
    'Skipped scans are not verified and are listed explicitly.'
  ]
};

const evidencePath = option('evidence');
if (evidencePath) {
  const target = path.resolve(evidencePath);
  const inside = [packageDirectory, exportDirectory].filter(Boolean).some(directory => target.startsWith(path.resolve(directory) + path.sep));
  if (inside) {
    console.error('Refusing to write evidence inside the inspected tree: ' + target);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, JSON.stringify(record, null, 2) + '\n');
}

if (flag('json')) {
  console.log(JSON.stringify(record, null, 2));
} else {
  console.log('licensing-check: inventory=' + inventoryPath);
  if (packageDirectory) console.log('  package=' + packageDirectory + ' files=' + scans.package.index.files.size);
  if (exportDirectory) console.log('  export=' + exportDirectory + ' files=' + scans.export.index.files.size);
  const byCode = new Map();
  for (const failure of failures) byCode.set(failure.code, (byCode.get(failure.code) ?? 0) + 1);
  if (!flag('quiet')) {
    for (const [code, count] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      console.log('FAIL ' + code + ' x' + count);
      for (const failure of failures.filter(item => item.code === code).slice(0, 10)) console.log('  - ' + failure.message);
      if (count > 10) console.log('  ... ' + (count - 10) + ' more');
    }
  } else {
    for (const [code, count] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) console.log('FAIL ' + code + ' x' + count);
  }
  for (const item of pending) console.log('PENDING ' + item.id + ' (' + item.status + ') — not a pass');
  console.log((record.status === 'pass' ? 'PASSED' : record.status === 'pending' ? 'PENDING — NOT A PASS' : 'FAILED') + ': entries=' + record.counts.entries + ' shipped=' + record.counts.shippedByInventory + ' verified=' + record.counts.verified + ' pending=' + record.counts.pending + ' failures=' + record.counts.failures);
  if (evidencePath) console.log('Evidence: ' + path.resolve(evidencePath));
}
process.exit(record.status === 'pass' ? 0 : record.status === 'pending' ? 3 : 1);
