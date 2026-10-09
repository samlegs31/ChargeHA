#!/usr/bin/env python3
"""Check installed artifacts against the untouched manifest and list scoped edits.
This does not replace Verify current version or certify a new release.
"""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BASE = "46e10d950896689aa84a113c78d1f1d2921da017"
manifest_bytes = (ROOT / "current/manifest.json").read_bytes()
assert manifest_bytes == subprocess.check_output(
    ["git", "show", f"{BASE}:current/manifest.json"], cwd=ROOT
), "Installed manifest changed"
manifest = json.loads(manifest_bytes)["files"]
allowed = set(json.loads((ROOT / "validation/allowed-runtime-changes.json").read_text()))
assert not any(p.startswith("packages/server/dist/") for p in allowed)
changed = set()
for name, expected in manifest.items():
    path = ROOT / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        changed.add(name)
actual = {
    p.relative_to(ROOT).as_posix()
    for directory in ("packages", "drizzle")
    for p in (ROOT / directory).rglob("*") if p.is_file()
}
changed |= actual - set(manifest)
assert changed == allowed, f"Unexpected drift: {sorted(changed ^ allowed)}"
assert not (ROOT / "packages/client").exists()
assert not (ROOT / "devtools").exists()
print(f"Preserved {len(manifest) - len(changed & set(manifest))} installed files; "
      f"{len(changed)} explicitly listed backend/test edits. Manifest and all dist assets unchanged.")
