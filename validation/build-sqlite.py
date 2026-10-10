#!/usr/bin/env python3
"""Build a verified SQLite test library locally; never install it system-wide."""
import argparse
import hashlib
import io
from pathlib import Path
import platform
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION = '3.53.4'
URL = 'https://www.sqlite.org/2026/sqlite-amalgamation-3530400.zip'
SOURCE_SHA3 = '67f423e9ebbbdc473cbc4772c872ee6b89f31fde4ed0279a5c25d5f65c043a16'
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
output = args.output.resolve()
if output.exists():
    raise SystemExit('Refusing to overwrite an existing library')
if platform.system() not in ('Darwin', 'Linux'):
    raise SystemExit('Only macOS/Linux builds are supported')
with urllib.request.urlopen(URL, timeout=60) as response:
    archive = response.read()
with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
    source = zipped.read('sqlite-amalgamation-3530400/sqlite3.c')
if hashlib.sha3_256(source).hexdigest() != SOURCE_SHA3:
    raise SystemExit('SQLite source fingerprint mismatch')
with tempfile.TemporaryDirectory(prefix='evsolar-sqlite-') as temporary:
    path = Path(temporary) / 'sqlite3.c'
    path.write_bytes(source)
    built = Path(temporary) / 'library'
    mode = '-dynamiclib' if platform.system() == 'Darwin' else '-shared'
    subprocess.run(['cc', '-O2', '-fPIC', mode,
                    '-DSQLITE_THREADSAFE=1', '-DSQLITE_ENABLE_COLUMN_METADATA',
                    '-DSQLITE_ENABLE_FTS5', '-DSQLITE_ENABLE_RTREE',
                    str(path), '-lm', '-o', str(built)], check=True)
    # Exclusive creation prevents accidental replacement of another artifact.
    with output.open('xb') as target:
        target.write(built.read_bytes())
print(f'SQLite {VERSION}: {output}')
print('SHA256:', hashlib.sha256(output.read_bytes()).hexdigest())
print('For isolated tests only, set DENO_SQLITE_PATH to this absolute path.')
