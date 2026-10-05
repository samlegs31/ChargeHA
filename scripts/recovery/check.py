#!/usr/bin/env python3
"""Run recovery regression tests without modifying the checkout's application."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--deno", default="deno")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="evsolar-recovery-test-") as directory:
        workspace = Path(directory) / "app"
        shutil.copytree(ROOT, workspace, ignore=shutil.ignore_patterns(
            ".git", "node_modules", "dist", "__pycache__", "coverage",
        ))
        shutil.copytree(ROOT / "scripts/recovery/overlay", workspace, dirs_exist_ok=True)
        config_path = workspace / "deno.json"
        config = json.loads(config_path.read_text())
        config["exclude"] = [p for p in config.get("exclude", []) if p != "scripts/recovery/"]
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        subprocess.run([
            args.deno, "test", "--frozen", "--allow-env", "--allow-read",
            "scripts/recovery/overseer-engine.test.ts", "scripts/recovery/config.test.ts",
        ], cwd=workspace, check=True)
