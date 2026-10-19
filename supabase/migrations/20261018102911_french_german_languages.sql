-- Add FR/DE without replacing profile validation or changing RPC permissions.
begin;

do $migration$
declare
  profile_function regprocedure;
  profile_definition text;
  old_guard constant text := 'profile_language not in (''ru'', ''me'', ''en'')';
  new_guard constant text := 'profile_language not in (''ru'', ''me'', ''en'', ''fr'', ''de'')';
begin
  foreach profile_function in array array[
    'public.upsert_my_profile(text,text,text,text)'::regprocedure,
    'public.upsert_my_profile_v2(text,text,jsonb)'::regprocedure
  ] loop
    profile_definition := pg_get_functiondef(profile_function);
    if position(old_guard in profile_definition) > 0 then
      execute replace(profile_definition, old_guard, new_guard);
    elsif position(new_guard in profile_definition) = 0 then
      raise exception 'Unexpected language validation in %; inspect before changing it', profile_function;
    end if;
  end loop;
end;
$migration$;

-- Preserve every existing translation, including RU/ME/EN.
update public.categories as category
set translations = coalesce(category.translations, '{}'::jsonb)
  || jsonb_build_object('fr', additions.fr, 'de', additions.de)
from (values
  ('glass', 'Verre', 'Glas'),
  ('cloth', 'Textiles', 'Textilien'),
  ('box', 'Papier', 'Papier'),
  ('pallet', 'Emballages', 'Verpackungen'),
  ('glass/bottles', 'Bouteilles', 'Flaschen'),
  ('glass/jars', 'Bocaux', 'Gläser'),
  ('cloth/clothing', 'Vêtements', 'Kleidung'),
  ('cloth/rags', 'Chiffons', 'Putzlappen'),
  ('box/cardboard', 'Carton', 'Karton'),
  ('box/office-paper', 'Papier de bureau', 'Büropapier'),
  ('pallet/egg-crates', 'Boîtes à œufs', 'Eierkartons'),
  ('pallet/pallets', 'Palettes', 'Paletten'),
  ('glass/bottles/clear-bottle', 'Bouteilles transparentes', 'Klare Flaschen'),
  ('glass/bottles/green-bottle', 'Bouteilles vertes', 'Grüne Flaschen'),
  ('glass/bottles/brown-bottle', 'Bouteilles brunes', 'Braune Flaschen'),
  ('glass/jars/clear-jar', 'Bocaux transparents', 'Klare Gläser'),
  ('glass/jars/colored-jar', 'Bocaux colorés', 'Farbige Gläser'),
  ('cloth/clothing/men-cloth', 'Vêtements pour hommes', 'Herrenkleidung'),
  ('cloth/clothing/women-cloth', 'Vêtements pour femmes', 'Damenkleidung'),
  ('cloth/clothing/kids-cloth', 'Vêtements pour enfants', 'Kinderkleidung')
) as additions(category_path, fr, de)
where category.category_path = additions.category_path;

commit;
