#!/usr/bin/env python3
"""Private Telegram support inbox. SQLite/outbox stay on the owned VPS, never in Git."""
import json
import os
import pathlib
import re
import sqlite3
import time
import urllib.error
import urllib.request

COPY = {
    'ru': ('Поддержка VratiMe. Опишите проблему и при необходимости приложите фото до 5 МБ. Не отправляйте пароли, коды входа и документы. Ответ придёт сюда. /status — статус обращения.', 'Обращение №{} получено. Ответим в этом чате.', 'Обращений пока нет.', 'Отправьте текст до 3000 символов или фото до 5 МБ. Видео и файлы не принимаются.', 'Подождите минуту перед следующим сообщением.', 'Статус обращения №{}: {}', ('Получено', 'В работе', 'Нужны сведения', 'Решено')),
    'en': ('VratiMe support. Describe the issue and optionally attach a photo up to 5 MB. Do not send passwords, login codes or identity documents. We will reply here. /status — ticket status.', 'Ticket #{} received. We will reply in this chat.', 'No tickets yet.', 'Send text up to 3000 characters or a photo up to 5 MB. Videos and files are not accepted.', 'Please wait a minute before sending another message.', 'Ticket #{}: {}', ('Received', 'In progress', 'More information needed', 'Resolved')),
    'fr': ('Assistance VratiMe. Décrivez le problème et joignez éventuellement une photo de 5 Mo maximum. Aucun mot de passe, code de connexion ou document d’identité. Réponse ici. /status — statut.', 'Demande n°{} reçue. Nous répondrons ici.', 'Aucune demande.', 'Texte de 3000 caractères ou photo de 5 Mo maximum. Les vidéos et fichiers ne sont pas acceptés.', 'Veuillez patienter une minute.', 'Demande n°{} : {}', ('Reçue', 'En cours', 'Informations nécessaires', 'Résolue')),
    'de': ('VratiMe Hilfe. Beschreiben Sie das Problem, optional mit einem Foto bis 5 MB. Keine Passwörter, Anmeldecodes oder Ausweisdokumente senden. Antwort hier. /status — Bearbeitungsstand.', 'Anfrage Nr. {} erhalten. Wir antworten hier.', 'Noch keine Anfragen.', 'Text bis 3000 Zeichen oder Foto bis 5 MB. Keine Videos oder Dateien.', 'Bitte warten Sie eine Minute.', 'Anfrage Nr. {}: {}', ('Erhalten', 'In Bearbeitung', 'Rückfrage', 'Gelöst')),
    'me': ('VratiMe podrška. Opišite problem i po želji dodajte fotografiju do 5 MB. Ne šaljite lozinke, kodove za prijavu ili lična dokumenta. Odgovaramo ovdje. /status — status zahtjeva.', 'Zahtjev #{} je primljen. Odgovorićemo ovdje.', 'Još nema zahtjeva.', 'Tekst do 3000 znakova ili fotografija do 5 MB. Video i dokumenti nisu podržani.', 'Sačekajte minut prije naredne poruke.', 'Zahtjev #{}: {}', ('Primljen', 'U obradi', 'Potrebne informacije', 'Riješen')),
}
STATES = ('received', 'reviewing', 'waiting', 'resolved')
BUTTONS = {
    'ru': ('Написать в поддержку', 'Мои обращения', 'Как это работает', 'Планируем ответить в течение 24 часов. Это ориентир, а не автоматическое решение проблемы.'),
    'en': ('Contact support', 'My requests', 'How it works', 'We aim to reply within 24 hours. This is a response target, not an automatic resolution.'),
    'fr': ('Contacter l’assistance', 'Mes demandes', 'Comment ça marche', 'Nous visons une réponse sous 24 heures. Il s’agit d’un délai indicatif, sans résolution automatique.'),
    'de': ('Support kontaktieren', 'Meine Anfragen', 'So funktioniert es', 'Wir streben eine Antwort innerhalb von 24 Stunden an. Dies ist ein Richtwert, keine automatische Lösung.'),
    'me': ('Pišite podršci', 'Moji zahtjevi', 'Kako radi', 'Cilj je odgovor u roku od 24 sata. To je okvirno vrijeme, ne automatsko rješenje.'),
}


