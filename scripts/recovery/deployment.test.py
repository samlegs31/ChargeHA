"""Exercise recovery with fake Docker in isolated temporary directories."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "restore-exact-evsolar.sh"
BASE_ID = "sha256:54862f48b17099a0cb8ebd33118ccfcb0d47ac3e28b94f079853260f12840c36"
FAKE_DOCKER = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
a = sys.argv[1:]
case = os.environ["CASE"]
log = Path(os.environ["CALL_LOG"])
with log.open("a") as f:
 f.write(" ".join(a) + " image=" + os.environ.get("EVSOLAR_IMAGE", "") + "\\n")
if a[:2] == ["image", "inspect"]:
 print(("wrong" if case == "base" else os.environ["BASE_ID"]) if a[2] == "evsolar:rollback-20261005-204734" else "sha256:corrected")
elif a and a[0] == "inspect":
 text = " ".join(a)
 if "Mounts" in text:
  print(os.environ["EVSOLAR_KEY_FILE"] if "encryption_key" in text else "chargeha-data")
 elif "PortBindings" in text: print("127.0.0.1:8000")
 elif ".State.Running" in text: print("true")
 elif ".State.Health" in text: print("unhealthy" if case == "health" else "healthy")
 elif ".Image" in text: print("sha256:previous-current")
 else: print(json.dumps([{"HostConfig":{"PortBindings":{"8000/tcp":[{"HostIp":"127.0.0.1","HostPort":"8000"},{"HostIp":"192.168.1.100","HostPort":"8000"}]}}}]))
elif a and a[0] == "create": print("source-container")
elif a and a[0] == "cp":
 if (a[1].startswith("source-container:") and case == "extract") or (a[1].startswith("chargeha:") and case == "backup"):
  sys.exit(1)
 Path(a[2]).mkdir(parents=True, exist_ok=True)
elif a and a[0] == "build" and case == "build": sys.exit(1)
elif a and a[0] == "compose" and "up" in a and case == "start":
 marker = Path(os.environ["START_MARKER"])
 if not marker.exists():
  marker.touch()
  sys.exit(1)
'''


class RecoveryDeploymentTests(unittest.TestCase):
    def run_recovery(self, case):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, body in {
                "docker": FAKE_DOCKER,
                "git": '#!/bin/sh\necho 8b327a11f06f2a44290883345ee56e27412be2b1\n',
                "python3": f'''#!{sys.executable}
import os, sys
from pathlib import Path
if sys.argv[1].endswith("prepare.py"):
 if os.environ["CASE"] == "verify": sys.exit(1)
 Path(sys.argv[2], "recovery-verification.json").write_text("{{}}")
else:
 os.execv({sys.executable!r}, [{sys.executable!r}] + sys.argv[1:])
''',
            }.items():
                path = root / name
                path.write_text(body)
                path.chmod(0o755)
            key = root / "key"
            key.write_text("test-key")
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}",
                       EVSOLAR_KEY_FILE=str(key), EVSOLAR_BACKUP_DIR=str(root / "backup"),
                       CALL_LOG=str(root / "calls"), START_MARKER=str(root / "start"),
                       BASE_ID=BASE_ID, CASE=case)
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True,
                                    text=True, timeout=10)
            ports = None
            if (root / "backup").exists():
                found = list((root / "backup").glob("*/ports.compose.json"))
                if found:
                    ports = json.loads(found[0].read_text())
            return result, (root / "calls").read_text(), ports

    def test_base_extract_verify_and_build_failures_leave_service_running(self):
        for case in ["base", "extract", "verify", "build"]:
            with self.subTest(case=case):
                result, calls, _ = self.run_recovery(case)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("stop chargeha", calls)
                self.assertNotIn("rm chargeha", calls)
                self.assertNotIn(" up -d", calls)

    def test_backup_failure_restarts_the_current_container(self):
        result, calls, _ = self.run_recovery("backup")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("start chargeha", calls)
        self.assertNotIn("rm chargeha", calls)
        self.assertNotIn(" up -d", calls)

    def test_success_preserves_bindings_and_deploys_the_pinned_corrected_image(self):
        result, calls, ports = self.run_recovery("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(ports["services"]["evsolar"]["ports"], [
            "127.0.0.1:8000:8000", "192.168.1.100:8000:8000",
        ])
        self.assertIn("up -d --pull never --remove-orphans image=sha256:corrected", calls)
        self.assertNotIn("pull ghcr.io", calls)
        self.assertLess(calls.index("build --pull=false"), calls.index("stop chargeha"))

    def test_start_or_health_failure_restores_data_and_previous_image(self):
        for case in ["start", "health"]:
            with self.subTest(case=case):
                result, calls, _ = self.run_recovery(case)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Starting rollback", result.stderr)
                self.assertIn("-v chargeha-data:/app/data", calls)
                self.assertIn("image=evsolar:before-exact-recovery-", calls)
                self.assertIn("image tag sha256:previous-current evsolar:before-exact-recovery-", calls)


if __name__ == "__main__":
    unittest.main()
