#!/usr/bin/env bash
# Loads the recorded image into Docker. Does not stop/start any container.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="${1:?Usage: scripts/load-current-image.sh /path/to/evsolar-current-arm64.tar.gz}"
python3 - "$ROOT" "$ARCHIVE" <<'PY'
from pathlib import Path
import hashlib,json,sys
r=Path(sys.argv[1]);p=Path(sys.argv[2]);m=json.loads((r/'current/manifest.json').read_text());h=hashlib.sha256()
with p.open('rb') as f:
 for data in iter(lambda:f.read(1024*1024),b''):h.update(data)
if h.hexdigest()!=m['image_archive_sha256']:raise SystemExit('Image checksum mismatch: refusing to load')
print('Image archive checksum verified')
PY
docker load -i "$ARCHIVE"
echo 'Recorded image loaded. No running service has been changed.'
