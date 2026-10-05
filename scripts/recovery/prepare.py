#!/usr/bin/env python3
"""Apply the reviewed correction to the exact recovered Raspberry runtime."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parent
ASSET_DIRECTORY = "safety-reset-20261005"


def verify_original(app):
    expected = json.loads((ROOT / "original-sha256.json").read_text())
    for name, digest in expected.items():
        path = app / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"The saved image differs from the reviewed version: {name}")


def replace_component(text, start, end, source):
    if text.count(start) != 1:
        raise RuntimeError(f"Expected one original component: {start}")
    first = text.index(start)
    last = text.index(end, first)
    return text[:first] + source + "\n" + text[last:]


def patch_ui(app):
    dist = app / "packages/server/dist"
    assets = dist / "assets"
    recovered = assets / ASSET_DIRECTORY
    if recovered.exists():
        raise RuntimeError("Recovery asset directory already exists")
    # Serve the same complete asset graph under a fresh path. This avoids stale
    # cached chunks and keeps all React/tRPC modules on one consistent URL graph.
    shutil.copytree(assets, recovered)
    dashboard = recovered / "index-CQx0j9kn.js"
    dashboard.write_text(replace_component(
        dashboard.read_text(), "function oo(", "function co(",
        (ROOT / "dashboard.js").read_text(),
    ))
    settings = recovered / "Settings-C2gay-IT.js"
    settings.write_text(replace_component(
        settings.read_text(), "function si(", "function ri(",
        (ROOT / "automatic-charging.js").read_text(),
    ))
    for asset in recovered.glob("*.js"):
        # Vite's preload lists use root-relative assets/... paths; relative ESM
        # imports already resolve inside the new directory without edits.
        content = asset.read_text()
        content = re.sub(r'(["\'])assets/', rf'\1assets/{ASSET_DIRECTORY}/', content)
        asset.write_text(content)
    index = dist / "index.html"
    index.write_text(index.read_text().replace("/assets/", f"/assets/{ASSET_DIRECTORY}/"))


def prepare(app):
    verify_original(app)
    original_assets = {
        str(p.relative_to(app)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in (app / "packages/server/dist").rglob("*")
        if p.is_file() and p.name != "index.html"
    }
    for source in (ROOT / "overlay").rglob("*.ts"):
        destination = app / source.relative_to(ROOT / "overlay")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    patch_ui(app)
    for name, digest in original_assets.items():
        if hashlib.sha256((app / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError(f"An original visual asset was changed: {name}")
    (app / "recovery-verification.json").write_text(json.dumps({
        "base_image": "sha256:54862f48b17099a0cb8ebd33118ccfcb0d47ac3e28b94f079853260f12840c36",
        "original_assets_preserved": len(original_assets),
        "asset_directory": ASSET_DIRECTORY,
    }, indent=2) + "\n")
    print(f"Verified and preserved {len(original_assets)} original visual assets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", type=Path)
    prepare(parser.parse_args().app.resolve())
