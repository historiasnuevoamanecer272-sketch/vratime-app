export const draftExperienceTranslations = {
  ru: { title: 'Продолжить черновик?', text: 'На этом устройстве есть несохранённое объявление. Черновик хранится до 7 дней.', restore: 'Продолжить', discard: 'Удалить черновик', saved: 'Черновик сохранён на этом устройстве.', unavailable: 'Черновик не сохранён: хранилище браузера недоступно. Не закрывайте форму.', textOnly: 'Текст черновика сохранён. Фотографии нужно будет выбрать заново.', finalTitle: 'Фото, количество и место передачи', finalText: 'Проверьте данные и опубликуйте объявление.', discarded: 'Черновик удалён.', saveError: 'Не удалось опубликовать. Данные и фото сохранены в форме — попробуйте ещё раз.' },
  me: { title: 'Nastaviti nacrt?', text: 'Na ovom uređaju postoji nesačuvan oglas. Nacrt se čuva do 7 dana.', restore: 'Nastavi', discard: 'Obriši nacrt', saved: 'Nacrt je sačuvan na ovom uređaju.', unavailable: 'Nacrt nije sačuvan: skladište pregledača nije dostupno. Ne zatvarajte obrazac.', textOnly: 'Tekst nacrta je sačuvan. Fotografije treba ponovo izabrati.', finalTitle: 'Fotografije, količina i mjesto preuzimanja', finalText: 'Provjerite podatke i objavite oglas.', discarded: 'Nacrt je obrisan.', saveError: 'Objavljivanje nije uspjelo. Podaci i fotografije su sačuvani u obrascu — pokušajte ponovo.' },
  en: { title: 'Continue your draft?', text: 'This device has an unfinished listing. Drafts are kept for up to 7 days.', restore: 'Continue', discard: 'Discard draft', saved: 'Draft saved on this device.', unavailable: 'Draft was not saved: browser storage is unavailable. Keep this form open.', textOnly: 'Draft text is saved. You will need to select the photos again.', finalTitle: 'Photos, quantity and pickup place', finalText: 'Check the details and publish your listing.', discarded: 'Draft discarded.', saveError: 'Could not publish. Your details and photos are retained in the form — please retry.' },
  fr: { title: 'Reprendre le brouillon ?', text: 'Une annonce inachevée se trouve sur cet appareil. Les brouillons sont conservés jusqu’à 7 jours.', restore: 'Continuer', discard: 'Supprimer le brouillon', saved: 'Brouillon enregistré sur cet appareil.', unavailable: 'Brouillon non enregistré : le stockage du navigateur est indisponible. Gardez le formulaire ouvert.', textOnly: 'Le texte est enregistré. Vous devrez sélectionner les photos à nouveau.', finalTitle: 'Photos, quantité et lieu de retrait', finalText: 'Vérifiez les informations et publiez votre annonce.', discarded: 'Brouillon supprimé.', saveError: 'Publication impossible. Vos informations et photos restent dans le formulaire — réessayez.' },
  de: { title: 'Entwurf fortsetzen?', text: 'Auf diesem Gerät liegt eine unfertige Anzeige. Entwürfe werden bis zu 7 Tage gespeichert.', restore: 'Fortsetzen', discard: 'Entwurf verwerfen', saved: 'Entwurf auf diesem Gerät gespeichert.', unavailable: 'Entwurf nicht gespeichert: Der Browserspeicher ist nicht verfügbar. Lassen Sie das Formular geöffnet.', textOnly: 'Der Entwurfstext ist gespeichert. Die Fotos müssen erneut ausgewählt werden.', finalTitle: 'Fotos, Menge und Abholort', finalText: 'Prüfen Sie die Angaben und veröffentlichen Sie Ihre Anzeige.', discarded: 'Entwurf verworfen.', saveError: 'Veröffentlichen fehlgeschlagen. Angaben und Fotos bleiben im Formular erhalten — bitte erneut versuchen.' },
};

const publicationConflictMessages = {
  ru: 'Объявление с этим черновиком уже сохранено с другими данными. Проверьте свои объявления перед новой публикацией.',
  me: 'Oglas iz ovog nacrta je već sačuvan sa drugim podacima. Provjerite svoje oglase prije novog objavljivanja.',
  en: 'This draft was already published with different details. Check your listings before publishing again.',
  fr: 'Ce brouillon a déjà été publié avec d’autres informations. Vérifiez vos annonces avant de publier à nouveau.',
  de: 'Dieser Entwurf wurde bereits mit anderen Angaben veröffentlicht. Prüfen Sie Ihre Anzeigen vor einer erneuten Veröffentlichung.',
};
for (const [language, message] of Object.entries(publicationConflictMessages)) draftExperienceTranslations[language].publicationConflict = message;

const reviewMessages={
  ru:'Проверил(а): количество и точка получения из черновика по-прежнему актуальны.',
  me:'Provjerio/la sam: količina i mjesto preuzimanja iz nacrta su i dalje tačni.',
  en:'I checked: the draft quantity and pickup point are still correct.',
  fr:'J’ai vérifié : la quantité et le point de retrait du brouillon sont toujours corrects.',
  de:'Ich habe geprüft: Menge und Abholpunkt des Entwurfs stimmen weiterhin.',
};
for(const [language,message] of Object.entries(reviewMessages))draftExperienceTranslations[language].reviewRequired=message;
