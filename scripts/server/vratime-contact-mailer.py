#!/usr/bin/env python3
"""Private VratiMe contact emails; SMTP acknowledgements are recorded separately."""
import argparse
import email.utils
from email.message import EmailMessage
import html
import json
import os
import re
import smtplib
import ssl
import stat
import urllib.request
import urllib.parse

CONFIG = '/etc/vratime-mailer/config.json'
BASE = 'https://kuoflaaankpjksyssfka.supabase.co'
APP = 'https://vratime.vzdigital.online/'
COPY = {
    'ru': dict(hello='Здравствуйте!', owner_subject='{name} — отклик на ваше объявление «{title}»', requester_subject='Контакты автора объявления «{title}»', neutral_subject='Контакты по объявлению «{title}»', owner_intro='{name} интересуется вашим объявлением «{title}».', requester_intro='Вы откликнулись на объявление «{title}». Автор объявления — {name}.', neutral_intro='Теперь вам доступны контакты участника по объявлению «{title}»: {name}.', arrange='Свяжитесь, чтобы договориться о количестве, месте и удобном времени передачи.', followup='Через 24 часа в разделе «Сделки» появится вопрос «Как всё прошло?». Если вы ещё договариваетесь, ответить можно позже.', footer='Контакты сохранятся в «Сделках». Объявление останется активным, пока автор сам его не завершит.', write='Написать в {channel}', open='Открыть VratiMe', name='Участник', title='Объявление'),
    'en': dict(hello='Hello!', owner_subject='{name} — a response to your listing “{title}”', requester_subject='Contact the author of “{title}”', neutral_subject='Contacts for “{title}”', owner_intro='{name} is interested in your listing “{title}”.', requester_intro='You responded to “{title}”. The listing author is {name}.', neutral_intro='You can now contact the participant for “{title}”: {name}.', arrange='Get in touch to agree on the quantity, place and a convenient time for the handover.', followup='After 24 hours, “How did it go?” will appear in Deals. If you are still making arrangements, you can answer later.', footer='The contacts will stay in Deals. The listing stays active until its author completes it.', write='Message on {channel}', open='Open VratiMe', name='Participant', title='Listing'),
    'me': dict(hello='Zdravo!', owner_subject='{name} — javljanje na vaš oglas „{title}“', requester_subject='Kontakt autora oglasa „{title}“', neutral_subject='Kontakti za oglas „{title}“', owner_intro='{name} se interesuje za vaš oglas „{title}“.', requester_intro='Javili ste se na oglas „{title}“. Autor oglasa je {name}.', neutral_intro='Sada vam je dostupan kontakt učesnika za oglas „{title}“: {name}.', arrange='Javite se da dogovorite količinu, mjesto i vrijeme preuzimanja koje vam odgovara.', followup='Nakon 24 sata u odjeljku „Razmjene“ pojaviće se pitanje „Kako je prošlo?“. Ako se još dogovarate, možete odgovoriti kasnije.', footer='Kontakti ostaju u odjeljku „Razmjene“. Oglas ostaje aktivan dok ga autor ne završi.', write='Pišite preko {channel}', open='Otvori VratiMe', name='Učesnik', title='Oglas'),
    'fr': dict(hello='Bonjour !', owner_subject='{name} — réponse à votre annonce « {title} »', requester_subject='Coordonnées de l’auteur de « {title} »', neutral_subject='Contacts pour « {title} »', owner_intro='{name} s’intéresse à votre annonce « {title} ».', requester_intro='Vous avez répondu à « {title} ». L’auteur de l’annonce est {name}.', neutral_intro='Vous pouvez maintenant contacter la personne pour « {title} » : {name}.', arrange='Contactez-vous pour convenir de la quantité, du lieu et du moment de la remise.', followup='Après 24 heures, la question « Comment cela s’est-il passé ? » apparaîtra dans « Échanges ». Si vous êtes encore en train de vous organiser, vous pourrez répondre plus tard.', footer='Les coordonnées resteront dans « Échanges ». L’annonce reste active jusqu’à ce que son auteur la termine.', write='Écrire sur {channel}', open='Ouvrir VratiMe', name='Participant', title='Annonce'),
    'de': dict(hello='Hallo!', owner_subject='{name} — Antwort auf deine Anzeige „{title}“', requester_subject='Kontakt zur Anzeige „{title}“', neutral_subject='Kontakte für „{title}“', owner_intro='{name} interessiert sich für deine Anzeige „{title}“.', requester_intro='Du hast auf „{title}“ geantwortet. Die Anzeige stammt von {name}.', neutral_intro='Du kannst jetzt die Person zur Anzeige „{title}“ kontaktieren: {name}.', arrange='Vereinbart die Menge, den Ort und einen passenden Zeitpunkt für die Übergabe.', followup='Nach 24 Stunden erscheint unter „Übergaben“ die Frage „Wie ist es gelaufen?“. Wenn ihr noch plant, kannst du auch später antworten.', footer='Die Kontakte bleiben unter „Übergaben“ verfügbar. Die Anzeige bleibt aktiv, bis ihr Autor sie abschließt.', write='Über {channel} schreiben', open='VratiMe öffnen', name='Teilnehmer', title='Anzeige'),
}

