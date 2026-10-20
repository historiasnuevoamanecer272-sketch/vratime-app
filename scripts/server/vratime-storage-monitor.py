#!/usr/bin/env python3
"""Observe media-dry only; alert against an operational budget, never delete media."""
import contextlib
import datetime
import importlib.util
import json
import math
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

CONFIG = '/root/vratime-release-20261019/vratime-secrets.env'
WORKER = pathlib.Path(__file__).with_name('vratime-workers.py')
STATE = pathlib.Path('/var/lib/vratime-storage-monitor/alert.json')
DEFAULT_BUDGET = 104857600  # 100 MiB operational target; not a provider plan quota.
COOLDOWN = 86400


def budget_from_env(values):
    raw = values.get('VRATIME_STORAGE_BUDGET_BYTES', str(DEFAULT_BUDGET))
    if not isinstance(raw, str) or not re.fullmatch(r'[1-9][0-9]{0,17}', raw):
        raise ValueError('invalid_operational_budget')
    return int(raw)


def parse_measurement(result):
    if (not isinstance(result, dict) or result.get('job') != 'media-dry'
            or type(result.get('http')) is not int or not 200 <= result['http'] < 300
            or result.get('mode') != 'dry-run' or type(result.get('cleanupDeleted')) is not int
            or result['cleanupDeleted'] != 0):
        raise ValueError('invalid_dry_measurement')
    for key in ('storageBytes', 'unknownObjects'):
        if type(result.get(key)) is not int or not 0 <= result[key] <= 2 ** 63 - 1:
            raise ValueError('invalid_storage_measurement')
    return {'storageBytes': result['storageBytes'], 'unknownObjects': result['unknownObjects']}


def read_measurement():
    result = subprocess.run([sys.executable, str(WORKER), 'media-dry'],
                            capture_output=True, text=True, timeout=75, check=False)
    if result.returncode != 0 or len(result.stdout) > 65536:
        raise ValueError('worker_failed')
    return parse_measurement(json.loads(result.stdout))


def threshold_for(size, budget):
    return 95 if size * 100 >= budget * 95 else 80 if size * 100 >= budget * 80 else 0


def summarize(measurement, budget):
    size, unknown = measurement['storageBytes'], measurement['unknownObjects']
    return {'knownStorageBytes': size, 'unknownObjects': unknown,
            'storageMeasurementComplete': unknown == 0, 'operationalBudgetBytes': budget,
            'knownStorageBudgetPercent': round(size * 100 / budget, 2),
            'thresholdPercent': threshold_for(size, budget), 'traffic': 'not_measured'}


def alert_text(summary, threshold):
    return ('VratiMe storage: ' + str(threshold) + '% operational budget threshold reached.\n'
            + 'Known storage: ' + str(summary['knownStorageBytes']) + ' bytes; operational budget: '
            + str(summary['operationalBudgetBytes']) + ' bytes (not a plan quota).\n'
            + 'Objects with unknown size: ' + str(summary['unknownObjects'])
            + ('; measurement is incomplete.\n' if summary['unknownObjects'] else '.\n')
            + 'Traffic is not measured. No media was deleted by this monitor.')


def credentials(values):
    token = values.get('VRATIME_TELEGRAM_BOT_TOKEN', '')
    chat = values.get('VRATIME_TELEGRAM_CHAT_ID', '')
    if not re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{30,100}', token):
        raise ValueError('bot_token_missing')
    if not re.fullmatch(r'-?[1-9][0-9]{0,19}', chat):
        raise ValueError('bot_chat_missing')
    return token, chat


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def send_telegram(values, message):
    token, chat = credentials(values)
    # This URL contains a secret: never print request objects or exception messages.
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage',
                                     data=json.dumps({'chat_id': chat, 'text': message}).encode(),
                                     headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
        raw = response.read(16385)
        if response.status != 200 or len(raw) > 16384:
            raise ValueError('bot_ack_invalid')
    result = json.loads(raw)
    if (not isinstance(result, dict) or result.get('ok') is not True
            or not isinstance(result.get('result'), dict)
            or type(result['result'].get('message_id')) is not int):
        raise ValueError('bot_ack_invalid')


def private_file(path):
    meta = path.lstat()
    if not stat.S_ISREG(meta.st_mode):
        raise ValueError('state_not_regular')
    if os.name == 'posix' and (meta.st_uid != os.getuid() or stat.S_IMODE(meta.st_mode) & 0o077):
        raise ValueError('state_not_private')


@contextlib.contextmanager
def state_lock(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    meta = path.parent.lstat()
    if not stat.S_ISDIR(meta.st_mode):
        raise ValueError('state_directory_invalid')
    if os.name == 'posix' and (meta.st_uid != os.getuid() or stat.S_IMODE(meta.st_mode) & 0o077):
        raise ValueError('state_directory_not_private')
    descriptor = os.open(str(path.parent / 'alert.lock'),
                         os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'a') as lock:
        if os.name == 'posix':
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        yield


def load_state(path):
    if not path.exists():
        if path.is_symlink():
            raise ValueError('state_invalid')
        return None
    private_file(path)
    try:
        with path.open(encoding='utf-8') as source:
            raw = source.read(8193)
        value = json.loads(raw) if len(raw) <= 8192 else None
        if (not isinstance(value, dict) or type(value.get('threshold')) is not int
                or value['threshold'] not in (80, 95)
                or type(value.get('lastAttempt')) not in (int, float)
                or not math.isfinite(value['lastAttempt']) or value['lastAttempt'] < 0
                or value.get('outcome') not in ('pending', 'sent', 'ambiguous')):
            raise ValueError('state_invalid')
        return value
    except (ValueError, TypeError, OverflowError):
        raise ValueError('state_invalid') from None


def save_state(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix='.alert-', dir=str(path.parent))
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name == 'posix':
            directory = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def alert_if_needed(summary, path, values, now):
    threshold = summary['thresholdPercent']
    if not threshold:
        return 'below_threshold'
    credentials(values)
    with state_lock(path):
        previous = load_state(path)
        if previous and (threshold <= previous['threshold'] or now - previous['lastAttempt'] < COOLDOWN):
            return 'suppressed'
        # Durable reservation precedes the network call. A crash or ambiguous ack
        # consumes this threshold too; no automatic repeat can duplicate the alert.
        state = {'threshold': threshold, 'lastAttempt': now, 'outcome': 'pending'}
        save_state(path, state)
        try:
            send_telegram(values, alert_text(summary, threshold))
            state['outcome'] = 'sent'
        except Exception:
            state['outcome'] = 'ambiguous'
        save_state(path, state)
        return state['outcome']


def secure_config():
    spec = importlib.util.spec_from_file_location('vratime_workers', WORKER)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    worker.CONFIG = CONFIG
    return worker.config()


def main():
    try:
        values = secure_config()
        budget_values = dict(values)
        if 'VRATIME_STORAGE_BUDGET_BYTES' in os.environ:
            budget_values['VRATIME_STORAGE_BUDGET_BYTES'] = os.environ['VRATIME_STORAGE_BUDGET_BYTES']
        summary = summarize(read_measurement(), budget_from_env(budget_values))
        summary['alert'] = alert_if_needed(summary, STATE, values, time.time())
        summary['at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        print(json.dumps(summary), flush=True)
        return 1 if summary['alert'] == 'ambiguous' else 0
    except Exception as error:
        print(json.dumps({'job': 'storage-monitor', 'error': type(error).__name__}), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
