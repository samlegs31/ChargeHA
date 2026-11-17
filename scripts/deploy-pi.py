#!/usr/bin/env python3
"""Safe zero-downtime-target overlay deploy for the local Raspberry Pi ChargeHA container."""

import argparse
import datetime
import fcntl
import hashlib
import http.client
import json
import os
import pathlib
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTAINER = "chargeha"
ROLLBACK_BASE_TAG = "evsolar:rollback-pre-547247d"
ROLLBACK_PREV_TAG = "evsolar:rollback-prev"
BACKUP_ROOT = pathlib.Path("/home/chargeha/evsolar-backups")
KEEP_CI_BACKUPS = 5
KEEP_CI_IMAGES = 3


class DockerSock(http.client.HTTPConnection):
    def __init__(self):
        super().__init__("localhost")

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect("/var/run/docker.sock")


def api(method, path, body=None):
    conn = DockerSock()
    hdr = {"Content-Type": "application/json"} if body is not None else {}
    raw_body = json.dumps(body) if body is not None else None
    conn.request(method, path, raw_body, hdr)
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8", "replace")
    conn.close()
    if resp.status >= 400:
        raise RuntimeError(f"Docker API {method} {path} -> {resp.status}: {raw}")
    return json.loads(raw) if raw else {}


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def inspect(name):
    return json.loads(run("docker", "inspect", name))[0]


def container_exists(name):
    return subprocess.run(["docker", "inspect", name], capture_output=True).returncode == 0


def image_exists(ref):
    return subprocess.run(["docker", "image", "inspect", ref], capture_output=True).returncode == 0


def wait_healthy(name, timeout_steps=60):
    for _ in range(timeout_steps):
        st = inspect(name)["State"]
        if st.get("Health", {}).get("Status") == "healthy":
            return
        if not st.get("Running"):
            break
        time.sleep(2)
    logs = subprocess.run(["docker", "logs", "--tail", "60", name], capture_output=True, text=True)
    raise RuntimeError(f"Health check failed: {name}\n{logs.stdout}\n{logs.stderr}")


def settings_hash(name):
    js = (
        'import { Database } from "@db/sqlite";'
        'const p = Deno.env.get("DB_PATH") ?? "/app/data/chargeha.db";'
        "const d = new Database(p, { readonly: true });"
        'const re = /^(runtime\\.|tesla\\.|oscillation_|system_alert)/;'
        'const cfg = d.prepare("SELECT key, value FROM config ORDER BY key").all()'
        ".filter((r) => !re.test(String(r.key)));"
        'const veh = d.prepare("SELECT id, name, mode, home_charging_source FROM vehicles ORDER BY id").all();'
        'const sch = d.prepare("SELECT id, schedule_type, start_time, end_time, days_json, charge_amps, charge_limit_pct, enabled FROM schedules ORDER BY id").all();'
        "console.log(JSON.stringify({ cfg, veh, sch }));"
        "d.close();"
    )
    out = run(
        "docker",
        "exec",
        name,
        "deno",
        "eval",
        "--cached-only",
        "--allow-read",
        "--allow-ffi",
        "--allow-env",
        "--unstable-ffi",
        js,
    )
    return hashlib.sha256(out.encode()).hexdigest()


def container_file_shas(name, rel_paths):
    sh = 'while IFS= read -r p; do [ -f "/app/$p" ] && sha256sum "/app/$p" || echo "MISSING /app/$p"; done'
    out = subprocess.check_output(
        ["docker", "exec", "-i", name, "sh", "-c", sh],
        input="\n".join(rel_paths) + "\n",
        text=True,
    )
    result = {}
    for line in out.splitlines():
        digest, path = line.split(None, 1)
        key = path[5:] if path.startswith("/app/") else path
        result[key] = None if digest == "MISSING" else digest
    return result


def image_needs_deno_cache(base_image, repo_shas):
    deno_files = sorted(
        f for f in repo_shas if f in ("deno.json", "deno.lock") or f.endswith("/deno.json")
    )
    if not deno_files:
        return False
    sh = 'while IFS= read -r p; do [ -f "/app/$p" ] && sha256sum "/app/$p" || echo "MISSING /app/$p"; done'
    out = subprocess.check_output(
        ["docker", "run", "--rm", "-i", "--entrypoint", "sh", base_image, "-c", sh],
        input="\n".join(deno_files) + "\n",
        text=True,
    )
    base_shas = {}
    for line in out.splitlines():
        digest, path = line.split(None, 1)
        key = path[5:] if path.startswith("/app/") else path
        base_shas[key] = None if digest == "MISSING" else digest
    return any(base_shas.get(f) != repo_shas[f] for f in deno_files)


def acquire_lock():
    lock_dir = BACKUP_ROOT / "managed-daily"
    if not lock_dir.exists():
        return None
    lock_file = open(lock_dir / ".lock", "a")
    for _ in range(30):
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock_file
        except BlockingIOError:
            time.sleep(2)
    lock_file.close()
    raise RuntimeError("Timed out waiting for managed-daily backup lock")


