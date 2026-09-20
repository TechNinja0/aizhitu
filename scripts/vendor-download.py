"""Restore exactly the pinned upstream files and verify their recorded digests."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess, hashlib, json
root = Path('vendor/drawio')
manifest = json.loads((root / 'manifest.json').read_text())
def restore(entry):
    dest = root / entry['path']
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        temp = dest.with_name(dest.name + '.download')
        try:
            subprocess.run(['curl', '-fsSL', '--compressed', '--connect-timeout', '10', '--max-time', '120', '--retry', '1', entry['source'], '-o', str(temp)], check=True)
            if hashlib.sha256(temp.read_bytes()).hexdigest() != entry['sha256']:
                raise RuntimeError('Digest mismatch: ' + entry['path'])
            temp.replace(dest)
        finally:
            temp.unlink(missing_ok=True)
    if hashlib.sha256(dest.read_bytes()).hexdigest() != entry['sha256']:
        raise RuntimeError('Digest mismatch: ' + entry['path'])
    print('Verified', entry['path'])
with ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(restore, manifest['files']))
