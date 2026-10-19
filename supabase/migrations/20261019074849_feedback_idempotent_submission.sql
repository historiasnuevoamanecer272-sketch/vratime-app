-- A committed request identity is scoped to one authenticated user and one
-- immutable normalized payload. No feedback text or screenshot URL is copied
-- into the private mapping. The existing create_feedback and its media/delivery
-- triggers remain the only path that creates feedback.
begin;

create schema if not exists feedback_private;
revoke all on schema feedback_private from public, anon, authenticated, service_role;

create table feedback_private.submission_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  feedback_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table feedback_private.submission_requests enable row level security;
revoke all on table feedback_private.submission_requests from public, anon, authenticated, service_role;

-- SECURITY DEFINER is required only to access the inaccessible claim table.
-- Identity always comes from auth.uid(); callers cannot choose another owner.
-- Every object is qualified and only authenticated can execute this wrapper.
create function public.create_feedback_once(feedback_type text, message text, screenshot_url text, request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_message text := pg_catalog.btrim(coalesce(message, ''));
  normalized_screenshot text := nullif(pg_catalog.btrim(coalesce(screenshot_url, '')), '');
  fingerprint bytea;
  saved_hash bytea;
  saved_feedback_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if request_id is null then raise exception 'feedback_request_id_required' using errcode = '22023'; end if;
  if feedback_type is null or feedback_type not in ('feature', 'category', 'problem', 'support') then
    raise exception 'Invalid feedback type' using errcode = '22023';
  end if;
  if pg_catalog.char_length(normalized_message) < 5 then
    raise exception 'Message is too short' using errcode = '22023';
  end if;

  fingerprint := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(feedback_type, normalized_message, normalized_screenshot)::text, 'UTF8'));
  -- Serialize matching identities for the lifetime of this transaction. A hash
  -- collision can only serialize unrelated callers; the composite PK and exact
  -- owner/request lookup still keep their feedback identities separate.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || ':' || request_id::text, 71034));
  select r.payload_hash, r.feedback_id into saved_hash, saved_feedback_id
  from feedback_private.submission_requests r
  where r.user_id = actor and r.request_id = create_feedback_once.request_id;
  if found then
    if saved_hash is distinct from fingerprint then
      raise exception 'feedback_request_payload_mismatch' using errcode = '22023';
    end if;
    return saved_feedback_id;
  end if;

  saved_feedback_id := public.create_feedback(feedback_type, normalized_message, normalized_screenshot);
  if saved_feedback_id is null then raise exception 'feedback_submission_failed'; end if;
  insert into feedback_private.submission_requests(user_id, request_id, payload_hash, feedback_id)
  values(actor, create_feedback_once.request_id, fingerprint, saved_feedback_id);
  return saved_feedback_id;
end;
$$;

revoke execute on function public.create_feedback_once(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_feedback_once(text, text, text, uuid) to authenticated;

commit;
