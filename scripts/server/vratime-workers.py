#!/usr/bin/env python3
"""Call only VratiMe's bounded workers; credentials never enter argv or logs."""
import argparse
import datetime
import json
import os
import re
import stat
import urllib.error
import urllib.request

CONFIG = '/root/vratime-release-20261019/vratime-secrets.env'
BASE = 'https://kuoflaaankpjksyssfka.supabase.co/functions/v1/'
JOBS = {
    'dispatch': ('notifications-dispatch', 'NOTIFICATIONS_SECRET', 'X-Scheduler-Secret', {'action': 'dispatch'}),
    'digest': ('daily-digest', 'DAILY_DIGEST_SECRET', 'X-Scheduler-Secret', {}),
    'feedback': ('feedback-telegram-worker', 'FEEDBACK_WORKER_SECRET', 'X-Feedback-Worker-Secret', {}),
    'media-dry': ('media-maintenance', 'MEDIA_MAINTENANCE_SECRET', 'X-Media-Maintenance-Secret', {'mode': 'dry-run'}),
    'media-run': ('media-maintenance', 'MEDIA_MAINTENANCE_SECRET', 'X-Media-Maintenance-Secret', {'mode': 'run'}),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def config():
    meta = os.stat(CONFIG, follow_symlinks=False)
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or stat.S_IMODE(meta.st_mode) & 0o077:
        raise ValueError('private_config_permissions')
    values = {}
    with open(CONFIG, encoding='utf-8') as source:
        for line in source:
            match = re.fullmatch(r'([A-Z0-9_]+)=(.*)', line.strip())
            if match:
                values[match[1]] = match[2].strip().strip('\"\'')
    return values


def emit(job, status, **fields):
    print(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      'job': job, 'http': status, **fields}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job', choices=JOBS)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        values = config()
        endpoint, key, header, body = JOBS[args.job]
        secret = values.get(key, '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', secret):
            raise ValueError('scheduler_secret_missing')
        if args.check:
            emit(args.job, None, configured=True, execution=False)
            return 0
        request = urllib.request.Request(BASE + endpoint, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json', header: secret}, method='POST')
        try:
            response = urllib.request.build_opener(NoRedirect).open(request, timeout=55)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status = response.status
            raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError('worker_response_limit')
        result = json.loads(raw)
        safe = {key: result[key] for key in ('status', 'processed', 'accepted', 'failures', 'delivered')
                if key in result and isinstance(result[key], (int, str, bool))}
        if args.job.startswith('media'):
            safe.update(mode=result.get('mode'), cleanupDeleted=result.get('cleanup', {}).get('deleted'),
                        storageBytes=result.get('storage', {}).get('knownBytes'),
                        unknownObjects=result.get('storage', {}).get('unknownObjects'),
                        traffic=result.get('traffic', {}).get('status'), alert=result.get('alert', {}).get('delivery'))
        if isinstance(result.get('error'), str) and re.fullmatch(r'[a-z0-9_]{1,80}', result['error']):
            safe['error'] = result['error']
        emit(args.job, status, **safe)
        return 0 if 200 <= status < 300 else 1
    except Exception as error:
        # Exception messages can contain request information. Log only a class.
        emit(args.job, None, error=type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
