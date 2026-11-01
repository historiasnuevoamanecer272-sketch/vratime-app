#!/usr/bin/env python3
"""Private VratiMe contact emails; SMTP acknowledgements are recorded separately."""
import argparse
import email.utils
from email.message import EmailMessage
import json
import os
import re
import smtplib
import ssl
import stat
import urllib.request

CONFIG = '/etc/vratime-mailer/config.json'
BASE = 'https://kuoflaaankpjksyssfka.supabase.co'
APP = 'https://vratime.vzdigital.online/'
COPY = {
    'ru': ('VratiMe: проявлен интерес', 'Свяжитесь по указанным контактам в течение 24 ч.', 'Объявление', 'Участник', 'Контакты также доступны в разделе «Сделки». Через 24 часа там можно отметить результат. Объявление завершает только автор.'),
    'en': ('VratiMe: interest expressed', 'Please use these contact details to get in touch within 24 hours.', 'Listing', 'Participant', 'These contacts are also in Deals. After 24 hours you can record the outcome there. Only the author can complete the listing.'),
    'me': ('VratiMe: iskazano interesovanje', 'Kontaktirajte se putem navedenih kontakata u roku od 24 sata.', 'Oglas', 'Učesnik', 'Kontakti su dostupni i u Dogovorima. Nakon 24 sata tamo možete unijeti ishod. Samo autor može završiti oglas.'),
    'fr': ('VratiMe : intérêt manifesté', 'Contactez-vous aux coordonnées indiquées dans les 24 heures.', 'Annonce', 'Participant', 'Ces coordonnées sont aussi dans Échanges. Après 24 heures, vous pourrez y indiquer le résultat. Seul l’auteur peut terminer l’annonce.'),
    'de': ('VratiMe: Interesse bekundet', 'Nehmen Sie innerhalb von 24 Stunden über diese Kontaktdaten Kontakt auf.', 'Anzeige', 'Teilnehmer', 'Die Kontakte stehen auch unter Übergaben. Nach 24 Stunden können Sie dort das Ergebnis angeben. Nur der Autor kann die Anzeige abschließen.'),
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None

def configured(values):
    return bool(values.get('supabase_url') == BASE and values.get('smtp_host') == 'smtp.gmail.com'
                and values.get('smtp_port') == 587 and all(values.get(key) for key in
                ('supabase_service_key', 'smtp_user', 'smtp_password', 'from_email', 'from_name')))

def load_config():
    meta = os.stat(CONFIG, follow_symlinks=False)
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or stat.S_IMODE(meta.st_mode) & 0o077:
        raise ValueError('private_config_permissions')
    with open(CONFIG, encoding='utf-8') as source:
        values = json.load(source)
    if not configured(values):
        raise ValueError('email_unconfigured')
    return values

def message(values, job):
    for address in (job['email'], values['from_email']):
        if not isinstance(address, str) or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', address):
            raise ValueError('invalid_email')
    payload = job['payload']
    lang = str(payload.get('language','ru')).lower().split('-')[0]
    copy = COPY.get(lang, COPY['en'])
    clean = lambda value: str(value or '').replace('\r',' ').replace('\n',' ')[:200]
    body = [copy[1], '', f"{copy[2]}: {clean(payload.get('category'))}", f"{copy[3]}: {clean(payload.get('partner_name'))}", '']
    for contact in (payload.get('partner_contacts') or [])[:5]:
        body.append(f"{clean(contact.get('messenger_type')).upper()}: {clean(contact.get('contact_value'))}")
    body.extend(['',copy[4],APP])
    msg = EmailMessage()
    msg['From'] = email.utils.formataddr((values['from_name'],values['from_email']))
    msg['To'] = job['email']
    msg['Subject'] = copy[0]
    msg['Date'] = email.utils.formatdate(localtime=False)
    msg['Message-ID'] = f"<vratime-contact-{job['id']}@vratime.vzdigital.online>"
    msg.set_content('\n'.join(body))
    return msg

def connect(values, factory=smtplib.SMTP):
    smtp = factory(values['smtp_host'], values['smtp_port'], timeout=25)
    try:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(values['smtp_user'], values['smtp_password'])
        return smtp
    except Exception:
        smtp.close()
        raise

def deliver(values, job, rpc, factory=smtplib.SMTP):
    smtp = None
    status, receipt = 'ambiguous', 'unknown_acceptance'
    try:
        msg = message(values, job)
        smtp = connect(values, factory)
        refused = smtp.send_message(msg, from_addr=values['from_email'], to_addrs=[job['email']])
        if refused:
            status, receipt = 'failed', 'recipient_rejected'
        else:
            status, receipt = 'sent', 'smtp_accepted:' + str(msg['Message-ID'])
    except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused, smtplib.SMTPNotSupportedError, ValueError) as error:
        status, receipt = 'failed', type(error).__name__
    except Exception as error:
        # Timeout/disconnect can happen after DATA acceptance. Never blindly resend.
        status, receipt = 'ambiguous', type(error).__name__
    finally:
        if smtp is not None:
            try: smtp.quit()
            except Exception: smtp.close()
    try:
        recorded = rpc('finish_listing_contact_email', dict(job_id=job['id'],token=job['lease_token'],delivery_status=status,delivery_receipt=receipt))
        return status if recorded is True else 'receipt_pending'
    except Exception:
        return 'receipt_pending'

def make_rpc(values):
    def rpc(name, args):
        if name not in ('claim_listing_contact_email','finish_listing_contact_email'):
            raise ValueError('unknown_rpc')
        request = urllib.request.Request(BASE+'/rest/v1/rpc/'+name, data=json.dumps(args).encode(),
            headers={'Content-Type':'application/json','apikey':values['supabase_service_key'],'Authorization':'Bearer '+values['supabase_service_key']}, method='POST')
        with urllib.request.build_opener(NoRedirect).open(request,timeout=25) as response:
            raw = response.read(65537)
        if len(raw)>65536: raise ValueError('response_too_large')
        return json.loads(raw)
    return rpc

def run_once(values, rpc=None, factory=smtplib.SMTP):
    if not configured(values): return {'configured':False,'processed':0}
    rpc = rpc or make_rpc(values)
    result = {'configured':True,'processed':0,'sent':0}
    for _ in range(5):
        job = rpc('claim_listing_contact_email',{})
        if not job: break
        status = deliver(values,job,rpc,factory)
        result['processed'] += 1
        if status=='sent': result['sent'] += 1
        else:
            result['stopped'] = status
            break
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    args = parser.parse_args()
    try:
        values = load_config()
        if args.check:
            smtp=connect(values)
            smtp.quit()
            result={'configured':True,'smtp_authenticated':True,'messages_sent':0}
        else: result=run_once(values)
        print(json.dumps(result))
        return 0
    except Exception as error:
        # Do not print exceptions/HTTP bodies; they can contain addresses or secrets.
        print(json.dumps({'error':type(error).__name__}))
        return 1

if __name__=='__main__': raise SystemExit(main())
