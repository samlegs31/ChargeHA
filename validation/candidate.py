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
APPROVED_UI = {
    "packages/server/dist/assets/Schedules-R8LrB50u.js": "d9f305f25aff86ac19127ceaf74c38896487ed2188e13af899730975e7634057",
    "packages/server/dist/assets/Settings-C2gay-IT.js": "815f77784623487cf1bfcdfc6256ef984cc69721dc7f88618f2bfc4a78b407f4",
    "packages/server/dist/assets/Stats-Brkyx1mD.js": "6f9a1bf3af1ea341e463033ef9c2f1d83282a79243ab687eb83ac7a624361220",
    "packages/server/dist/assets/TeslaVehicleVisualDev-C6RS3WTw.js": "539cb1a703702deb96800ace189623ac67947af52854ee9f27fe0912816312c8",
    "packages/server/dist/assets/WizardRouter-BG7hMVUZ.js": "04c58099734977b5498bc7848376796d0e45b748830da218c6d7983119f68a6f",
    "packages/server/dist/assets/WizardShell-lO30GDsB.js": "c47fe1e81e1ad859ce05e0c409177736e538f39cbc81802d39faed58b51869ad",
    "packages/server/dist/assets/componentRegistry-bNm8U2v7.js": "2fafb0dc5e547a10fe5344198e0deddf705e2c2a7b7ddfb6ec0be33afc7b340c",
    "packages/server/dist/assets/evsolar-mobile.css": "378409d8952187c0fcba23b53265eb3f67212267699538804dd0051047988780",
    "packages/server/dist/assets/index-CQx0j9kn.js": "f8a735c276dec971f3c3cfd93c3f26931e49bf7251ce20fb71eacae8ce85f79b",
    "packages/server/dist/assets/timezones-BqtDy1tG.js": "bb521992c52d5f1ca7a3703763fe9e4ed8c4458974b1a0b8df025387f89f2810",
    "packages/server/dist/assets/vehicleColor-BKShnRyA.js": "29da4f3897b3f1ac3bd2927f53762b1777fb624fddc0d6ec09c56d4d1358d94b",
    "packages/server/dist/index.html": "b01ed6104b92bb12fda3fcd5ac4de86587e5b2a75025a8832435c43658d665da",
}


# Explicitly reviewed dependency update; installed baseline remains immutable.
APPROVED_DEPENDENCIES = {'deno.json': '94638d13978b6be2f48ada1f21415872a46aa69c331d119477987d994f6ef214', 'deno.lock': '52fa399d027557346f59465c325a25342ac8e6051aa6b21e9ff9586a14072f00', 'packages/server/deno.json': '1a14de1deeb821bf0e22b7b407a91d891f43e7b15235a0bad589e7e198c478e7', 'packages/plugins/deno.json': '27ac269f5ac686b59b95596822a866c5d0ebcb06a5d56cc284087a110472ec81'}

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
    # Runtime TypeScript changes require the reviewed allowlist. Other files
    # require exact approved hashes; the installed baseline stays immutable.
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
    if any(protected(name) and {**APPROVED_UI, **APPROVED_DEPENDENCIES}.get(name) != files[name] for name in changed):
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
