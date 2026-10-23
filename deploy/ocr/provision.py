#!/usr/bin/env python3
"""Provision Alarmat's isolated OCR container; does not restart the API."""
import os
from pathlib import Path
import secrets
import shutil
import subprocess

IMAGE = os.environ.get('ALARMAT_OCR_IMAGE', 'alarmat-ocr-local:20261024')
READER = os.environ.get('ALARMAT_OCR_READER', 'local')
ROOT = Path(__file__).resolve().parents[2]
if READER not in ('local', 'remote'):
    raise ValueError('ALARMAT_OCR_READER must be local or remote')

def private_write(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)

assert os.geteuid() == 0, 'Run as root'
# Never inspect another application's configuration or borrow its credentials.
subprocess.run(['docker', 'image', 'inspect', IMAGE], check=True, stdout=subprocess.DEVNULL)
config = Path('/etc/alarmat')
config.mkdir(mode=0o700, exist_ok=True)
provider_env = config / 'ocr-provider.env'
if READER == 'remote' and not provider_env.exists():
    raise RuntimeError('Configure an independent AlarmaT OCR provider before selecting remote mode')
node_env = config / 'ocr.env'
if node_env.exists():
    token = dict(line.split('=', 1) for line in node_env.read_text().splitlines() if '=' in line)['ALARMAT_OCR_TOKEN']
else:
    token = secrets.token_urlsafe(48)
private_write(node_env, f'ALARMAT_OCR_URL=http://127.0.0.1:18788\nALARMAT_OCR_TOKEN={token}\n')
private_write(config / 'ocr-container.env', f'ALARMAT_OCR_TOKEN={token}\nPYTHONPATH=/srv:/adapter\nALARMAT_OCR_READER={READER}\nTRACEPAY_OCR_MODE=api\nTRACEPAY_WORKERS=1\nTRACEPAY_PROVIDER_TIMEOUT_S=45\n')
data = Path('/var/lib/alarmat/ocr')
data.mkdir(mode=0o700, exist_ok=True)
os.chown(data, 10001, 10001)
adapter = Path('/opt/alarmat/ocr')
adapter.mkdir(mode=0o755, exist_ok=True)
for name in ('alarmat_ocr.py', 'local_receipt.py'):
    shutil.copy2(ROOT / 'ocr' / name, adapter / name)
    os.chmod(adapter / name, 0o644)
dropin = Path('/etc/systemd/system/alarmat.service.d')
dropin.mkdir(exist_ok=True)
(dropin / 'ocr.conf').write_text('[Service]\nEnvironmentFile=/etc/alarmat/ocr.env\n')
subprocess.run(['systemctl', 'daemon-reload'], check=True)
existing = subprocess.run(['docker', 'container', 'inspect', 'alarmat-ocr'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if existing.returncode == 0:
    subprocess.run(['docker', 'rm', '-f', 'alarmat-ocr'], check=True, stdout=subprocess.DEVNULL)
subprocess.run([
    'docker', 'run', '-d', '--name', 'alarmat-ocr', '--restart', 'unless-stopped',
    '--user', '10001:10001', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--memory', '1500m', '--cpus', '2',
    '--pids-limit', '128', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2',
    '-p', '127.0.0.1:18788:8788',
    *(['--env-file', str(provider_env)] if READER == 'remote' else []),
    '--env-file', str(config / 'ocr-container.env'),
    '-v', f'{data}:/data', '-v', f'{adapter}:/adapter:ro',
    '--entrypoint', 'python', IMAGE, '-m', 'uvicorn', 'alarmat_ocr:app',
    '--host', '0.0.0.0', '--port', '8788', '--no-access-log',
], check=True, stdout=subprocess.DEVNULL)
print('Alarmat OCR provisioned at 127.0.0.1:18788; API environment ready (API not restarted).')
