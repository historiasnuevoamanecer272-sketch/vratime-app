import importlib.util
import pathlib
import smtplib
import unittest

path = pathlib.Path(__file__).with_name('vratime-contact-mailer.py')
if not path.exists():
    raise AssertionError('RED: contact email worker is missing')
spec = importlib.util.spec_from_file_location('mailer', path)
mailer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mailer)
CONFIG = dict(supabase_url='https://kuoflaaankpjksyssfka.supabase.co', supabase_service_key='test-key', smtp_host='smtp.gmail.com', smtp_port=587, smtp_user='sender@example.invalid', smtp_password='test-password', from_email='sender@example.invalid', from_name='VratiMe App')
JOB = dict(id='10000000-0000-0000-0000-000000000001', lease_token='lease', email='receiver@example.invalid', payload=dict(language='ru', category='Банки', partner_name='Автор', partner_contacts=[dict(messenger_type='tg', contact_value='@example')]))

class SMTP:
    failure = None
    sent = []
    def __init__(self, *args, **kwargs): pass
    def ehlo(self): pass
    def starttls(self, **kwargs): pass
    def login(self, *args): pass
    def quit(self): pass
    def close(self): pass
    def send_message(self, msg, **kwargs):
        if self.failure: raise self.failure
        self.sent.append(msg)
        return {}

class EmailTests(unittest.TestCase):
    def setUp(self):
        SMTP.failure = None
        SMTP.sent = []
        self.calls = []
    def rpc(self, name, args):
        self.calls.append((name, args))
        return True
    def test_private_contacts_and_exact_instruction(self):
        msg = mailer.message(CONFIG, JOB)
        self.assertEqual(msg['To'], JOB['email'])
        self.assertIn('Свяжитесь по указанным контактам в течение 24 ч.', msg.get_content())
        self.assertIn('@example', msg.get_content())
        self.assertIn('https://vratime.vzdigital.online/', msg.get_content())
        self.assertNotIn('test-password', msg.as_string())
    def test_all_five_languages(self):
        for lang in ('ru','en','me','fr','de'):
            msg = mailer.message(CONFIG, {**JOB, 'payload':{**JOB['payload'], 'language':lang}})
            self.assertIn('24', msg.get_content())
    def test_header_injection_refused(self):
        with self.assertRaises(ValueError): mailer.message(CONFIG, {**JOB, 'email':'a@b\r\nBcc: evil@example.invalid'})
    def test_success_receipt_only_after_acceptance(self):
        self.assertEqual(mailer.deliver(CONFIG, JOB, self.rpc, SMTP), 'sent')
        self.assertEqual(len(SMTP.sent), 1)
        self.assertEqual(self.calls[-1][1]['delivery_status'], 'sent')
        self.assertTrue(self.calls[-1][1]['delivery_receipt'].startswith('smtp_accepted:'))
    def test_explicit_rejection_records_failed(self):
        SMTP.failure=smtplib.SMTPDataError(550,b'rejected private server info')
        self.assertEqual(mailer.deliver(CONFIG, JOB, self.rpc, SMTP), 'failed')
        self.assertNotIn('private server info', str(self.calls))
    def test_unknown_acceptance_held(self):
        SMTP.failure=TimeoutError('recipient and secret must never leak')
        self.assertEqual(mailer.deliver(CONFIG, JOB, self.rpc, SMTP), 'ambiguous')
        self.assertNotIn('recipient and secret', str(self.calls))
    def test_receipt_failure_does_not_send_again(self):
        def broken(*args): raise ConnectionError('private response')
        self.assertEqual(mailer.deliver(CONFIG, JOB, broken, SMTP), 'receipt_pending')
        self.assertEqual(len(SMTP.sent),1)
    def test_missing_config_does_not_claim(self):
        self.assertEqual(mailer.run_once({}, self.rpc, SMTP), {'configured':False,'processed':0})
        self.assertEqual(self.calls, [])
    def test_no_jobs_does_not_send(self):
        self.assertEqual(mailer.run_once(CONFIG, lambda *args:None, SMTP)['processed'],0)
        self.assertEqual(SMTP.sent,[])
    def test_bounded_batch_stops_on_uncertain_send(self):
        SMTP.failure=TimeoutError()
        def rpc(name,args):
            self.calls.append((name,args))
            return JOB if name=='claim_listing_contact_email' else True
        self.assertEqual(mailer.run_once(CONFIG,rpc,SMTP)['processed'],1)
        self.assertEqual(sum(name=='claim_listing_contact_email' for name,_ in self.calls),1)

if __name__ == '__main__': unittest.main()
