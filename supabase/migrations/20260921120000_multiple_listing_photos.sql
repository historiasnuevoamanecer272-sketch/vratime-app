begin;

alter table public.listings
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.listings
set image_urls = jsonb_build_array(image_url)
where image_url is not null
  and image_urls = '[]'::jsonb;

commit;