def contact_link(contact):
    channel = contact.get('messenger_type')
    raw = str(contact.get('contact_value') or '').strip()
    if channel == 'tg':
        alias = re.sub(r'^https?://(?:www\.)?t\.me/', '', raw, flags=re.I).lstrip('@')
        if re.fullmatch(r'[A-Za-z0-9_]{5,32}', alias) and not alias.isdigit():
            return 'Telegram', 'https://t.me/' + alias
    if channel not in ('tg', 'wa', 'viber') or not re.fullmatch(r'\+?[\d\s().-]+', raw):
        return None
    digits = re.sub(r'\D', '', raw)
    if digits.startswith('00'): digits = digits[2:]
    if not re.fullmatch(r'[1-9][0-9]{6,14}', digits): return None
    return {'tg': ('Telegram', 'https://t.me/+' + digits), 'wa': ('WhatsApp', 'https://wa.me/' + digits), 'viber': ('Viber', 'viber://chat?number=%2B' + digits)}[channel]

def resolve_recipient_role(values, job):
    # The queue snapshot predates role-specific copy. Resolve the role from this
    # exact private job and its exchange, without changing or backfilling rows.
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', str(job.get('id', ''))): return 'neutral'
    query = urllib.parse.urlencode({'id': 'eq.' + job['id'], 'select': 'recipient_id,listing_contact_exchanges(owner_id,requester_id)'})
    request = urllib.request.Request(BASE + '/rest/v1/listing_contact_email_jobs?' + query,
        headers={'apikey': values['supabase_service_key'], 'Authorization': 'Bearer ' + values['supabase_service_key']})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            raw = response.read(65537)
        if len(raw) > 65536: return 'neutral'
        rows = json.loads(raw)
        if not isinstance(rows, list) or len(rows) != 1: return 'neutral'
        row = rows[0]
        exchange = row.get('listing_contact_exchanges') or {}
        recipient = row.get('recipient_id')
        if recipient and recipient == exchange.get('owner_id'): return 'owner'
        if recipient and recipient == exchange.get('requester_id'): return 'requester'
    except Exception:
        # A role lookup failure must not lose a queued contact notification or
        # invent the participant's role. The neutral variant remains accurate.
        pass
    return 'neutral'

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
    role = job.get('recipient_role') if job.get('recipient_role') in ('owner', 'requester') else 'neutral'
    details = dict(name=clean(payload.get('partner_name')) or copy['name'], title=clean(payload.get('category')) or copy['title'])
    intro = copy[role + '_intro'].format(**details)
    subject = copy[role + '_subject'].format(**details)
    body = [copy['hello'], '', intro, copy['arrange'], '']
    contact_html = []
    for contact in (payload.get('partner_contacts') or [])[:5]:
        link = contact_link(contact)
        if not link: continue
        channel, href = link
        label = copy['write'].format(channel=channel)
        value = clean(contact.get('contact_value'))
        body.append(f'{label}: {href}\n{value}')
        contact_html.append(f'<p style="margin:20px 0"><a href="{html.escape(href, quote=True)}" style="display:inline-block;padding:14px 20px;border-radius:12px;background:#075d63;color:#ffffff;text-decoration:none;font-weight:700">{html.escape(label)}</a><br><span style="display:inline-block;margin-top:8px;color:#435e62">{html.escape(value)}</span></p>')
    body.extend(['', copy['followup'], '', copy['footer'], '', copy['open'] + ': ' + APP])
    msg = EmailMessage()
    msg['From'] = email.utils.formataddr((values['from_name'],values['from_email']))
    msg['To'] = job['email']
    msg['Subject'] = subject
    msg['Date'] = email.utils.formatdate(localtime=False)
    msg['Message-ID'] = f"<vratime-contact-{job['id']}@vratime.vzdigital.online>"
    msg.set_content('\n'.join(body))
    msg.add_alternative(f'''<!doctype html><html lang="{lang if lang in COPY else 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:20px;background:#f3f7f6;font:16px/1.55 Arial,sans-serif;color:#173d40"><div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border-radius:18px;overflow-wrap:anywhere"><p style="font-size:20px;font-weight:700;color:#075d63;margin-top:0">VratiMe</p><p>{html.escape(copy['hello'])}</p><h1 style="font-size:22px;line-height:1.35">{html.escape(intro)}</h1><p>{html.escape(copy['arrange'])}</p>{''.join(contact_html)}<p style="padding:16px;background:#f3f7f6;border-radius:12px">{html.escape(copy['followup'])}</p><p>{html.escape(copy['footer'])}</p><p><a href="{APP}" style="color:#075d63;text-decoration:underline;font-weight:700">{html.escape(copy['open'])}</a></p></div></body></html>''', subtype='html')
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
        result = json.loads(raw)
        if name == 'claim_listing_contact_email' and isinstance(result, dict):
            result['recipient_role'] = resolve_recipient_role(values, result)
        return result
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