def prune_old_ci_artifacts(current_image_id):
    ci_backups = sorted(BACKUP_ROOT.glob("ci-deploy-*"), key=lambda p: p.name, reverse=True)
    for old_bak in ci_backups[KEEP_CI_BACKUPS:]:
        shutil.rmtree(old_bak, ignore_errors=True)

    raw = run("docker", "images", "--format", "{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}\t{{.ID}}", "evsolar")
    ci_images = []
    for line in raw.splitlines():
        if not line:
            continue
        created, ref, img_id = line.split("\t", 2)
        if ref.startswith("evsolar:ci-"):
            ci_images.append((created, ref, img_id))
    ci_images.sort(key=lambda item: item[0], reverse=True)
    for _, ref, img_id in ci_images[KEEP_CI_IMAGES:]:
        if img_id == current_image_id:
            continue
        subprocess.run(["docker", "rmi", ref], capture_output=True, text=True, check=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Rebuild and redeploy even if /app files already match")
    parser.add_argument("--check-only", action="store_true", help="Check runner, Docker health, and file drift without restarting")
    args = parser.parse_args()

    head_sha = run("git", "-C", str(REPO_ROOT), "rev-parse", "HEAD")
    short_sha = head_sha[:7]
    tag = f"evsolar:ci-{short_sha}"

    tracked = [
        p
        for p in run(
            "git",
            "-C",
            str(REPO_ROOT),
            "ls-files",
            "packages",
            "drizzle",
            "entrypoint.sh",
            "deno.json",
            "deno.lock",
        ).splitlines()
        if p
    ]
    repo_shas = {
        rel: hashlib.sha256((REPO_ROOT / rel).read_bytes()).hexdigest()
        for rel in sorted(tracked)
        if (REPO_ROOT / rel).is_file()
    }

    old = inspect(CONTAINER)
    if old["State"].get("Health", {}).get("Status") != "healthy":
        raise RuntimeError(f"{CONTAINER} must be healthy before deploying")

    current_shas = container_file_shas(CONTAINER, list(repo_shas))
    changed = [rel for rel, want in repo_shas.items() if current_shas.get(rel) != want]

    manifest_path = REPO_ROOT / "validation" / "candidate-manifest.json"
    retired = []
    if manifest_path.is_file():
        baseline = set(json.loads(manifest_path.read_text()).get("files", {}))
        removed = sorted(p for p in (baseline - set(repo_shas)) if p.startswith(("packages/", "drizzle/")))
        if removed:
            existing_removed = container_file_shas(CONTAINER, removed)
            retired = [p for p, h in existing_removed.items() if h is not None]

    if args.check_only:
        print(
            json.dumps(
                {
                    "status": "check_only",
                    "commit": short_sha,
                    "healthy": True,
                    "checked_files": len(repo_shas),
                    "differing_files": changed,
                    "retired_files": retired,
                }
            )
        )
        return

    if not changed and not retired and not args.force:
        print(
            json.dumps(
                {
                    "status": "noop",
                    "reason": "up_to_date",
                    "commit": short_sha,
                    "checked_files": len(repo_shas),
                }
            )
        )
        return

    base_image = ROLLBACK_BASE_TAG if image_exists(ROLLBACK_BASE_TAG) else old["Image"]
    files_to_copy = list(repo_shas) if base_image == ROLLBACK_BASE_TAG else (changed or list(repo_shas))
    need_deno_cache = image_needs_deno_cache(base_image, repo_shas)

    work = pathlib.Path(tempfile.mkdtemp(prefix=f"chargeha-ci-{short_sha}-"))
    lock_file = None
    try:
        os.umask(0o022)
        print(
            f"[1/7] Staging {len(files_to_copy)} files for {short_sha} ({len(changed)} differing)...",
            flush=True,
        )
        delivery = work / "delivery"
        for rel in files_to_copy:
            src = REPO_ROOT / rel
            dst = delivery / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            for parent in dst.parents:
                if parent == work:
                    break
                os.chmod(parent, 0o755)
            os.chmod(dst, 0o755 if os.access(src, os.X_OK) else 0o644)

        print(f"[2/7] Building image {tag} from {base_image}...", flush=True)
        dockerfile_lines = [f"FROM {base_image}", "COPY delivery/ /app/"]
        if retired:
            quoted = " ".join(f"/app/{p}" for p in retired)
            dockerfile_lines.append(f"RUN rm -f {quoted}")
        if need_deno_cache:
            dockerfile_lines.append("WORKDIR /app")
            dockerfile_lines.append("RUN deno install --frozen && deno cache --lock=deno.lock packages/server/src/main.ts")
        (work / "Dockerfile").write_text("\n".join(dockerfile_lines) + "\n")

        env = os.environ.copy()
        env["DOCKER_BUILDKIT"] = "0"
        subprocess.run(["docker", "build", "-q", "-t", tag, str(work)], env=env, check=True)
        new_image = inspect(tag)["Id"]

        os.umask(0o077)
        lock_file = acquire_lock()

        print("[3/7] Snapshotting DB settings & stopping container...", flush=True)
        before_settings = settings_hash(CONTAINER)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bak_dir = BACKUP_ROOT / f"ci-deploy-{stamp}-{short_sha}"
        bak_dir.mkdir(parents=True, exist_ok=True)
        key_src = next(
            m["Source"]
            for m in old["Mounts"]
            if m["Destination"] == "/run/secrets/evsolar_encryption_key"
        )
        shutil.copy2(key_src, bak_dir / "encryption_key")

        subprocess.run(["docker", "tag", old["Image"], ROLLBACK_PREV_TAG], check=True)
        subprocess.run(["docker", "stop", "-t", "20", CONTAINER], check=True)
        try:
            print("[4/7] Backing up SQLite DB & verifying integrity...", flush=True)
            subprocess.run(["docker", "cp", f"{CONTAINER}:/app/data", str(bak_dir / "data")], check=True)
            db_bak = bak_dir / "data" / "chargeha.db"
            assert db_bak.is_file(), f"Missing backup DB: {db_bak}"
            con = sqlite3.connect(f"file:{db_bak}?mode=ro", uri=True)
            try:
                assert con.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            finally:
                con.close()

            prev_name = f"{CONTAINER}-pre-ci-{stamp}-{short_sha}"
            subprocess.run(["docker", "rename", CONTAINER, prev_name], check=True)
            created = False
            started = False
            try:
                print("[5/7] Creating & starting updated container...", flush=True)
                cfg = dict(old["Config"])
                cfg["Image"] = new_image
                if cfg.get("Hostname") == old["Id"][:12]:
                    cfg.pop("Hostname", None)
                labels = dict(cfg.get("Labels") or {})
                labels["org.chargeha.git_sha"] = head_sha
                cfg["Labels"] = labels

                hc = dict(old["HostConfig"])
                old_short = old["Id"][:12]
                nets = {}
                for nname, ndata in (old.get("NetworkSettings", {}).get("Networks") or {}).items():
                    if nname in ("host", "none") or nname.startswith("container:"):
                        continue
                    ep = {}
                    aliases = [a for a in (ndata.get("Aliases") or []) if a != old_short]
                    if aliases:
                        ep["Aliases"] = aliases
                    for key in ("Links", "DriverOpts", "IPAMConfig"):
                        if ndata.get(key):
                            ep[key] = ndata[key]
                    nets[nname] = ep

                body = dict(cfg)
                body["HostConfig"] = hc
                if nets:
                    body["NetworkingConfig"] = {"EndpointsConfig": nets}

                api("POST", f"/containers/create?name={CONTAINER}", body)
                created = True
                subprocess.run(["docker", "start", CONTAINER], check=True)
                started = True

                print("[6/7] Waiting for healthy & verifying files/settings...", flush=True)
                wait_healthy(CONTAINER)
                actual_shas = container_file_shas(CONTAINER, list(repo_shas))
                assert actual_shas == repo_shas, "Container file SHA256 mismatch after deploy"
                assert settings_hash(CONTAINER) == before_settings, "DB settings changed unexpectedly"

                print("[7/7] Cleaning up old container & pruning old CI artifacts...", flush=True)
                subprocess.run(["docker", "rm", prev_name], check=True)
                prune_old_ci_artifacts(new_image)
                print(
                    json.dumps(
                        {
                            "status": "ok",
                            "commit": short_sha,
                            "image": tag,
                            "updated_files": len(changed),
                            "backup": str(bak_dir),
                            "rollback_image": ROLLBACK_PREV_TAG,
                        }
                    )
                )
            except Exception as err:
                print(f"ERROR: {err} -> rolling back to {ROLLBACK_PREV_TAG}...", flush=True)
                if started:
                    subprocess.run(["docker", "stop", "-t", "10", CONTAINER], check=False)
                if created:
                    subprocess.run(["docker", "rm", "-f", CONTAINER], check=False)
                subprocess.run(["docker", "rename", prev_name, CONTAINER], check=True)
                if started:
                    subprocess.run(
                        [
                            "docker",
                            "run",
                            "--rm",
                            "--volumes-from",
                            CONTAINER,
                            "-v",
                            f"{bak_dir / 'data'}:/bak:ro",
                            "--entrypoint",
                            "sh",
                            ROLLBACK_PREV_TAG,
                            "-c",
                            "rm -f /app/data/chargeha.db-wal /app/data/chargeha.db-shm && cp -af /bak/. /app/data/",
                        ],
                        check=True,
                    )
                subprocess.run(["docker", "start", CONTAINER], check=True)
                wait_healthy(CONTAINER)
                raise
        except Exception:
            if container_exists(CONTAINER) and inspect(CONTAINER)["State"].get("Status") != "running":
                subprocess.run(["docker", "start", CONTAINER], check=False)
            raise
    finally:
        if lock_file:
            lock_file.close()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
