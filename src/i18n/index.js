import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const supportedLanguages = ['ru', 'me', 'en'];

export const resources = {
  ru: {
    translation: {
      common: {
        loading: 'Загружаем…', back: 'Назад', close: 'Закрыть', save: 'Сохранить', cancel: 'Отмена',
        retry: 'Повторить', choose: 'Выбрать', remove: 'Удалить', optional: 'Можно пропустить',
        pieces: '{{count}} шт.', partner: 'Партнёр', error: 'Что-то пошло не так',
      },
      nav: { map: 'Карта', deals: 'Сделки', create: 'Создать', profile: 'Профиль', label: 'Основная навигация' },
      install: {
        title: 'Установить VratiMe', android: 'Откроется как обычное приложение и будет дольше сохранять вход.',
        ios: 'На iPhone нажмите «Поделиться», затем «На экран Домой».', action: 'Установить', done: 'Приложение установлено',
      },
      auth: {
        eyebrow: 'Круговорот с пользой', title: 'Вещи находят новый дом',
        subtitle: 'Отдавайте тару и материалы рядом — легко, бережно и без лишних отходов.',
        email: 'Email для входа', magic: 'Получить ссылку', sending: 'Отправляем…', google: 'Продолжить с Google',
        divider: 'или', hint: 'Мы отправим безопасную ссылку. Пароль не нужен.', invalid: 'Введите корректный email.',
        sentTitle: 'Ссылка уже в пути', sentText: 'Мы отправили письмо на {{email}}. Откройте его на этом устройстве.',
        another: 'Использовать другой email', resend: 'Отправить ещё раз', spam: 'Если письма нет, проверьте папку «Спам».',
        rateLimit: 'Слишком много попыток. Подождите минуту и попробуйте снова.', googleUnavailable: 'Google-вход будет доступен после подключения OAuth.',
      },
      onboarding: {
        eyebrow: 'Первый шаг', title: 'Познакомимся?', text: 'Имя видно в сделках, а контакт — только вашему партнёру после бронирования.',
        name: 'Как вас называть', namePlaceholder: 'Например, Марко', language: 'Язык приложения', messenger: 'Где связаться',
        contact: 'Номер или никнейм', contactPlaceholder: '+382… или @username', submit: 'Сохранить и продолжить', saving: 'Сохраняем…',
      },
      contacts: { title: 'Где с вами связаться', note: 'Выберите один или несколько удобных мессенджеров. Их увидит только партнёр по сделке.', telegramHint: 'Укажите публичный Telegram-алиас, например @vasiliy. Номер телефона не нужен.', contactRequired: 'Выберите хотя бы один мессенджер.', contactInvalid: 'Проверьте введённый контакт.', telegramInvalid: 'Telegram-алиас: от 5 до 32 символов, латинские буквы, цифры или _.', migrationRequired: 'Несколько мессенджеров станут доступны после обновления базы. Старый контакт сохранён.', },
      map: {
        eyebrow: 'Черногория · рядом', title: 'Карта обмена', search: 'Банки, картон, одежда…', all: 'Все',
        filters: 'Фильтры', anyDistance: 'Любое расстояние', km1: 'До 1 км', km5: 'До 5 км', km10: 'До 10 км',
        nearby: 'Моё место', locating: 'Ищем ваше местоположение…', located: 'Показываем объявления рядом',
        locationDenied: 'Не удалось получить геолокацию', locationMissing: 'Геолокация недоступна',
        offers_one: '{{count}} объявление', offers_few: '{{count}} объявления', offers_many: '{{count}} объявлений', offers_other: '{{count}} объявления', mine: 'Моих: {{count}}', give: 'Отдают', take: 'Ищут', quantity: 'Количество',
        book: 'Забронировать', booking: 'Бронируем…', booked: 'Готово. Контакт партнёра появился в «Сделках».',
        own: 'Своё объявление бронировать нельзя.', ownLabel: 'Ваше объявление', emptyTitle: 'Пока ничего подходящего', emptyText: 'Измените фильтр или создайте первое объявление.',
        listTitle: 'Рядом с вами', expand: 'Показать список', collapse: 'Свернуть список', refresh: 'Обновить', resetFilters: 'Сбросить фильтры', hoverHint: 'нажмите, чтобы открыть',
      },
      create: {
        title: 'Новое объявление', step: 'Шаг {{step}} из 3', typeEyebrow: 'Намерение', typeTitle: 'Что вы хотите сделать?',
        give: 'Я отдаю', giveText: 'У меня есть тара, одежда или материалы.', take: 'Я заберу', takeText: 'Мне нужны материалы для дела или проекта.',
        categoryEyebrow: 'Категория', categoryTitle: 'Что именно?', root: 'Основные категории', open: 'Открыть',
        loadingCategories: 'Загружаем категории…', noCategories: 'Категории пока не найдены.', publishEyebrow: 'Детали',
        publishTitle: 'Покажите место', publishText: 'Поставьте точку на карте. Точный контакт увидит только участник сделки.',
        photo: 'Фото объявления', upload: 'Добавить', uploading: 'Загрузка…', uploaded: 'Фото загружено', tooLarge: 'Фото должно быть не больше 5 МБ.',
        badFile: 'Выберите изображение JPEG, PNG или WebP.', quantity: 'Количество', description: 'Описание', useLocation: 'Моё местоположение',
        publishGive: 'Опубликовать', publishTake: 'Разместить запрос', publishing: 'Публикуем…', published: 'Объявление опубликовано.',
      },
      deals: {
        eyebrow: 'Договорённости', title: 'Мои сделки', giving: 'Отдаю', taking: 'Забираю', active: 'Активные', history: 'История',
        emptyTitle: 'Сделок пока нет', emptyText: 'Забронируйте объявление на карте — оно появится здесь.',
        contact: 'Контакт партнёра', contactHidden: 'Контакт откроется участникам подтверждённой сделки.',
        complete: 'Передача состоялась', completing: 'Завершаем…', cancel: 'Отменить бронь', canceling: 'Отменяем…',
        completed: 'Сделка завершена. Начислено 50 экобаллов.', canceled: 'Бронь отменена, история сохранена.',
        rate: 'Оценить партнёра', ratingSent: 'Спасибо! Отзыв сохранён.', details: 'Детали сделки',
      },
      profile: {
        eyebrow: 'Ваш вклад', ecoPoints: 'Экобаллы', rating: 'Рейтинг', deals: 'Сделок', items: 'Единиц в обороте',
        level: 'Уровень', nextLevel: 'До следующего уровня — {{count}} баллов', maxLevel: 'Максимальный уровень',
        levels: ['Эко-новичок', 'Эко-друг', 'Эко-активист', 'Эко-герой', 'Эко-амбассадор'],
        edit: 'Редактировать профиль', name: 'Имя', language: 'Язык', messenger: 'Мессенджер', contact: 'Контакт',
        achievements: 'Награды', firstDeal: 'Первая сделка', fiveDeals: '5 сделок', fiftyItems: '50 единиц', topRating: 'Высокий рейтинг',
        listings: 'Мои объявления', noListings: 'Здесь появятся ваши активные объявления.', deactivate: 'Снять с публикации',
        reviews: 'Последние оценки', noReviews: 'Отзывов пока нет.', logout: 'Выйти', saved: 'Профиль обновлён.',
      },
      status: { active: 'Активно', reserved: 'Забронировано', completed: 'Завершено', canceled: 'Отменено' },
      errors: { load: 'Не удалось загрузить данные.', save: 'Не удалось сохранить.', network: 'Проверьте интернет и попробуйте ещё раз.' },
    },
  },
  me: {
    translation: {
      common: { loading: 'Učitavanje…', back: 'Nazad', close: 'Zatvori', save: 'Sačuvaj', cancel: 'Otkaži', retry: 'Pokušaj ponovo', choose: 'Izaberi', remove: 'Ukloni', optional: 'Nije obavezno', pieces: '{{count}} kom.', partner: 'Partner', error: 'Nešto nije u redu' },
      nav: { map: 'Mapa', deals: 'Dogovori', create: 'Dodaj', profile: 'Profil', label: 'Glavna navigacija' },
      install: { title: 'Instaliraj VratiMe', android: 'Otvara se kao aplikacija i duže čuva prijavu.', ios: 'Na iPhone-u pritisnite „Share“, zatim „Add to Home Screen“.', action: 'Instaliraj', done: 'Aplikacija je instalirana' },
      auth: { eyebrow: 'Kružna upotreba', title: 'Stvari nalaze novi dom', subtitle: 'Poklonite ambalažu i materijale u blizini — jednostavno i bez otpada.', email: 'Email za prijavu', magic: 'Pošalji link', sending: 'Šaljemo…', google: 'Nastavi sa Google-om', divider: 'ili', hint: 'Poslaćemo siguran link. Lozinka nije potrebna.', invalid: 'Unesite ispravan email.', sentTitle: 'Link je na putu', sentText: 'Poslali smo poruku na {{email}}. Otvorite je na ovom uređaju.', another: 'Drugi email', resend: 'Pošalji ponovo', spam: 'Ako poruke nema, provjerite Spam.', rateLimit: 'Previše pokušaja. Sačekajte minut.', googleUnavailable: 'Google prijava biće dostupna nakon OAuth podešavanja.' },
      onboarding: { eyebrow: 'Prvi korak', title: 'Da se upoznamo?', text: 'Ime se vidi u dogovorima, a kontakt samo partneru poslije rezervacije.', name: 'Kako da vas zovemo', namePlaceholder: 'Na primjer, Marko', language: 'Jezik aplikacije', messenger: 'Gdje da vas kontaktiraju', contact: 'Broj ili korisničko ime', contactPlaceholder: '+382… ili @username', submit: 'Sačuvaj i nastavi', saving: 'Čuvamo…' },
      contacts: { title: 'Kako da vas kontaktiraju', note: 'Izaberite jedan ili više messengera. Vide ih samo učesnici dogovora.', telegramHint: 'Unesite javni Telegram alias, na primjer @vasiliy. Broj telefona nije potreban.', contactRequired: 'Izaberite najmanje jedan messenger.', contactInvalid: 'Provjerite uneseni kontakt.', telegramInvalid: 'Telegram alias ima 5–32 znaka: latinica, brojevi ili _.', migrationRequired: 'Više messengera biće dostupno nakon ažuriranja baze. Stari kontakt je sačuvan.', },
      map: { eyebrow: 'Crna Gora · u blizini', title: 'Mapa razmjene', search: 'Tegle, karton, odjeća…', all: 'Sve', filters: 'Filteri', anyDistance: 'Bilo koja udaljenost', km1: 'Do 1 km', km5: 'Do 5 km', km10: 'Do 10 km', nearby: 'Moja lokacija', locating: 'Tražimo vašu lokaciju…', located: 'Prikazujemo oglase u blizini', locationDenied: 'Lokacija nije dostupna', locationMissing: 'Geolokacija nije podržana', offers_one: '{{count}} oglas', offers_few: '{{count}} oglasa', offers_many: '{{count}} oglasa', offers_other: '{{count}} oglasa', mine: 'Mojih: {{count}}', give: 'Poklanjaju', take: 'Traže', quantity: 'Količina', book: 'Rezerviši', booking: 'Rezervišemo…', booked: 'Rezervisano. Kontakt je u „Dogovorima“.', own: 'Ne možete rezervisati svoj oglas.', ownLabel: 'Vaš oglas', emptyTitle: 'Nema odgovarajućih oglasa', emptyText: 'Promijenite filter ili dodajte prvi oglas.', listTitle: 'U vašoj blizini', expand: 'Prikaži listu', collapse: 'Sakrij listu', refresh: 'Osvježi', resetFilters: 'Poništi filtere', hoverHint: 'kliknite za detalje' },
      create: { title: 'Novi oglas', step: 'Korak {{step}} od 3', typeEyebrow: 'Namjera', typeTitle: 'Šta želite da uradite?', give: 'Poklanjam', giveText: 'Imam ambalažu, odjeću ili materijale.', take: 'Preuzimam', takeText: 'Trebaju mi materijali za rad ili projekat.', categoryEyebrow: 'Kategorija', categoryTitle: 'Šta tačno?', root: 'Glavne kategorije', open: 'Otvori', loadingCategories: 'Učitavamo kategorije…', noCategories: 'Kategorije nijesu pronađene.', publishEyebrow: 'Detalji', publishTitle: 'Označite mjesto', publishText: 'Postavite tačku na mapi. Kontakt vidi samo učesnik dogovora.', photo: 'Fotografija oglasa', upload: 'Dodaj', uploading: 'Otpremanje…', uploaded: 'Fotografija je dodata', tooLarge: 'Fotografija može imati najviše 5 MB.', badFile: 'Izaberite JPEG, PNG ili WebP sliku.', quantity: 'Količina', description: 'Opis', useLocation: 'Moja lokacija', publishGive: 'Objavi', publishTake: 'Objavi zahtjev', publishing: 'Objavljujemo…', published: 'Oglas je objavljen.' },
      deals: { eyebrow: 'Dogovori', title: 'Moje razmjene', giving: 'Poklanjam', taking: 'Preuzimam', active: 'Aktivno', history: 'Istorija', emptyTitle: 'Još nema dogovora', emptyText: 'Rezervišite oglas na mapi i pojaviće se ovdje.', contact: 'Kontakt partnera', contactHidden: 'Kontakt je dostupan samo učesnicima potvrđenog dogovora.', complete: 'Predaja je završena', completing: 'Završavamo…', cancel: 'Otkaži rezervaciju', canceling: 'Otkazujemo…', completed: 'Dogovor je završen. Dodato je 50 eko bodova.', canceled: 'Rezervacija je otkazana, istorija je sačuvana.', rate: 'Ocijeni partnera', ratingSent: 'Hvala! Ocjena je sačuvana.', details: 'Detalji dogovora' },
      profile: { eyebrow: 'Vaš doprinos', ecoPoints: 'Eko bodovi', rating: 'Ocjena', deals: 'Dogovora', items: 'Jedinica vraćeno', level: 'Nivo', nextLevel: 'Do sljedećeg nivoa — {{count}} bodova', maxLevel: 'Najviši nivo', levels: ['Eko početnik', 'Eko prijatelj', 'Eko aktivista', 'Eko heroj', 'Eko ambasador'], edit: 'Uredi profil', name: 'Ime', language: 'Jezik', messenger: 'Aplikacija', contact: 'Kontakt', achievements: 'Nagrade', firstDeal: 'Prvi dogovor', fiveDeals: '5 dogovora', fiftyItems: '50 jedinica', topRating: 'Visoka ocjena', listings: 'Moji oglasi', noListings: 'Ovdje će biti vaši aktivni oglasi.', deactivate: 'Ukloni oglas', reviews: 'Posljednje ocjene', noReviews: 'Još nema ocjena.', logout: 'Odjavi se', saved: 'Profil je ažuriran.' },
      status: { active: 'Aktivno', reserved: 'Rezervisano', completed: 'Završeno', canceled: 'Otkazano' },
      errors: { load: 'Podaci nijesu učitani.', save: 'Nije moguće sačuvati.', network: 'Provjerite internet i pokušajte ponovo.' },
    },
  },
  en: {
    translation: {
      common: { loading: 'Loading…', back: 'Back', close: 'Close', save: 'Save', cancel: 'Cancel', retry: 'Try again', choose: 'Choose', remove: 'Remove', optional: 'Optional', pieces: '{{count}} pcs.', partner: 'Partner', error: 'Something went wrong' },
      nav: { map: 'Map', deals: 'Deals', create: 'Create', profile: 'Profile', label: 'Main navigation' },
      install: { title: 'Install VratiMe', android: 'Open it like a regular app and stay signed in longer.', ios: 'On iPhone, tap Share, then Add to Home Screen.', action: 'Install', done: 'App installed' },
      auth: { eyebrow: 'Circular by design', title: 'Give things another life', subtitle: 'Share packaging and materials nearby — simply, thoughtfully, with less waste.', email: 'Email address', magic: 'Send sign-in link', sending: 'Sending…', google: 'Continue with Google', divider: 'or', hint: 'We will send a secure link. No password needed.', invalid: 'Enter a valid email.', sentTitle: 'Your link is on its way', sentText: 'We sent an email to {{email}}. Open it on this device.', another: 'Use another email', resend: 'Send again', spam: 'If it is not there, check your Spam folder.', rateLimit: 'Too many attempts. Wait a minute and try again.', googleUnavailable: 'Google sign-in will work after OAuth is connected.' },
      onboarding: { eyebrow: 'First step', title: 'Let’s meet', text: 'Your name is visible in deals; contact details only to your partner after booking.', name: 'Display name', namePlaceholder: 'For example, Marko', language: 'App language', messenger: 'Preferred messenger', contact: 'Number or username', contactPlaceholder: '+382… or @username', submit: 'Save and continue', saving: 'Saving…' },
      contacts: { title: 'How should people contact you?', note: 'Choose one or more messengers. Only your deal partner can see them.', telegramHint: 'Enter a public Telegram username, for example @vasiliy. No phone number is needed.', contactRequired: 'Choose at least one messenger.', contactInvalid: 'Check the contact details.', telegramInvalid: 'Telegram username: 5–32 Latin letters, numbers, or _.', migrationRequired: 'Multiple messengers will be available after the database update. Your existing contact is safe.', },
      map: { eyebrow: 'Montenegro · nearby', title: 'Exchange map', search: 'Jars, cardboard, clothes…', all: 'All', filters: 'Filters', anyDistance: 'Any distance', km1: 'Within 1 km', km5: 'Within 5 km', km10: 'Within 10 km', nearby: 'My location', locating: 'Finding your location…', located: 'Showing listings nearby', locationDenied: 'Could not access location', locationMissing: 'Geolocation is unavailable', offers_one: '{{count}} listing', offers_few: '{{count}} listings', offers_many: '{{count}} listings', offers_other: '{{count}} listings', mine: 'Mine: {{count}}', give: 'Offering', take: 'Looking for', quantity: 'Quantity', book: 'Book', booking: 'Booking…', booked: 'Booked. Your partner’s contact is now in Deals.', own: 'You cannot book your own listing.', ownLabel: 'Your listing', emptyTitle: 'Nothing matches yet', emptyText: 'Change the filters or create the first listing.', listTitle: 'Near you', expand: 'Show list', collapse: 'Hide list', refresh: 'Refresh', resetFilters: 'Reset filters', hoverHint: 'click for details' },
      create: { title: 'New listing', step: 'Step {{step}} of 3', typeEyebrow: 'Intent', typeTitle: 'What would you like to do?', give: 'I am giving', giveText: 'I have packaging, clothes or materials.', take: 'I will collect', takeText: 'I need materials for work or a project.', categoryEyebrow: 'Category', categoryTitle: 'What is it?', root: 'Main categories', open: 'Open', loadingCategories: 'Loading categories…', noCategories: 'No categories found.', publishEyebrow: 'Details', publishTitle: 'Mark the place', publishText: 'Place a pin on the map. Exact contact is only shown to the other participant.', photo: 'Listing photo', upload: 'Add', uploading: 'Uploading…', uploaded: 'Photo uploaded', tooLarge: 'Photo must be 5 MB or less.', badFile: 'Choose a JPEG, PNG or WebP image.', quantity: 'Quantity', description: 'Description', useLocation: 'My location', publishGive: 'Publish listing', publishTake: 'Publish request', publishing: 'Publishing…', published: 'Listing published.' },
      deals: { eyebrow: 'Arrangements', title: 'My deals', giving: 'Giving', taking: 'Collecting', active: 'Active', history: 'History', emptyTitle: 'No deals yet', emptyText: 'Book a listing on the map and it will appear here.', contact: 'Partner contact', contactHidden: 'Contact details are only available to participants of a confirmed deal.', complete: 'Handover completed', completing: 'Completing…', cancel: 'Cancel booking', canceling: 'Canceling…', completed: 'Deal completed. 50 eco points added.', canceled: 'Booking canceled and kept in history.', rate: 'Rate partner', ratingSent: 'Thank you! Your rating was saved.', details: 'Deal details' },
      profile: { eyebrow: 'Your impact', ecoPoints: 'Eco points', rating: 'Rating', deals: 'Deals', items: 'Items recirculated', level: 'Level', nextLevel: '{{count}} points to the next level', maxLevel: 'Highest level', levels: ['Eco starter', 'Eco friend', 'Eco activist', 'Eco hero', 'Eco ambassador'], edit: 'Edit profile', name: 'Name', language: 'Language', messenger: 'Messenger', contact: 'Contact', achievements: 'Awards', firstDeal: 'First deal', fiveDeals: '5 deals', fiftyItems: '50 items', topRating: 'Top rating', listings: 'My listings', noListings: 'Your active listings will appear here.', deactivate: 'Deactivate', reviews: 'Recent ratings', noReviews: 'No ratings yet.', logout: 'Sign out', saved: 'Profile updated.' },
      status: { active: 'Active', reserved: 'Reserved', completed: 'Completed', canceled: 'Canceled' },
      errors: { load: 'Could not load data.', save: 'Could not save.', network: 'Check your connection and try again.' },
    },
  },
};

const normalizeLanguage = (value) => {
  const code = String(value || '').toLowerCase().split('-')[0];
  return supportedLanguages.includes(code) ? code : 'ru';
};

const hasBrowser = typeof window !== 'undefined';
const storedLanguage = hasBrowser ? window.localStorage.getItem('vratimeLanguage') : null;
const initialLanguage = normalizeLanguage(storedLanguage || (hasBrowser ? window.navigator.language : 'ru'));

i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
  returnObjects: true,
});

i18n.on('languageChanged', (language) => {
  const normalized = normalizeLanguage(language);
  if (hasBrowser) window.localStorage.setItem('vratimeLanguage', normalized);
  if (typeof document !== 'undefined') document.documentElement.lang = normalized === 'me' ? 'sr-Latn-ME' : normalized;
});

if (typeof document !== 'undefined') document.documentElement.lang = initialLanguage === 'me' ? 'sr-Latn-ME' : initialLanguage;

export const setAppLanguage = (language) => i18n.changeLanguage(normalizeLanguage(language));
export const getAppLanguage = () => normalizeLanguage(i18n.resolvedLanguage || i18n.language);

export default i18n;
