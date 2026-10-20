import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock


MODULE = pathlib.Path(__file__).with_name('vratime-storage-monitor.py')
monitor = None
if MODULE.exists():
    spec = importlib.util.spec_from_file_location('storage_monitor', MODULE)
    monitor = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(monitor)


class StorageMonitorTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(monitor, 'Storage monitoring implementation is missing')
        self.tmp = tempfile.TemporaryDirectory(dir=MODULE.parent)
        self.addCleanup(self.tmp.cleanup)
        self.state = pathlib.Path(self.tmp.name) / 'monitor' / 'alert.json'
        self.values = {'VRATIME_TELEGRAM_BOT_TOKEN': '123456:' + 'a' * 35,
                       'VRATIME_TELEGRAM_CHAT_ID': '123456'}

    def payload(self, size=5 * 1024 * 1024, unknown=0, **fields):
        return {'job': 'media-dry', 'http': 200, 'mode': 'dry-run',
                'storageBytes': size, 'unknownObjects': unknown,
                'cleanupDeleted': 0, 'traffic': 'unavailable', **fields}

    def summary(self, size, unknown=0):
        return monitor.summarize(monitor.parse_measurement(self.payload(size, unknown)), 100)

    def test_operational_default_is_100_mib_and_budget_must_be_positive_integer(self):
        self.assertEqual(monitor.budget_from_env({}), 104857600)
        self.assertEqual(monitor.budget_from_env({'VRATIME_STORAGE_BUDGET_BYTES': '200'}), 200)
        for bad in ('0', '-1', '1.5', 'inf', ''):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                monitor.budget_from_env({'VRATIME_STORAGE_BUDGET_BYTES': bad})

    def test_thresholds_use_exact_bytes(self):
        for size, expected in ((0, 0), (79, 0), (80, 80), (94, 80), (95, 95), (1000, 95)):
            self.assertEqual(monitor.threshold_for(size, 100), expected)

    def test_unknown_sizes_are_explicit_and_traffic_is_never_claimed_measured(self):
        summary = self.summary(50, 2)
        self.assertFalse(summary['storageMeasurementComplete'])
        self.assertEqual(summary['unknownObjects'], 2)
        self.assertEqual(summary['knownStorageBytes'], 50)
        self.assertEqual(summary['traffic'], 'not_measured')
        text = monitor.alert_text(summary, 80)
        self.assertIn('operational budget', text)
        self.assertIn('not a plan quota', text)
        self.assertIn('unknown', text)
        self.assertIn('Traffic is not measured', text)

    def test_rejects_missing_invalid_failed_or_non_dry_measurements(self):
        bad = [self.payload(True), self.payload(-1), self.payload(2.5),
               self.payload(2, True), self.payload(http=500), self.payload(mode='run'),
               self.payload(cleanupDeleted=1), self.payload(job='media-run'), {}]
        for payload in bad:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                monitor.parse_measurement(payload)

    def test_five_mib_does_not_send_or_create_state(self):
        summary = monitor.summarize(monitor.parse_measurement(self.payload()), 104857600)
        with mock.patch.object(monitor, 'send_telegram') as send:
            self.assertEqual(monitor.alert_if_needed(summary, self.state, {}, 100000), 'below_threshold')
        send.assert_not_called()
        self.assertFalse(self.state.exists())

    def test_success_persists_and_same_threshold_never_repeats(self):
        with mock.patch.object(monitor, 'send_telegram') as send:
            self.assertEqual(monitor.alert_if_needed(self.summary(80), self.state, self.values, 100000), 'sent')
            self.assertEqual(monitor.alert_if_needed(self.summary(94), self.state, self.values, 300000), 'suppressed')
        self.assertEqual(send.call_count, 1)
        self.assertEqual(json.loads(self.state.read_text())['outcome'], 'sent')

    def test_higher_threshold_waits_24_hours(self):
        with mock.patch.object(monitor, 'send_telegram') as send:
            monitor.alert_if_needed(self.summary(80), self.state, self.values, 100000)
            self.assertEqual(monitor.alert_if_needed(self.summary(95), self.state, self.values, 186399), 'suppressed')
            self.assertEqual(monitor.alert_if_needed(self.summary(95), self.state, self.values, 186400), 'sent')
        self.assertEqual(send.call_count, 2)

    def test_ambiguous_send_is_reserved_before_network_and_not_retried(self):
        def fail(*args):
            self.assertEqual(json.loads(self.state.read_text())['outcome'], 'pending')
            raise TimeoutError('https://api.telegram.org/botSECRET/sendMessage')
        with mock.patch.object(monitor, 'send_telegram', side_effect=fail) as send:
            self.assertEqual(monitor.alert_if_needed(self.summary(80), self.state, self.values, 100000), 'ambiguous')
            self.assertEqual(monitor.alert_if_needed(self.summary(80), self.state, self.values, 300000), 'suppressed')
        self.assertEqual(send.call_count, 1)
        self.assertNotIn('SECRET', self.state.read_text())

    def test_invalid_state_fails_closed_without_network(self):
        self.state.parent.mkdir()
        self.state.write_text('{broken')
        with mock.patch.object(monitor, 'send_telegram') as send, self.assertRaises(ValueError):
            monitor.alert_if_needed(self.summary(95), self.state, self.values, 100000)
        send.assert_not_called()

    def test_missing_credentials_do_not_consume_threshold(self):
        with self.assertRaises(ValueError):
            monitor.alert_if_needed(self.summary(80), self.state, {}, 100000)
        self.assertFalse(self.state.exists())

    def test_worker_subprocess_only_uses_media_dry_and_does_not_pass_secrets(self):
        result = subprocess.CompletedProcess([], 0, json.dumps(self.payload()), '')
        with mock.patch.object(monitor.subprocess, 'run', return_value=result) as run:
            monitor.read_measurement()
        args = run.call_args.args[0]
        self.assertEqual(args[-1], 'media-dry')
        self.assertEqual(len(args), 3)
        self.assertNotIn('SECRET', ' '.join(args))

    def test_failed_worker_does_not_accept_apparently_valid_output(self):
        result = subprocess.CompletedProcess([], 1, json.dumps(self.payload()), 'secret')
        with mock.patch.object(monitor.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
            monitor.read_measurement()

    def test_main_logs_only_exception_class_when_url_contains_token(self):
        output = io.StringIO()
        with mock.patch.object(monitor, 'secure_config', side_effect=TimeoutError('https://botSECRET/')):
            with mock.patch('sys.stdout', output):
                self.assertEqual(monitor.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), {'job': 'storage-monitor', 'error': 'TimeoutError'})
        self.assertNotIn('SECRET', output.getvalue())

    def test_telegram_requires_positive_ack_and_uses_json_not_url_payload(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"ok":true,"result":{"message_id":42}}'
        opener = mock.Mock()
        opener.open.return_value = response
        with mock.patch.object(monitor.urllib.request, 'build_opener', return_value=opener):
            monitor.send_telegram(self.values, 'storage alert')
            request = opener.open.call_args.args[0]
            self.assertEqual(json.loads(request.data)['text'], 'storage alert')
            self.assertNotIn('storage alert', request.full_url)
            response.read.return_value = b'{"ok":false}'
            with self.assertRaises(ValueError):
                monitor.send_telegram(self.values, 'storage alert')


if __name__ == '__main__':
    unittest.main()
