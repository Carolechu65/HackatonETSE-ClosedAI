#!/usr/bin/env python3
"""Provision Alarmat's isolated OCR container; does not restart the API."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

IMAGE = 'sha256:3f8c4e369c0dc3723d78151378582f6ced28d041a4c4d75d41e861c9b6d1aa84'
ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {
    'HELMCODE_API_KEY', 'HELMCODE_URL', 'TRACE_HELMCODE_BASE_URL',
    'GEMINI_API_KEY', 'TYPESAFE_API_KEY', 'TRACEPAY_VISION_PROVIDERS',
    'TRACEPAY_TEXT_PROVIDERS', 'TRACEPAY_HELMCODE_VISION_MODELS',
    'TRACEPAY_HELMCODE_TEXT_MODEL', 'TRACEPAY_GEMINI_MODEL', 'TRACEPAY_JEV_MODEL',
    'TRACEPAY_VLM_URL', 'TRACEPAY_VLM_MODEL', 'TRACEPAY_VLM_API_KEY',
    'TRACEPAY_TEXT_URL', 'TRACEPAY_TEXT_MODEL', 'TRACEPAY_TEXT_API_KEY',
}

def private_write(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(text)

assert os.geteuid() == 0, 'Run as root'
source = json.loads(subprocess.check_output(['docker', 'inspect', 'trace-it-backend-1']))[0]
assert source['Image'] == IMAGE, 'Source image changed; inspect and deliberately repin first'
env = dict(item.split('=', 1) for item in source['Config']['Env'])
config = Path('/etc/alarmat')
config.mkdir(mode=0o700, exist_ok=True)
private_write(config / 'ocr-provider.env', ''.join(f'{key}={env[key]}\n' for key in sorted(ALLOWED) if env.get(key)))
node_env = config / 'ocr.env'
if node_env.exists():
    token = dict(line.split('=', 1) for line in node_env.read_text().splitlines() if '=' in line)['ALARMAT_OCR_TOKEN']
else:
    token = secrets.token_urlsafe(48)
private_write(node_env, f'ALARMAT_OCR_URL=http://127.0.0.1:18788\nALARMAT_OCR_TOKEN={token}\n')
private_write(config / 'ocr-container.env', f'ALARMAT_OCR_TOKEN={token}\nPYTHONPATH=/srv:/adapter\nTRACEPAY_OCR_MODE=api\nTRACEPAY_WORKERS=1\nTRACEPAY_PROVIDER_TIMEOUT_S=45\n')
data = Path('/var/lib/alarmat/ocr')
data.mkdir(mode=0o700, exist_ok=True)
os.chown(data, 10001, 10001)
adapter = Path('/opt/alarmat/ocr')
adapter.mkdir(mode=0o755, exist_ok=True)
shutil.copy2(ROOT / 'ocr/alarmat_ocr.py', adapter / 'alarmat_ocr.py')
os.chmod(adapter / 'alarmat_ocr.py', 0o644)
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
    '--env-file', str(config / 'ocr-provider.env'),
    '--env-file', str(config / 'ocr-container.env'),
    '-v', f'{data}:/data', '-v', f'{adapter}:/adapter:ro',
    '--entrypoint', 'python', IMAGE, '-m', 'uvicorn', 'alarmat_ocr:app',
    '--host', '0.0.0.0', '--port', '8788', '--no-access-log',
], check=True, stdout=subprocess.DEVNULL)
print('Alarmat OCR provisioned at 127.0.0.1:18788; API environment ready (API not restarted).')