def language(code):
    code = str(code).lower().split('-')[0]
    return 'me' if code in ('sr', 'cnr', 'me') else code if code in COPY else 'en'


class Store:
    def __init__(self, filename, admin):
        self.admin = int(admin)
        self.db = sqlite3.connect(filename)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            pragma journal_mode=WAL;
            create table if not exists tickets(id integer primary key, chat integer not null, lang text not null, status text not null, created real not null, updated real not null);
            create table if not exists updates(id integer primary key);
            create table if not exists events(chat integer, created real);
            create index if not exists events_chat_time on events(chat,created);
            create table if not exists outbox(id integer primary key, event_key text unique, method text not null, payload text not null, ticket integer, admin_map integer default 0, status text default 'pending', message_id integer);
            create table if not exists mappings(message_id integer primary key, ticket integer not null);
        ''')
        self.db.execute("update outbox set status='unknown' where status='sending'")
        self.db.commit()

    def queue(self, key, chat, text, ticket=None, admin_map=False, markup=None):
        body = {'chat_id': chat, 'text': text, 'link_preview_options': {'is_disabled': True}}
        if chat == self.admin and not markup and not admin_map:
            markup = {'keyboard': [[{'text': 'Входящие'}, {'text': 'Как ответить'}], [{'text': 'Открыть приложение'}]], 'resize_keyboard': True, 'is_persistent': True}
        if chat != self.admin and not markup:
            latest = self.db.execute('select lang from tickets where chat=? order by id desc limit 1', (chat,)).fetchone()
            lang = latest['lang'] if latest else getattr(self, 'current_language', 'en')
            labels = BUTTONS[lang]
            markup = {'keyboard': [[{'text': labels[0]}], [{'text': labels[1]}, {'text': labels[2]}]], 'resize_keyboard': True, 'is_persistent': True}
        if markup:
            body['reply_markup'] = markup
        self.enqueue(key, 'sendMessage', body, ticket, admin_map)

    def enqueue(self, key, method, payload, ticket=None, admin_map=False):
        self.db.execute('insert or ignore into outbox(event_key,method,payload,ticket,admin_map) values(?,?,?,?,?)', (key, method, json.dumps(payload, ensure_ascii=False), ticket, int(admin_map)))

    def pending(self):
        return self.db.execute("select * from outbox where status='pending' order by id limit 30").fetchall()

    def begin_send(self, identifier):
        self.db.execute("update outbox set status='sending' where id=? and status='pending'", (identifier,))
        self.db.commit()

    def complete(self, identifier, result):
        with self.db:
            row = self.db.execute('select * from outbox where id=?', (identifier,)).fetchone()
            self.db.execute("update outbox set status='sent',message_id=? where id=?", (result.get('message_id'), identifier))
            if row['admin_map'] and result.get('message_id'):
                self.db.execute('insert or replace into mappings values(?,?)', (result['message_id'], row['ticket']))

    def offset(self):
        return self.db.execute('select coalesce(max(id),-1)+1 from updates').fetchone()[0]

    def status_text(self, ticket):
        copy = COPY[ticket['lang']]
        return copy[5].format(ticket['id'], copy[6][STATES.index(ticket['status'])])

    def handle(self, event):
        identifier = event.get('update_id')
        if not isinstance(identifier, int):
            return
        with self.db:
            if self.db.execute('select 1 from updates where id=?', (identifier,)).fetchone():
                return
            self.db.execute('insert into updates values(?)', (identifier,))
            callback = event.get('callback_query')
            if callback:
                self.callback(callback, identifier)
                return
            msg = event.get('message', {})
            chat = msg.get('chat', {})
            actor = msg.get('from', {})
            if chat.get('type') != 'private' or not isinstance(chat.get('id'), int) or actor.get('id') != chat['id'] or actor.get('is_bot'):
                return
            chat_id = chat['id']
            lang = language(actor.get('language_code', 'en'))
            self.current_language = lang
            text = msg.get('text', msg.get('caption', '')).strip()
            if chat_id == self.admin:
                self.admin_message(msg, identifier, text)
                return
            copy = COPY[lang]
            now = time.time()
            self.db.execute('delete from events where created<?', (now - 60,))
            count = self.db.execute('select count(*) from events where chat=?', (chat_id,)).fetchone()[0]
            if count >= 10:
                # Silence excess messages; avoids amplifying a burst into outgoing spam.
                return
            self.db.execute('insert into events values(?,?)', (chat_id, now))
            if text.split(' ')[0] in ('/start', '/help') or text in (BUTTONS[lang][0], BUTTONS[lang][2]):
                self.queue(f'{identifier}:welcome', chat_id, copy[0] + '\n\n' + BUTTONS[lang][3])
                return
            if text in ('/status', BUTTONS[lang][1]):
                tickets = self.db.execute('select * from tickets where chat=? order by id desc limit 5', (chat_id,)).fetchall()
                self.queue(f'{identifier}:status', chat_id, '\n'.join(self.status_text(ticket) for ticket in tickets) if tickets else copy[2])
                return
            photos = msg.get('photo', [])
            valid_photo = bool(photos) and all(isinstance(p.get('file_size'), int) and 0 < p['file_size'] <= 5 * 1024 * 1024 for p in photos)
            if len(text) > 3000 or (not text and not valid_photo) or (photos and not valid_photo) or any(key in msg for key in ('document', 'video', 'voice', 'audio', 'animation', 'video_note', 'location', 'contact')):
                self.queue(f'{identifier}:invalid', chat_id, copy[3])
                return
            ticket = self.db.execute("select * from tickets where chat=? and status!='resolved' order by id desc limit 1", (chat_id,)).fetchone()
            if not ticket:
                cursor = self.db.execute("insert into tickets(chat,lang,status,created,updated) values(?,?,'received',?,?)", (chat_id, lang, now, now))
                ticket_id = cursor.lastrowid
            else:
                ticket_id = ticket['id']
                self.db.execute("update tickets set updated=?,status=case when status='waiting' then 'reviewing' else status end where id=?", (now, ticket_id))
            buttons = {'inline_keyboard': [[{'text': name, 'callback_data': f'status:{ticket_id}:{state}'} for name, state in (('В работе', 'reviewing'), ('Нужны сведения', 'waiting'))], [{'text': 'Решено', 'callback_data': f'status:{ticket_id}:resolved'}]]}
            header = f'VratiMe · обращение №{ticket_id}\nЯзык: {lang}\nОтветьте на это сообщение, чтобы написать пользователю.\n\n{text}'
            self.queue(f'{identifier}:owner', self.admin, header, ticket_id, True, buttons)
            if valid_photo:
                self.enqueue(f'{identifier}:photo', 'copyMessage', {'chat_id': self.admin, 'from_chat_id': chat_id, 'message_id': msg['message_id']}, ticket_id, True)
            self.queue(f'{identifier}:receipt', chat_id, copy[1].format(ticket_id))

    def admin_message(self, msg, identifier, text):
        if text in ('Входящие', '/inbox'):
            tickets = self.db.execute("select * from tickets where status!='resolved' order by updated desc limit 10").fetchall()
            if not tickets:
                self.queue(f'{identifier}:empty', self.admin, 'Открытых обращений пока нет.')
            for ticket in tickets:
                self.queue(f'{identifier}:ticket:{ticket["id"]}', self.admin, self.status_text(ticket) + '\nОтветьте на эту карточку, чтобы написать пользователю.', ticket['id'], True,
                           {'inline_keyboard': [[{'text': name, 'callback_data': f'status:{ticket["id"]}:{state}'} for name, state in (('В работе', 'reviewing'), ('Нужны сведения', 'waiting'), ('Решено', 'resolved'))]]})
            return
        if text == 'Открыть приложение':
            self.queue(f'{identifier}:app', self.admin, 'VratiMe: https://vratime.vzdigital.online/')
            return
        reply_id = msg.get('reply_to_message', {}).get('message_id')
        ticket = self.db.execute('select t.* from mappings m join tickets t on t.id=m.ticket where m.message_id=?', (reply_id,)).fetchone()
        if ticket and 0 < len(text) <= 3000:
            self.queue(f'{identifier}:answer', ticket['chat'], f'VratiMe · #{ticket["id"]}\n{text}', ticket['id'])
            self.queue(f'{identifier}:queued', self.admin, f'Ответ по обращению №{ticket["id"]} поставлен в очередь.')
        else:
            self.queue(f'{identifier}:admin-help', self.admin, 'Поддержка VratiMe подключена. Чтобы ответить пользователю, используйте «Ответить» на карточке обращения. Статус меняется кнопками под карточкой. Ответ — текст до 3000 символов.')

    def callback(self, callback, identifier):
        msg = callback.get('message', {})
        if callback.get('from', {}).get('id') != self.admin or msg.get('chat', {}).get('id') != self.admin or msg.get('chat', {}).get('type') != 'private':
            return
        match = re.fullmatch(r'status:([1-9][0-9]{0,12}):(reviewing|waiting|resolved)', callback.get('data', ''))
        if not match:
            return
        ticket = self.db.execute('select * from tickets where id=?', (int(match[1]),)).fetchone()
        if not ticket:
            return
        if ticket['status'] != match[2]:
            self.db.execute('update tickets set status=?,updated=? where id=?', (match[2], time.time(), ticket['id']))
            ticket = dict(ticket)
            ticket['status'] = match[2]
            self.queue(f'{identifier}:status', ticket['chat'], self.status_text(ticket), ticket['id'])
        self.enqueue(f'{identifier}:callback', 'answerCallbackQuery', {'callback_query_id': callback['id'], 'text': 'Статус сохранён'})


class Telegram:
    def __init__(self, token):
        if not re.fullmatch(r'[0-9]{6,15}:[A-Za-z0-9_-]{30,100}', token):
            raise ValueError('invalid_token')
        self.base = 'https://api.telegram.org/bot' + token + '/'

    def call(self, method, payload):
        if method not in ('getMe', 'getWebhookInfo', 'getUpdates', 'sendMessage', 'copyMessage', 'answerCallbackQuery', 'setMyCommands', 'setMyDescription'):
            raise ValueError('method_not_allowed')
        request = urllib.request.Request(self.base + method, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=40) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('response_limit')
        result = json.loads(raw)
        if result.get('ok') is not True:
            raise ValueError('telegram_rejected')
        return result['result']


def run():
    os.umask(0o077)
    api = Telegram(os.environ['VRATIME_SUPPORT_BOT_TOKEN'])
    if api.call('getMe', {}).get('username') != 'VratiMeSupportBot':
        raise ValueError('unexpected_bot')
    if api.call('getWebhookInfo', {}).get('url'):
        raise ValueError('webhook_already_configured')
    state = pathlib.Path(os.environ.get('STATE_DIRECTORY', '/var/lib/vratime-support'))
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    store = Store(state / 'support.sqlite', os.environ['VRATIME_SUPPORT_ADMIN_CHAT_ID'])
    while True:
        try:
            updates = api.call('getUpdates', {'offset': store.offset(), 'timeout': 25, 'limit': 20, 'allowed_updates': ['message', 'callback_query']})
            for update in updates:
                store.handle(update)
            for row in store.pending():
                store.begin_send(row['id'])
                try:
                    result = api.call(row['method'], json.loads(row['payload']))
                    store.complete(row['id'], result if isinstance(result, dict) else {})
                    print(json.dumps({'event': 'telegram_accepted', 'outbox': row['id'], 'message_id': result.get('message_id') if isinstance(result, dict) else None}), flush=True)
                except Exception as error:
                    # Do not blindly resend an ambiguous send: Telegram has no send idempotency key.
                    store.db.execute("update outbox set status='unknown' where id=?", (row['id'],))
                    store.db.commit()
                    print(json.dumps({'event': 'delivery_needs_review', 'outbox': row['id'], 'error': type(error).__name__}), flush=True)
        except Exception as error:
            print(json.dumps({'event': 'poll_error', 'error': type(error).__name__}), flush=True)
            time.sleep(5)


if __name__ == '__main__':
    run()
