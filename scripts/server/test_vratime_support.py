import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('support', pathlib.Path(__file__).with_name('vratime-support.py'))
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).parent)
        self.store = support.Store(pathlib.Path(self.tmp.name) / 'test.sqlite', 99)

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def message(self, update, chat=10, text='Не могу загрузить фото', **fields):
        return {'update_id': update, 'message': {'message_id': update, 'chat': {'id': chat, 'type': 'private'}, 'from': {'id': chat, 'language_code': 'ru'}, 'text': text, **fields}}

    def test_ticket_and_update_are_idempotent(self):
        event = self.message(1)
        self.store.handle(event)
        self.store.handle(event)
        self.assertEqual(self.store.db.execute('select count(*) from tickets').fetchone()[0], 1)
        self.assertEqual(len(self.store.pending()), 2)

    def test_admin_reply_is_bound_to_real_message_mapping(self):
        self.store.handle(self.message(1))
        owner = next(row for row in self.store.pending() if row['admin_map'])
        self.store.complete(owner['id'], {'message_id': 500})
        self.store.handle(self.message(2, 99, 'Помогу', reply_to_message={'message_id': 500}))
        outgoing = [row for row in self.store.pending() if 'Помогу' in row['payload']]
        self.assertEqual(len(outgoing), 1)
        self.assertEqual(support.json.loads(outgoing[0]['payload'])['chat_id'], 10)

    def test_forged_reply_cannot_relay_to_another_user(self):
        self.store.handle(self.message(1))
        owner = next(row for row in self.store.pending() if row['admin_map'])
        self.store.complete(owner['id'], {'message_id': 500})
        self.store.handle(self.message(2, 20, 'Взлом', reply_to_message={'message_id': 500}))
        self.assertFalse(any(support.json.loads(row['payload']).get('chat_id') == 10 and 'Взлом' in row['payload'] for row in self.store.pending()))

    def test_status_callback_requires_exact_admin_and_private_chat(self):
        self.store.handle(self.message(1))
        def callback(i, actor, chat):
            return {'update_id': i, 'callback_query': {'id': str(i), 'from': {'id': actor}, 'message': {'chat': {'id': chat, 'type': 'private'}}, 'data': 'status:1:resolved'}}
        self.store.handle(callback(2, 20, 99))
        self.store.handle(callback(3, 99, -100))
        self.assertEqual(self.store.db.execute('select status from tickets').fetchone()[0], 'received')
        self.store.handle(callback(4, 99, 99))
        self.assertEqual(self.store.db.execute('select status from tickets').fetchone()[0], 'resolved')

    def test_group_message_and_oversize_photo_do_not_create_ticket(self):
        event = self.message(1)
        event['message']['chat']['type'] = 'group'
        self.store.handle(event)
        self.store.handle(self.message(2, text='', photo=[{'file_id': 'large', 'file_size': 5242881}]))
        self.assertEqual(self.store.db.execute('select count(*) from tickets').fetchone()[0], 0)

    def test_photo_stays_in_telegram_and_is_copied_without_download(self):
        self.store.handle(self.message(1, text='', photo=[{'file_id': 'small', 'file_size': 1000}]))
        methods = [row['method'] for row in self.store.pending()]
        self.assertIn('copyMessage', methods)
        self.assertNotIn('getFile', methods)

    def test_user_status_never_exposes_another_ticket(self):
        self.store.handle(self.message(1))
        self.store.handle(self.message(2, 20, '/status'))
        last = self.store.pending()[-1]
        self.assertNotIn('№1', support.json.loads(last['payload'])['text'])

    def test_rate_limit_and_pending_queue_are_bounded(self):
        for i in range(1, 25):
            self.store.handle(self.message(i))
        self.assertLessEqual(self.store.db.execute('select count(*) from events').fetchone()[0], 10)
        self.assertLessEqual(len(self.store.pending()), 30)

    def test_uncertain_sending_is_not_retried_after_restart(self):
        self.store.handle(self.message(1))
        row = self.store.pending()[0]
        self.store.begin_send(row['id'])
        again = support.Store(pathlib.Path(self.tmp.name) / 'test.sqlite', 99)
        self.assertNotIn(row['id'], [item['id'] for item in again.pending()])
        self.assertEqual(again.db.execute('select status from outbox where id=?', (row['id'],)).fetchone()[0], 'unknown')
        again.db.close()

    def test_language_and_text_limit(self):
        event = self.message(1, text='/start')
        event['message']['from']['language_code'] = 'fr'
        self.store.handle(event)
        self.assertIn('assistance', support.json.loads(self.store.pending()[0]['payload'])['text'].lower())
        self.store.handle(self.message(2, text='a' * 3001))
        self.assertEqual(self.store.db.execute('select count(*) from tickets').fetchone()[0], 0)

    def test_user_buttons_and_response_window(self):
        self.store.handle(self.message(1, text='/start'))
        welcome = support.json.loads(self.store.pending()[0]['payload'])
        self.assertIn('24', welcome['text'])
        self.assertIn('Мои обращения', str(welcome['reply_markup']))
        self.store.handle(self.message(2, text='Написать в поддержку'))
        self.assertEqual(self.store.db.execute('select count(*) from tickets').fetchone()[0], 0)

    def test_owner_has_inbox_buttons_and_replyable_ticket_card(self):
        self.store.handle(self.message(1))
        self.store.handle(self.message(2, 99, '/start'))
        welcome = support.json.loads(self.store.pending()[-1]['payload'])
        self.assertIn('Входящие', str(welcome['reply_markup']))
        self.store.handle(self.message(3, 99, 'Входящие'))
        cards = [row for row in self.store.pending() if row['event_key'].startswith('3:') and row['admin_map']]
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]['ticket'], 1)


if __name__ == '__main__':
    unittest.main()
