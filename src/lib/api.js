import { supabase } from '../supabaseClient';
import { normalizeContacts } from './contacts';

const rpc = async (name, params = {}) => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
};

export const bookListing = (listingId) => rpc('book_listing', { target_listing_id: listingId });
export const acceptDeal = (transactionId) => rpc('accept_deal', { target_transaction_id: transactionId });
export const cancelBooking = (transactionId) => rpc('cancel_booking', { target_transaction_id: transactionId });
export const confirmHandover = (transactionId) => rpc('confirm_handover', { target_transaction_id: transactionId });
export const submitReview = (transactionId, rating) => rpc('submit_review', { target_transaction_id: transactionId, target_rating: rating });
export const deactivateListing = (listingId) => rpc('deactivate_listing', { target_listing_id: listingId });
export const getMyDeals = () => rpc('get_my_deals');
export const refreshExpiredDeals = () => rpc('refresh_expired_deals');
export const getEcoLeaderboard = (limit = 20) => rpc('get_eco_leaderboard', { limit_count: limit });
export const setRankingParticipation = (enabled) => rpc('set_ranking_participation', { enabled });
export const saveMyProfile = async (profile) => {
  const contacts = normalizeContacts(profile.contacts);
  try {
    return await rpc('upsert_my_profile_v2', {
      profile_name: profile.full_name,
      profile_language: profile.language,
      profile_channels: contacts,
    });
  } catch (error) {
    // Keep the single-contact profile editable until the new migration is
    // applied. Multiple channels are never silently discarded.
    if (!/upsert_my_profile_v2|schema cache|function/i.test(error.message || '')) throw error;
    if (contacts.length !== 1) throw new Error('multi_messenger_migration_required', { cause: error });
    return rpc('upsert_my_profile', {
      profile_name: profile.full_name,
      profile_language: profile.language,
      profile_messenger: contacts[0].messenger_type,
      profile_contact: contacts[0].contact_value,
    });
  }
};
