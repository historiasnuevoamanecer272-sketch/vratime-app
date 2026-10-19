# VratiMe Support

Public bot: https://t.me/VratiMeSupportBot. Python standard library only.
`vratime-support.service` runs on the owned VPS with a dynamic unprivileged user.
Code: `/opt/vratime-support/vratime-support.py`; private environment:
`/etc/vratime-support/bot.env` (root, 0600); state: systemd StateDirectory
`/var/lib/vratime-support` (0700, SQLite/WAL 0600). Back up existing files before replacing them.

Required secrets: `VRATIME_SUPPORT_BOT_TOKEN`, `VRATIME_SUPPORT_ADMIN_CHAT_ID`.
Never pass secrets through arguments, source code, reports or logs. The token
must identify `VratiMeSupportBot`; an existing webhook aborts long polling.
Do not run two polling instances. The owner must press Start once before the
bot can deliver notifications to their private chat.

Users see localized buttons to write, view their last five tickets, and get help.
Descriptions/photos create or continue their own open ticket. Acknowledgements
mean the request is stored, not that a human has read it. The 24-hour response
window is an operational target, not a guaranteed resolution. Statuses:
received → reviewing → waiting for information → resolved. A new message after
resolution creates a new ticket. Photos stay in Telegram: no server download.
Limit: 3000 characters, photos up to 5 MiB, ten accepted messages/minute/user;
videos, documents, locations and shared contacts are rejected. Telegram contact
information is not merged automatically with a VratiMe account.

The owner replies to an actual ticket card or copied photo; the stored mapping
routes the response. Only the configured private admin chat can change status.
The bot never trusts forwarded text or a claimed ticket number as authority.
App ideas and storage alerts also arrive through this bot after configuring
Supabase `VRATIME_TELEGRAM_BOT_TOKEN`/`VRATIME_TELEGRAM_CHAT_ID` to the same bot
and recipient. App ideas without a linked Telegram conversation are answered
using the voluntarily supplied reply contact or through the staff panel;
they are not automatically routed to a Telegram account.

Outgoing sends have durable states. If an acknowledgement is ambiguous, the
outbox becomes `unknown` and is not resent automatically; otherwise a network
timeout can duplicate the reply. Review `delivery_needs_review` in the systemd
journal and compare the message in Telegram before deciding on recovery.
Logs contain only event names, outbox IDs and Telegram message IDs. A `sent`
row proves API acceptance, not reading. Protect/back up SQLite along with the
environment; do not put either in Git or public release archives.

Checks: `python3 scripts/server/test_vratime_support.py` (offline).
Operational check: `systemctl show vratime-support -p ActiveState -p SubState -p NRestarts`;
verify a real Start reply and notification receipt separately. Never claim an
offline fake Telegram transport proves real two-user delivery.
