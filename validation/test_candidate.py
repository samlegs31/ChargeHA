import json
from pathlib import Path
import tempfile
import tarfile
import unittest

from candidate import BASE, ROOT, assemble, digest, verify


class CandidateIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = "packages/server/src/example.ts"
        self.asset = "packages/server/dist/assets/current.js"
        self.write(self.source, "original")
        self.write(self.asset, "installed UI")
        self.write("current/manifest.json", json.dumps({"files": {
            self.source: digest(b"original"), self.asset: digest(b"installed UI")}}))
        self.base_digest = digest((self.root / "current/manifest.json").read_bytes())
        self.write(self.source, "candidate")
        self.allow([self.source])
        self.write("validation/candidate-manifest.json", json.dumps({
            "schema": 1, "base_commit": BASE,
            "installed_manifest_sha256": self.base_digest,
            "files": {self.source: digest(b"candidate"), self.asset: digest(b"installed UI")},
        }))

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)

    def allow(self, names):
        self.write("validation/allowed-runtime-changes.json", json.dumps(names))

    def check(self):
        return verify(self.root, self.base_digest)

    def test_valid_candidate(self):
        self.check()

    def test_changed_candidate_source_is_rejected(self):
        self.write(self.source, "unrecorded modification")
        with self.assertRaisesRegex(ValueError, "fingerprint mismatch"):
            self.check()

    def test_installed_manifest_cannot_be_rebased_silently(self):
        self.write("current/manifest.json", '{"files":{}}')
        with self.assertRaisesRegex(ValueError, "Installed manifest"):
            self.check()

    def test_ui_change_is_rejected_even_when_allowlisted(self):
        self.write(self.asset, "other UI")
        self.allow([self.source, self.asset])
        with self.assertRaisesRegex(ValueError, "Protected installed"):
            self.check()

    def test_unlisted_file_is_rejected(self):
        self.write("packages/server/src/surprise.ts", "new")
        with self.assertRaisesRegex(ValueError, "Unreviewed drift"):
            self.check()

    def test_missing_file_is_rejected(self):
        (self.root / self.source).unlink()
        with self.assertRaises(FileNotFoundError):
            self.check()

    def test_symlink_is_rejected(self):
        path = self.root / self.source
        path.unlink()
        path.symlink_to(self.root / self.asset)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            self.check()

    def test_retired_frontend_is_rejected(self):
        (self.root / "packages/client").mkdir()
        with self.assertRaisesRegex(ValueError, "Retired path"):
            self.check()

    def test_wrong_provenance_is_rejected(self):
        path = self.root / "validation/candidate-manifest.json"
        data = json.loads(path.read_text())
        data["base_commit"] = "other"
        path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "provenance"):
            self.check()

    def test_real_archive_is_reproducible_and_never_overwrites(self):
        first, second = self.root / "a.tar.gz", self.root / "b.tar.gz"
        self.assertEqual(assemble(ROOT, first), assemble(ROOT, second))
        candidate = verify(ROOT)
        with tarfile.open(first, "r:gz") as archive:
            names = set(archive.getnames())
            self.assertEqual(names, set(candidate["files"]) | {
                "current/manifest.json", "validation/candidate-manifest.json",
                "CANDIDATE-NOT-DEPLOYED.txt"})
            for name, expected in candidate["files"].items():
                self.assertEqual(digest(archive.extractfile(name).read()), expected)
        before = first.read_bytes()
        with self.assertRaises(FileExistsError):
            assemble(ROOT, first)
        self.assertEqual(first.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
