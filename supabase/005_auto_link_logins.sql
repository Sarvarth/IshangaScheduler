-- =====================================================================
-- Ishanga Scheduler - Auto-link logins to Ishanga profiles by email
-- Run after 004_meet_and_calendar.sql.
-- Links only verified emails (Google sign-in is always verified) and only when exactly one
-- Ishanga profile has that email. Linking never grants a role - an admin still approves.
-- =====================================================================

create or replace function public.link_profile_by_email(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_person uuid;
begin
  select lower(email) into v_email from auth.users where id = p_user and email_confirmed_at is not null;
  if v_email is null or exists (select 1 from public.profiles where id = p_user and person_id is not null) then
    return;
  end if;
  if (select count(*) from public.people where lower(email) = v_email) <> 1 then return; end if;
  select p.id into v_person from public.people p
   where lower(p.email) = v_email
     and not exists (select 1 from public.profiles pr where pr.person_id = p.id);
  if v_person is not null then
    update public.profiles set person_id = v_person where id = p_user;
  end if;
end $$;

revoke execute on function public.link_profile_by_email(uuid) from public, anon, authenticated;

-- New sign-ups: create profile, then try to link
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not exists (select 1 from public.profiles) then
    select id into r from public.app_roles where name = 'Admin';
  else
    select id into r from public.app_roles where is_default limit 1;
  end if;
  insert into public.profiles (id, email, full_name, role_id)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email), r);
  perform public.link_profile_by_email(new.id);
  return new;
end $$;

-- Email/password users: link once they confirm their email
create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.link_profile_by_email(new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
after update of email_confirmed_at on auth.users
for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.handle_user_confirmed();

-- Ishanga added/edited after the person already signed up
create or replace function public.handle_person_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if new.email is null then return new; end if;
  for u in select pr.id from public.profiles pr join auth.users au on au.id = pr.id
            where lower(au.email) = lower(new.email) and pr.person_id is null loop
    perform public.link_profile_by_email(u);
  end loop;
  return new;
end $$;

drop trigger if exists people_link_login on public.people;
create trigger people_link_login
after insert or update of email on public.people
for each row execute function public.handle_person_email();

-- One-time backfill for existing logins
do $$
declare u uuid;
begin
  for u in select id from public.profiles where person_id is null loop
    perform public.link_profile_by_email(u);
  end loop;
end $$;
