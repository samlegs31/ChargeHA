#!/usr/bin/env python3
"""Verify the frozen runtime; this script never contacts vehicles or deploys."""
from pathlib import Path
import hashlib,json,re,sys
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'current/manifest.json').read_text())
errors=[]
for name,expected in manifest['files'].items():
 p=root/name
 if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:errors.append('Changed or missing runtime file: '+name)
actual={p.relative_to(root).as_posix() for d in ['packages','drizzle'] for p in (root/d).rglob('*') if p.is_file()}
expected={n for n in manifest['files'] if n.startswith(('packages/','drizzle/'))}
errors+=['Unrecorded runtime file: '+n for n in sorted(actual-expected)]
for name in ['packages/client','devtools']:
 if (root/name).exists():errors.append('Retired rebuild path exists: '+name)
entry=root/'packages/server/dist/index.html'
if 'index-CQx0j9kn.js' not in entry.read_text():errors.append('Wrong dashboard entry')
# Resolve bundled Vite asset references without executing any downloaded code.
dist=root/'packages/server/dist'
for p in dist.rglob('*'):
 if p.suffix not in ['.js','.css','.html','.json']:continue
 for ref in re.findall(r'[\w-]+-[\w-]+\.(?:js|css)',p.read_text()):
  if not (dist/'assets'/ref).is_file():errors.append('Missing bundled asset: '+ref)
if errors:
 print('\n'.join(sorted(set(errors))));sys.exit(1)
print('Verified',len(manifest['files']),'frozen runtime files; current dashboard only; no build or deployment.')
