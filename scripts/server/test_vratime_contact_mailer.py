import importlib.util
import pathlib
import json
import smtplib
import unittest
from unittest.mock import patch

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
    def test_private_contacts_and_clear_followup(self):
        msg = mailer.message(CONFIG, JOB)
        self.assertEqual(msg['To'], JOB['email'])
        text = msg.get_body(preferencelist=('plain',)).get_content()
        rich = msg.get_body(preferencelist=('html',)).get_content()
        self.assertIn('ответить можно позже', text)
        self.assertNotIn('Свяжитесь по указанным контактам в течение 24 ч.', text)
        self.assertIn('@example', text)
        self.assertIn('https://vratime.vzdigital.online/', text)
        self.assertIn('href="https://t.me/example"', rich)
        self.assertIn('Написать в Telegram', rich)
        self.assertNotIn('test-password', msg.as_string())
    def test_all_five_languages(self):
        for lang in ('ru','en','me','fr','de'):
            for role in ('owner','requester','neutral'):
                msg = mailer.message(CONFIG, {**JOB, 'recipient_role':role, 'payload':{**JOB['payload'], 'language':lang}})
                self.assertIn('24', msg.get_body(preferencelist=('plain',)).get_content())
                self.assertIn(f'lang="{lang}"', msg.get_body(preferencelist=('html',)).get_content())
                self.assertIn('Банки', msg['Subject'])
    def test_distinct_roles_and_unknown_role_fallback(self):
        owner = mailer.message(CONFIG, {**JOB, 'recipient_role':'owner'})
        requester = mailer.message(CONFIG, {**JOB, 'recipient_role':'requester'})
        neutral = mailer.message(CONFIG, JOB)
        self.assertEqual(owner['Subject'], 'Автор — отклик на ваше объявление «Банки»')
        self.assertEqual(requester['Subject'], 'Контакты автора объявления «Банки»')
        self.assertEqual(neutral['Subject'], 'Контакты по объявлению «Банки»')
        self.assertIn('Вы откликнулись', requester.get_body(preferencelist=('plain',)).get_content())
    def test_html_and_subject_escape_user_content(self):
        msg = mailer.message(CONFIG, {**JOB, 'recipient_role':'owner', 'payload':{**JOB['payload'], 'category':'<img src=x onerror=alert(1)>', 'partner_name':'<script>\r\nBcc: evil@example.invalid</script>'}})
        rich = msg.get_body(preferencelist=('html',)).get_content()
        self.assertNotIn('<script>', rich)
        self.assertNotIn('<img src=x', rich)
        self.assertIn('&lt;img', rich)
        self.assertIsNone(msg['Bcc'])
        self.assertNotIn('\n', str(msg['Subject']))
    def test_contact_links_are_allowlisted_and_normalized(self):
        cases = [('tg','@valid_user','https://t.me/valid_user'), ('tg','https://t.me/valid_user','https://t.me/valid_user'), ('tg','+382 67 123 456','https://t.me/+38267123456'), ('wa','00382 67 123 456','https://wa.me/38267123456'), ('viber','+382 (67) 123-456','viber://chat?number=%2B38267123456')]
        for channel, value, expected in cases:
            self.assertEqual(mailer.contact_link(dict(messenger_type=channel, contact_value=value))[1], expected)
        for channel,value in [('tg','https://evil.invalid/foo'),('tg','@abc" onclick="evil'),('wa','javascript:alert(1)'),('viber','123'),('email','a@example.invalid')]:
            self.assertIsNone(mailer.contact_link(dict(messenger_type=channel,contact_value=value)))
    def test_language_fallback_and_blank_labels(self):
        msg=mailer.message(CONFIG,{**JOB,'payload':{'language':'unknown','category':'','partner_name':'','partner_contacts':[]}})
        self.assertEqual(msg['Subject'],'Contacts for “Listing”')
        self.assertIn('Participant',msg.get_body(preferencelist=('plain',)).get_content())
    def test_role_lookup_uses_only_exact_private_job(self):
        class Response:
            def __init__(self, rows): self.raw=json.dumps(rows).encode()
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,limit): return self.raw[:limit]
        for recipient, expected in [('owner','owner'),('requester','requester'),('stranger','neutral')]:
            with patch.object(mailer.urllib.request,'build_opener') as build:
                build.return_value.open.return_value=Response([{'recipient_id':recipient,'listing_contact_exchanges':{'owner_id':'owner','requester_id':'requester'}}])
                self.assertEqual(mailer.resolve_recipient_role(CONFIG,JOB),expected)
                request=build.return_value.open.call_args.args[0]
                self.assertTrue(request.full_url.startswith(mailer.BASE+'/rest/v1/listing_contact_email_jobs?'))
                self.assertIn(JOB['id'],request.full_url)
                self.assertNotIn('test-key',request.full_url)
        with patch.object(mailer.urllib.request,'build_opener') as build:
            build.return_value.open.side_effect=TimeoutError('private provider details')
            self.assertEqual(mailer.resolve_recipient_role(CONFIG,JOB),'neutral')
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
