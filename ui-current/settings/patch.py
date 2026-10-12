"""Reproduce the authorized Settings-only patch against the installed chunk."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]

def render(root=ROOT):
    spec = json.loads((root / "ui-current/settings/patch.json").read_text())
    original = (root / spec["original"]).read_bytes()
    if hashlib.sha256(original).hexdigest() != spec["base_sha256"]:
        raise ValueError("Settings reference changed")
    text = original.decode()
    if text.count("function Ds(") != 1 or text.count("function Rs(") != 1:
        raise ValueError("Settings anchors are not unique")
    start = text.index("function Ds(")
    end = text.index("function Rs(", start)
    replacement = "\n".join((root / path).read_text() for path in spec["components"])
    text = text[:start] + replacement + text[end:]
    for change in json.loads((root / "ui-current/settings/simplification.json").read_text()):
        if text.count(change["before"]) != 1:
            raise ValueError("Settings simplification anchor is not unique: " + change["before"])
        text = text.replace(change["before"], change["after"], 1)
    return spec["asset"], text.encode()

if __name__ == "__main__":
    asset, output = render()
    (ROOT / asset).write_bytes(output)
    print(asset, hashlib.sha256(output).hexdigest())
