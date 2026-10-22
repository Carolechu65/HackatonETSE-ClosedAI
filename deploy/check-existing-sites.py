#!/usr/bin/env python3
"""Read-only comparison of status/redirects against the pre-deployment baseline."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)
baseline = json.loads(Path(sys.argv[1]).read_text())
failures = []
for expected in baseline:
    try:
        response = opener.open(expected['url'], timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    except Exception as error:
        failures.append({'url': expected['url'], 'error': str(error)})
        continue
    actual = {
        'url': expected['url'], 'status': response.code,
        'location': response.headers.get('location'),
        'type': response.headers.get('content-type'),
    }
    if actual != expected:
        failures.append({'before': expected, 'after': actual})
    else:
        print(f"OK {actual['status']} {actual['url']}")
if failures:
    print(json.dumps(failures, indent=2))
    sys.exit(1)
print('All existing sampled application routes match the baseline.')
