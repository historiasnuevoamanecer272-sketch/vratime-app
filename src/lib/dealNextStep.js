export function nextDealStep(deal, appointment, now = new Date()) {
  if (deal.canceled_at || ['canceled','expired'].includes(deal.status)) return deal.status === 'expired' ? 'expired' : 'closed';
  if (deal.completed_at || deal.returned_at || deal.status === 'completed') return deal.my_review_rating ? 'finished' : 'review';
  const mine = deal.role === 'giver' ? deal.giver_confirmed_at : deal.taker_confirmed_at;
  const other = deal.role === 'giver' ? deal.taker_confirmed_at : deal.giver_confirmed_at;
  if (deal.listing_type === 'lend' && deal.handed_over_at) {
    const returned = deal.role === 'giver' ? deal.lender_return_confirmed_at : deal.borrower_return_confirmed_at;
    if (returned) return 'waitPartner';
    return deal.return_due_at && new Date(deal.return_due_at) <= now ? 'confirmReturn' : 'arrangeReturn';
  }
  if (deal.expires_at && new Date(deal.expires_at) <= now) return 'expired';
  if (!deal.accepted_at) return deal.is_listing_owner ? 'acceptRequest' : 'waitOwner';
  if (mine) return 'waitPartner';
  if (other) return 'confirmTransfer';
  if (appointment === undefined) return 'checkMeeting';
  if (appointment?.state === 'completed') return 'confirmTransfer';
  if (appointment?.state === 'scheduled') return new Date(appointment.scheduled_for) > now ? 'attendMeeting' : 'confirmTransfer';
  return 'arrangeMeeting';
}

export function formatLocalDeadline(value, language) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(date);
}
