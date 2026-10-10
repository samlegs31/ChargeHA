#!/usr/bin/env python3
"""Record, verify and assemble a local candidate. No network or deployment."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

BASE = "46e10d950896689aa84a113c78d1f1d2921da017"
BASE_MANIFEST_SHA256 = "b70d00efba3608ea321f38e9d4441da6767dfe6d21448cf4e5b4645aca16f053"
ROOT = Path(__file__).resolve().parent.parent

# User-authorized Settings addition. Every other installed asset stays immutable.
APPROVED_UI = {"packages/server/dist/assets/Settings-C2gay-IT.js": "b7208035c7dd781a06880ed2ad1b5bb2faf754d4f94f494e71d4fb65a1d05f34"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_file(root, name):
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(p in (".", "..") for p in path.parts):
        raise ValueError(f"Unsafe path: {name}")
    full = root
    for part in path.parts:
        full = full / part
        if full.is_symlink():
            raise ValueError(f"Symlink forbidden: {name}")
    return full.read_bytes()


def protected(name):
    # Only backend/shared .ts files can differ. UI, dependencies, entrypoint,
    # migrations and installed assets remain exactly as captured.
    return not (
        name.startswith(("packages/server/src/", "packages/shared/", "packages/plugins/"))
        and name.endswith(".ts")
        and "/client/" not in name
    )


def inventory(root, expected_digest=BASE_MANIFEST_SHA256):
    baseline_bytes = read_file(root, "current/manifest.json")
    if digest(baseline_bytes) != expected_digest:
        raise ValueError("Installed manifest fingerprint changed")
    baseline = json.loads(baseline_bytes)["files"]
    for retired in ("packages/client", "devtools", "docker/Dockerfile"):
        if (root / retired).exists():
            raise ValueError(f"Retired path restored: {retired}")
    names = set(baseline)
    for directory in ("packages", "drizzle"):
        names.update(p.relative_to(root).as_posix() for p in (root / directory).rglob("*")
                     if p.is_file() or p.is_symlink())
    files = {name: digest(read_file(root, name)) for name in sorted(names)}
    changed = {name for name, value in files.items() if baseline.get(name) != value}
    allowed = set(json.loads(read_file(root, "validation/allowed-runtime-changes.json")))
    if changed != allowed:
        raise ValueError(f"Unreviewed drift: {sorted(changed ^ allowed)}")
    if any(protected(name) and APPROVED_UI.get(name) != files[name] for name in changed):
        raise ValueError("Protected installed file changed")
    return files


def record(root):
    result = {"schema": 1, "base_commit": BASE,
              "installed_manifest_sha256": BASE_MANIFEST_SHA256,
              "files": inventory(root)}
    (root / "validation/candidate-manifest.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def verify(root, expected_digest=BASE_MANIFEST_SHA256):
    candidate = json.loads(read_file(root, "validation/candidate-manifest.json"))
    if (candidate.get("schema"), candidate.get("base_commit"),
        candidate.get("installed_manifest_sha256")) != (1, BASE, expected_digest):
        raise ValueError("Invalid candidate provenance")
    files = inventory(root, expected_digest)
    if files != candidate.get("files"):
        raise ValueError("Candidate fingerprint mismatch; review changes before recording again")
    return candidate


def assemble(root, destination):
    candidate = verify(root)
    # Read and hash again before opening the output, rejecting concurrent edits.
    contents = {name: read_file(root, name) for name in candidate["files"]}
    if {name: digest(data) for name, data in contents.items()} != candidate["files"]:
        raise ValueError("Files changed during assembly")
    contents["current/manifest.json"] = read_file(root, "current/manifest.json")
    contents["validation/candidate-manifest.json"] = read_file(root, "validation/candidate-manifest.json")
    contents["CANDIDATE-NOT-DEPLOYED.txt"] = (
        "Source candidate with preserved installed frontend bundles.\n"
        "Not a Docker image or a certified Raspberry release. No secrets or database included.\n"
    ).encode()
    with destination.open("xb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for name, data in sorted(contents.items()):
                    info = tarfile.TarInfo(name)
                    info.size = len(data)
                    info.mode = 0o755 if name == "entrypoint.sh" else 0o644
                    archive.addfile(info, io.BytesIO(data))
    return digest(destination.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("record", "verify", "assemble"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "record":
        print(f"Recorded {len(record(ROOT)['files'])} candidate files")
    elif args.action == "verify":
        print(f"Verified {len(verify(ROOT)['files'])} candidate files; authorized Settings patch and remaining installed UI verified")
    elif args.output is None:
        parser.error("assemble requires --output (new local file)")
    else:
        print(f"SHA256 {assemble(ROOT, args.output)}  {args.output}")


if __name__ == "__main__":
    main()
