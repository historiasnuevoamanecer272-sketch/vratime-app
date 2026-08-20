import { supabase } from '../supabaseClient';

const rpc = async (name, params = {}) => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
};

export const bookListing = (listingId) => rpc('book_listing', { target_listing_id: listingId });
export const cancelBooking = (transactionId) => rpc('cancel_booking', { target_transaction_id: transactionId });
export const completeDeal = (transactionId) => rpc('complete_deal', { target_transaction_id: transactionId });
export const submitReview = (transactionId, rating) => rpc('submit_review', { target_transaction_id: transactionId, target_rating: rating });
export const getMyDeals = () => rpc('get_my_deals');
export const saveMyProfile = (profile) => rpc('upsert_my_profile', {
  profile_name: profile.full_name,
  profile_language: profile.language,
  profile_messenger: profile.messenger_type,
  profile_contact: profile.contact_value,
});
