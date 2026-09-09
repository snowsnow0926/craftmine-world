#!/usr/bin/env node
// Fetch the official licence texts used by the Craftmine World licence inventory
// and record their provenance. Writes texts/LICENSE-<SPDX>.txt plus texts/SOURCES.json.
//
// This tool never invents a licence text. If a fetch fails it records the exact URL,
// the error and the command a human must run; the file is not written.
//
// Usage:
//   node desktop/delivery/licensing/tools/fetch-texts.mjs [--only <id> ...]
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LICENSING_DIR = path.resolve(HERE, '..');
const TEXTS_DIR = path.join(LICENSING_DIR, 'texts');

// Each source is the canonical plain-text publication of the licence. opensource.org
// serves HTML for some licences, so the SPDX licence-list plain text is used where a
// clean text is required; the alternative URL is recorded in the note.
export const SOURCES = [
  {id: 'AGPL-3.0', spdx: 'AGPL-3.0-only', file: 'LICENSE-AGPL-3.0.txt', url: 'https://www.gnu.org/licenses/agpl-3.0.txt', note: 'GNU Affero GPL v3 plain text (gnu.org).'},
  {id: 'LGPL-3.0', spdx: 'LGPL-3.0-or-later', file: 'LICENSE-LGPL-3.0.txt', url: 'https://www.gnu.org/licenses/lgpl-3.0.txt', note: 'GNU Lesser GPL v3 supplement; it incorporates GPL-3 by reference.'},
  {id: 'GPL-3.0', spdx: 'GPL-3.0-only', file: 'LICENSE-GPL-3.0.txt', url: 'https://www.gnu.org/licenses/gpl-3.0.txt', note: 'GNU GPL v3 plain text (gnu.org).'},
  {id: 'MIT', spdx: 'MIT', file: 'LICENSE-MIT.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/MIT.txt', note: 'SPDX plain text. https://opensource.org/license/mit returns HTML, not plain text.'},
  {id: 'OFL-1.1', spdx: 'OFL-1.1', file: 'LICENSE-OFL-1.1.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/OFL-1.1.txt', note: 'SIL Open Font License 1.1 (fonts bundled by upstream PI-Desktop).'},
  {id: 'Apache-2.0', spdx: 'Apache-2.0', file: 'LICENSE-Apache-2.0.txt', url: 'https://www.apache.org/licenses/LICENSE-2.0.txt', note: 'Apache License 2.0 plain text.'},
  {id: 'BSD-3-Clause', spdx: 'BSD-3-Clause', file: 'LICENSE-BSD-3-Clause.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/BSD-3-Clause.txt', note: 'SPDX plain text.'},
  {id: 'BSD-2-Clause', spdx: 'BSD-2-Clause', file: 'LICENSE-BSD-2-Clause.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/BSD-2-Clause.txt', note: 'SPDX plain text.'},
  {id: 'ISC', spdx: 'ISC', file: 'LICENSE-ISC.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/ISC.txt', note: 'SPDX plain text.'},
  {id: 'MPL-2.0', spdx: 'MPL-2.0', file: 'LICENSE-MPL-2.0.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/MPL-2.0.txt', note: 'SPDX plain text.'},
  {id: 'Zlib', spdx: 'Zlib', file: 'LICENSE-Zlib.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/Zlib.txt', note: 'SPDX plain text.'},
  {id: '0BSD', spdx: '0BSD', file: 'LICENSE-0BSD.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/0BSD.txt', note: 'SPDX plain text.'},
  {id: 'Unlicense', spdx: 'Unlicense', file: 'LICENSE-Unlicense.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/Unlicense.txt', note: 'SPDX plain text.'},
  {id: 'BlueOak-1.0.0', spdx: 'BlueOak-1.0.0', file: 'LICENSE-BlueOak-1.0.0.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/BlueOak-1.0.0.txt', note: 'SPDX plain text.'},
  {id: 'Python-2.0', spdx: 'Python-2.0', file: 'LICENSE-Python-2.0.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/Python-2.0.txt', note: 'SPDX plain text.'},
  {id: 'CC0-1.0', spdx: 'CC0-1.0', file: 'LICENSE-CC0-1.0.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC0-1.0.txt', note: 'Public-domain dedication; no attribution is required, the text is bundled for completeness.'},
  {id: 'WTFPL', spdx: 'WTFPL', file: 'LICENSE-WTFPL.txt', url: 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/WTFPL.txt', note: 'Short permissive licence used by one installed npm package that ships no licence file.'}
];

const only = new Set(process.argv.slice(2).filter((value, index, all) => all[index - 1] === '--only'));

async function fetchOne(source) {
  const response = await fetch(source.url, {redirect: 'follow', headers: {'user-agent': 'craftmine-licensing-audit/1'}});
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('empty response body');
  return {buffer, httpStatus: response.status};
}

export async function fetchTexts({sources = SOURCES} = {}) {
  fs.mkdirSync(TEXTS_DIR, {recursive: true});
  const record = {format: 'craftmine.license-texts/1', retrievedAt: new Date().toISOString(), texts: [], failures: []};
  for (const source of sources) {
    if (only.size && !only.has(source.id)) continue;
    const target = path.join(TEXTS_DIR, source.file);
    try {
      const {buffer, httpStatus} = await fetchOne(source);
      fs.writeFileSync(target, buffer);
      record.texts.push({
        id: source.id,
        spdx: source.spdx,
        file: 'texts/' + source.file,
        url: source.url,
        retrievedAt: new Date().toISOString(),
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        httpStatus,
        note: source.note
      });
      console.log('FETCHED ' + source.id + ' ' + buffer.length + ' bytes ' + record.texts.at(-1).sha256);
    } catch (error) {
      const humanCommand = 'node -e "fetch(\'' + source.url + '\').then(r=>r.arrayBuffer()).then(b=>require(\'fs\').writeFileSync(\'' + source.file + '\',Buffer.from(b)))"';
      record.failures.push({id: source.id, url: source.url, file: 'texts/' + source.file, error: String(error?.message ?? error), humanCommand});
      console.error('FETCH FAILED ' + source.id + ' ' + source.url + ': ' + (error?.message ?? error));
    }
  }
  fs.writeFileSync(path.join(TEXTS_DIR, 'SOURCES.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await fetchTexts();
  console.log('texts=' + result.texts.length + ' failures=' + result.failures.length);
  if (result.failures.length) process.exitCode = 1;
}
