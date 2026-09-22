import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260922000000_roles_moderation_reports_support.sql');
const source = (await fs.readFile(migrationPath, 'utf8')).replace(/\r\n/g, '\n');
const promoteScriptPath = path.join(root, 'scripts', 'promote-first-admin.mjs');
const promoteSource = (await fs.readFile(promoteScriptPath, 'utf8')).replace(/\r\n/g, '\n');

const requireText = (text, label) => {
  if (!source.includes(text)) throw new Error(`Plan feature check failed: ${label}`);
};

for (const table of ['moderation_actions', 'reports', 'reputation_penalties', 'user_feedback']) {
  requireText(`create table if not exists public.${table}`, `${table} table`);
  requireText(`alter table public.${table} enable row level security`, `${table} RLS`);
}

for (const column of ['app_role', 'avatar_url', 'rating_penalty']) {
  requireText(`add column if not exists ${column}`, `profiles.${column}`);
}

for (const column of ['moderation_status', 'moderation_reason', 'location_verified_at']) {
  requireText(`add column if not exists ${column}`, `listings.${column}`);
}

for (const signature of [
  'set_user_role(target_user_id uuid, target_role text)',
  'moderate_listing(target_listing_id uuid, decision text, reason text default null)',
  'create_report(target_kind text, target_id uuid, reason text, details text default null)',
  'resolve_report(target_report_id uuid, decision text, penalty numeric default 0)',
  'create_feedback(feedback_type text, message text, screenshot_url text default null)',
  'set_feedback_status(target_feedback_id uuid, next_status text)',
]) requireText(`function public.${signature}`, signature);

requireText("selected_listing.moderation_status <> 'approved'", 'booking requires moderation approval');
requireText('selected_listing.location_verified_at is null', 'booking requires verified location');
requireText('selected_listing.lat not between -90 and 90', 'booking requires valid latitude');
requireText('selected_listing.lng not between -180 and 180', 'booking requires valid longitude');
if (!/expires_at[\s\S]{0,180}now\(\) \+ interval '48 hours'/.test(source)) {
  throw new Error('Plan feature check failed: requests expire after 48 hours');
}
if (!/expires_at[\s\S]{0,180}now\(\) \+ interval '24 hours'/.test(source)) {
  throw new Error('Plan feature check failed: accepted reservations expire after 24 hours');
}
requireText("check (app_role in ('user', 'moderator', 'admin'))", 'role allowlist');
requireText('greatest(1,', 'effective rating floor');
if (!promoteSource.includes('SUPABASE_ADMIN_USER_ID') || !promoteSource.includes("app_role: 'admin'")) {
  throw new Error('Plan feature check failed: protected first-admin operation');
}

process.stdout.write('Roles, moderation, reports, feedback and deadline contracts passed.\n');
