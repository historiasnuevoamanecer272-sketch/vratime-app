import { supabase } from '../supabaseClient';
import { normalizeContacts } from './contacts';

const rpc = async (name, params = {}) => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
};

export const bookListing = (listingId, requestedQuantity = 1) => rpc('book_listing', { target_listing_id: listingId, requested_quantity: Number(requestedQuantity) || 1 });
export const acceptDeal = (transactionId) => rpc('accept_deal', { target_transaction_id: transactionId });
export const cancelBooking = (transactionId) => rpc('cancel_booking', { target_transaction_id: transactionId });
export const confirmHandover = (transactionId) => rpc('confirm_handover', { target_transaction_id: transactionId });
export const confirmLoanHandover = (transactionId) => rpc('confirm_loan_handover', { target_transaction_id: transactionId });
export const confirmLoanReturn = (transactionId) => rpc('confirm_loan_return', { target_transaction_id: transactionId });
export const getImpactTotals = () => rpc('get_impact_totals');
export const getMyDiscoveryFeed = () => rpc('get_my_discovery_feed');
export const saveSearch = (query, filters = {}, notifyDaily = true) => rpc('save_search', { search_query: query, search_filters: filters, wants_daily_digest: notifyDaily });
export const deleteSavedSearch = async (searchId, userId) => {
  const { data, error } = await supabase.from('saved_searches').delete().eq('id', searchId).eq('user_id', userId).select('id').single();
  if (error) throw error;
  return data;
};
export const toggleListingFavourite = (listingId) => rpc('toggle_listing_favourite', { target_listing_id: listingId });
export const markInboxItemRead = (inboxId) => rpc('mark_inbox_item_read', { target_inbox_id: inboxId });
export const getCollectionPoints = () => rpc('get_collection_points');
export const createCollectionPoint = ({ name, lat, lng, locationLabel, materials, description = null }) => rpc('create_collection_point', { point_name: name, point_lat: Number(lat), point_lng: Number(lng), point_location_label: locationLabel, material_keys: materials, point_description: description });
export const voteCollectionPoint = (pointId, value) => rpc('vote_collection_point', { target_point_id: pointId, vote_value: value });
export const submitReview = (transactionId, rating) => rpc('submit_review', { target_transaction_id: transactionId, target_rating: rating });
export const deactivateListing = (listingId) => rpc('deactivate_listing', { target_listing_id: listingId });
export const updateMyListing = (listing) => rpc('update_my_listing', {
  target_listing_id: listing.id,
  target_category_id: listing.category_id,
  target_category: listing.category,
  target_category_path: listing.category_path,
  target_description: listing.description || null,
  target_quantity: Number(listing.quantity),
  target_lat: Number(listing.lat),
  target_lng: Number(listing.lng),
  target_location_label: listing.location_label,
  target_image_url: listing.image_url || null,
  target_image_urls: listing.image_urls || [],
  target_condition: listing.condition || 'usable',
  target_pickup_mode: listing.pickup_mode || 'public_place',
  target_pickup_windows: listing.pickup_windows || [],
  target_weight_kg: listing.weight_kg || null,
  target_loan_duration_days: listing.loan_duration_days || null,
});
export const createReport = ({ targetKind, targetId, reason, details }) => rpc('create_report', { target_kind: targetKind, target_id: targetId, reason, details: details || null });
export const createFeedback = ({ type, message, screenshotUrl = null, requestId }) => requestId == null ? rpc('create_feedback', { feedback_type: type, message, screenshot_url: screenshotUrl }) : rpc('create_feedback_once', { feedback_type: type, message, screenshot_url: screenshotUrl, request_id: requestId });
export const requestFeedbackTelegramDelivery = async (feedbackId) => {
  const { data, error } = await supabase.functions.invoke('feedback-telegram', { body: { feedbackId } });
  if (error) throw error;
  return data;
};
export const moderateListing = (listingId, decision, reason = null) => rpc('moderate_listing', { target_listing_id: listingId, decision, reason });
export const resolveReport = (reportId, decision, penalty = 0) => rpc('resolve_report', { target_report_id: reportId, decision, penalty });
export const setFeedbackStatus = (feedbackId, status) => rpc('set_feedback_status', { target_feedback_id: feedbackId, next_status: status });
export const setUserRole = (userId, role) => rpc('set_user_role', { target_user_id: userId, target_role: role });
export const setMyAvatar = (avatarUrl) => rpc('set_my_avatar', { next_avatar_url: avatarUrl || null });
export const getMyDeals = () => rpc('get_my_deals');
export const getPublicMapListings = () => rpc('get_public_map_listings_v2');
export const getTransactionPickupDetails = (transactionId) => rpc('get_transaction_pickup_details', { target_transaction_id: transactionId });
export const scheduleHandover = (transactionId, scheduledFor, note = null) => rpc('schedule_handover', { target_transaction_id: transactionId, scheduled_for: scheduledFor, note });
export const setHandoverOutcome = (appointmentId, outcome) => rpc('set_handover_outcome', { target_appointment_id: appointmentId, outcome });
export const getMyReliability = () => rpc('get_my_reliability');
export const refreshExpiredDeals = () => rpc('refresh_expired_deals');
export const getEcoLeaderboard = (limit = 20) => rpc('get_eco_leaderboard', { limit_count: limit });
export const getFundingProgress = async () => {
  const data = await rpc('get_funding_progress');
  return Array.isArray(data) ? data[0] || null : data;
};
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

// Snapshot the expected user's bearer before a push preference RPC so an auth
// change during browser permission/subscription work cannot register as another
// account. SQL still derives ownership from auth.uid(), never from this option.
const pushPreferenceRpc = async (name, params, { expectedUserId, signal } = {}) => {
  if (signal?.aborted) throw new Error('push_auth_changed');
  const { data: auth, error: authError } = await supabase.auth.getSession();
  const session = auth?.session;
  if (authError || !session?.access_token || !expectedUserId || session.user?.id !== expectedUserId || signal?.aborted) throw new Error('push_auth_changed');
  let request = supabase.rpc(name, params).setHeader('Authorization', `Bearer ${session.access_token}`);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (signal?.aborted) throw new Error('push_auth_changed');
  if (error) throw new Error('push_request_failed');
  return data;
};
export const getPushPublicConfig = async () => {
  const { data, error } = await supabase.functions.invoke('notifications-dispatch', { body: { action: 'config' } });
  if (error) throw new Error('push_config_unavailable');
  return data;
};
export const registerPushSubscription = (subscription, options) => pushPreferenceRpc('register_push_subscription', { push_endpoint: subscription.endpoint, push_p256dh: subscription.keys?.p256dh, push_auth: subscription.keys?.auth }, options);
export const disablePushSubscription = (endpoint, options) => pushPreferenceRpc('disable_push_subscription', { push_endpoint: endpoint }, options);
export const getMyPushStatus = (endpoint, options) => pushPreferenceRpc('get_my_push_status', { push_endpoint: endpoint }, options);
export const disablePushSubscriptionForSession = async (endpoint, previousSession, { signal } = {}) => {
  if (!previousSession?.user?.id || !previousSession.access_token || signal?.aborted) throw new Error('push_auth_changed');
  let request = supabase.rpc('disable_push_subscription', { push_endpoint: endpoint }).setHeader('Authorization', `Bearer ${previousSession.access_token}`);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (signal?.aborted) throw new Error('push_auth_changed');
  if (error) throw new Error('push_request_failed');
  return data;
};
