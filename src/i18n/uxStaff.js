export const staffExperienceTranslations = {
  ru: { listings: 'Активные объявления', withdraw: 'Снять объявление', reason: 'Причина снятия или отклонения *', reasonHint: 'Причина обязательна при снятии или отклонении: не менее 3 символов.', reasonRequired: 'Укажите причину: не менее 3 символов.' },
  me: { listings: 'Aktivni oglasi', withdraw: 'Ukloni oglas', reason: 'Razlog uklanjanja ili odbijanja *', reasonHint: 'Za uklanjanje ili odbijanje potreban je razlog od najmanje 3 znaka.', reasonRequired: 'Unesite razlog od najmanje 3 znaka.' },
  en: { listings: 'Active listings', withdraw: 'Withdraw listing', reason: 'Withdrawal or rejection reason *', reasonHint: 'Withdrawal or rejection requires a reason of at least 3 characters.', reasonRequired: 'Enter a reason of at least 3 characters.' },
  fr: { listings: 'Annonces actives', withdraw: 'Retirer l’annonce', reason: 'Motif du retrait ou du rejet *', reasonHint: 'Un retrait ou un rejet nécessite un motif d’au moins 3 caractères.', reasonRequired: 'Saisissez un motif d’au moins 3 caractères.' },
  de: { listings: 'Aktive Anzeigen', withdraw: 'Anzeige entfernen', reason: 'Grund für Entfernung oder Ablehnung *', reasonHint: 'Entfernung oder Ablehnung erfordert einen Grund mit mindestens 3 Zeichen.', reasonRequired: 'Geben Sie einen Grund mit mindestens 3 Zeichen ein.' },
};

const panelCopy = {
  ru: ['Объявления и поддержка', 'Этот раздел виден только администраторам и модераторам. Новые объявления публикуются сразу. Здесь можно снять объявление, рассмотреть жалобу или обращение.'],
  me: ['Oglasi i podrška', 'Ovaj odjeljak vide samo administratori i moderatori. Novi oglasi se objavljuju odmah. Ovdje možete ukloniti oglas i obraditi prijave ili poruke.'],
  en: ['Listings and support', 'Only administrators and moderators see this section. New listings are published immediately. Manage listings, reports and support requests here.'],
  fr: ['Annonces et assistance', 'Cette section est réservée aux administrateurs et aux modérateurs. Les nouvelles annonces sont publiées immédiatement. Gérez ici les annonces, les signalements et les demandes d’assistance.'],
  de: ['Anzeigen und Support', 'Diesen Bereich sehen nur Administratoren und Moderatoren. Neue Anzeigen werden sofort veröffentlicht. Hier können Sie Anzeigen entfernen, Meldungen prüfen und Supportanfragen bearbeiten.'],
};
for (const [language, [title, description]] of Object.entries(panelCopy)) {
  Object.assign(staffExperienceTranslations[language], { title, description });
}
