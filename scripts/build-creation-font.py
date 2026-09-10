"""Build the bundled CJK font from the repository's OFL Noto Sans SC font.

Requires fonttools[woff] 4.65.0. Source bytes and generated parts are recorded.
--static-input may reuse a weight-400 intermediate from this same source.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--static-input', type=Path)
args = parser.parse_args()
source = root / 'vendor/pi-desktop/apps/desktop/src/assets/fonts/noto-sans-sc.woff2'
font = TTFont(args.static_input or source)
if 'fvar' in font:
    font = instantiateVariableFont(font, {'wght': 400}, inplace=True)
for entry in font['name'].names:
    names = {1: 'Craftmine CJK', 2: 'Regular', 3: 'Craftmine CJK Regular 1.0',
             4: 'Craftmine CJK Regular', 6: 'CraftmineCJK-Regular',
             16: 'Craftmine CJK', 17: 'Regular'}
    if entry.nameID in names:
        entry.string = names[entry.nameID].encode(entry.getEncoding())
font.flavor = 'woff2'
out = root / 'desktop/godot/bases/creation-sandbox/assets/fonts'
out.mkdir(parents=True, exist_ok=True)
intermediate = root / 'test-results/creation-cjk-renamed.woff2'
intermediate.parent.mkdir(parents=True, exist_ok=True)
font.save(intermediate)
data = intermediate.read_bytes()
encoded = base64.b64encode(data).decode('ascii')
parts = []
for index, start in enumerate(range(0, len(encoded), 2_800_000)):
    name = f'cjk-{index}.json'
    text = json.dumps({'format': 'craftmine.font-part/1', 'index': index,
                       'data': encoded[start:start+2_800_000]}, separators=(',', ':')) + '\n'
    (out / name).write_text(text, encoding='utf8', newline='\n')
    parts.append({'path': name, 'bytes': len(text.encode()), 'sha256': hashlib.sha256(text.encode()).hexdigest()})
license_path = root / 'vendor/pi-desktop/apps/desktop/src/assets/fonts/licenses/OFL-NotoSansSC.txt'
(out / 'OFL-NotoSansSC.txt').write_bytes(license_path.read_bytes())
manifest = {'format': 'craftmine.font/1', 'family': 'Craftmine CJK', 'weight': 400,
            'source': str(source.relative_to(root)).replace('\\', '/'),
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'license': 'OFL-1.1', 'licenseFile': 'OFL-NotoSansSC.txt',
            'generator': 'scripts/build-creation-font.py', 'fontToolsVersion': '4.65.0',
            'glyphCoverage': len(font.getBestCmap()), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'parts': parts}
(out / 'font.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n', encoding='utf8', newline='\n')
print(json.dumps({k: v for k, v in manifest.items() if k != 'parts'}, ensure_ascii=False))
