"""Exercise update failure recovery with fake Docker; never touches live data."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/update-evsolar.sh"
FAKE_DOCKER = '''#!/usr/bin/env python3
import os, sys
from pathlib import Path
a = sys.argv[1:]
with open(os.environ["CALL_LOG"], "a") as f:
 f.write(" ".join(a) + " image=" + os.environ.get("EVSOLAR_IMAGE", "") + "\\n")
if a[:2] == ["image", "inspect"]:
 print("sha256:pinned" if "{{.Id}}" in a else ("wrong" if os.environ["CASE"] == "revision" else "expected"))
elif a and a[0] == "inspect":
 text = " ".join(a)
 if "Mounts" in text:
  print(os.environ["EVSOLAR_KEY_FILE"] if "encryption_key" in text else "chargeha-data")
 elif "PortBindings" in text: print("127.0.0.1:8000")
 elif ".State.Running" in text: print("true")
 elif ".State.Health" in text: print("healthy")
 elif ".Image" in text: print("sha256:old")
 else: print("{}")
elif a and a[0] == "cp" and os.environ["CASE"] == "backup":
 sys.exit(1)
'''


class UpdateTests(unittest.TestCase):
    def run_update(self, case):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, body in {
                "docker": FAKE_DOCKER,
                "git": '#!/bin/sh\ncase "$*" in *rev-parse*) echo expected;; esac\n',
                "sleep": '#!/bin/sh\n/bin/sleep 1\n',
            }.items():
                path = root / name
                path.write_text(body)
                path.chmod(0o755)
            key = root / "key"
            key.write_text("test-key")
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}",
                       EVSOLAR_KEY_FILE=str(key), EVSOLAR_BACKUP_DIR=str(root / "backup"),
                       EVSOLAR_WAIT_SECONDS="1", CALL_LOG=str(root / "calls"), CASE=case)
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True,
                                    text=True, timeout=10)
            return result, (root / "calls").read_text()

    def test_backup_failure_restarts_old_container(self):
        result, calls = self.run_update("backup")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("start chargeha", calls)
        self.assertNotIn("rm chargeha", calls)
        self.assertNotIn(" up -d", calls)

    def test_wrong_revision_does_not_stop_service(self):
        result, calls = self.run_update("revision")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("stop chargeha", calls)

    def test_success_runs_pinned_image(self):
        result, calls = self.run_update("success")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("up -d --pull never --remove-orphans image=sha256:pinned", calls)


if __name__ == "__main__":
    unittest.main()
