-- =====================================================================
-- Ishanga Scheduler - Google Meet links + Google Calendar sync
-- Run after 003_reassign_interviewer.sql.
-- =====================================================================

alter table public.people add column if not exists meet_link text;
alter table public.interview_bookings
  add column if not exists cal_event_ishanga text,
  add column if not exists cal_event_candidate text,
  add column if not exists calendar_status text,
  add column if not exists calendar_synced_at timestamptz;

-- Only allow https links (they are rendered as clickable links)
alter table public.people drop constraint if exists people_meet_link_https;
alter table public.people add constraint people_meet_link_https check (meet_link is null or meet_link ~* '^https://');
alter table public.interview_bookings drop constraint if exists bookings_meeting_link_https;
alter table public.interview_bookings add constraint bookings_meeting_link_https check (meeting_link is null or meeting_link ~* '^https://') not valid;

-- New bookings / reassignments use the interviewer's own Meet link
create or replace function public.booking_default_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.meeting_link is null then
    select meet_link into new.meeting_link from public.people where id = new.person_id;
  elsif tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    new.meeting_link := coalesce((select meet_link from public.people where id = new.person_id), new.meeting_link);
  end if;
  return new;
end $$;

drop trigger if exists interview_bookings_default_link on public.interview_bookings;
create trigger interview_bookings_default_link
before insert or update of person_id on public.interview_bookings
for each row execute function public.booking_default_link();

-- Ishangas can maintain their own Meet link and email (used for calendar invites)
create or replace function public.set_my_interview_profile(p_meet_link text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_person_id(); v_old text; v_link text := nullif(trim(p_meet_link), '');
begin
  if v_me is null then raise exception 'Your login is not linked to an Ishanga profile'; end if;
  if v_link is not null and v_link !~* '^https://' then raise exception 'Please paste the full link, starting with https://'; end if;
  select meet_link into v_old from public.people where id = v_me;
  update public.people
     set meet_link = v_link, email = coalesce(nullif(trim(p_email), ''), email)
   where id = v_me;
  -- Upcoming interviews that used the old/no link get the new one
  update public.interview_bookings
     set meeting_link = v_link
   where person_id = v_me and status = 'booked' and starts_at > now()
     and (meeting_link is null or meeting_link is not distinct from v_old);
end $$;

revoke execute on function public.set_my_interview_profile(text, text) from public, anon;
grant execute on function public.set_my_interview_profile(text, text) to authenticated;
