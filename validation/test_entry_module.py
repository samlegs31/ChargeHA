"""All imports of the entry module must resolve to one browser module URL."""
from pathlib import Path
import re
import unittest

class EntryModuleTests(unittest.TestCase):
    def test_entry_url_matches_existing_chunk_imports(self):
        root = Path(__file__).resolve().parent.parent / 'packages/server/dist'
        html = (root / 'index.html').read_text()
        entry = re.search(r'<script[^>]+src="([^"]+)"', html)[1]
        self.assertEqual(entry, '/assets/index-CQx0j9kn.js')
        chunks = list((root / 'assets').glob('*.js'))
        self.assertTrue(any('"./index-CQx0j9kn.js"' in p.read_text() for p in chunks))
