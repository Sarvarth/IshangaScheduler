-- Store state, batch, and cluster metadata from the North Region Ishanga roster.

alter table public.people
  add column if not exists state text,
  add column if not exists cluster text,
  add column if not exists batch text,
  add column if not exists gender text,
  add column if not exists foundation_email text,
  add column if not exists personal_email text,
  add column if not exists secondary_center text,
  add column if not exists area_of_expertise text;

alter table public.people alter column region set default 'North Region';