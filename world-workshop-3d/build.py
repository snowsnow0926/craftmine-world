"""Build the offline single-file prototype. Python 3.10+, standard library only."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent
html=(ROOT/'src/index.template.html').read_text(encoding='utf-8')
for marker,filename in [('/* STYLES */','styles.css'),('/* RUNTIME */','voxel-runtime.js'),('/* APPLICATION */','workshop.js')]:
    text=(ROOT/'src'/filename).read_text(encoding='utf-8')
    if filename.endswith('.js'):
        text=text.replace('</script','<\\/script')
    if marker not in html:
        raise ValueError(f'Missing build marker: {marker}')
    html=html.replace(marker,text)
(ROOT/'index.html').write_text(html,encoding='utf-8')
print(f'Built {ROOT / "index.html"}: {len(html.encode("utf-8")):,} bytes')
