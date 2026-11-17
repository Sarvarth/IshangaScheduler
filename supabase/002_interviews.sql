-- =====================================================================
-- Ishanga Scheduler - Interviews module
-- Run AFTER schema.sql, once, in Supabase Dashboard > SQL Editor.
-- =====================================================================

-- ---------- Columns on existing tables ----------
alter table public.people add column if not exists languages text[] not null default '{}';

alter table public.candidates
  add column if not exists region text,
  add column if not exists language text,
  add column if not exists booking_token text not null unique
    default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  add column if not exists booking_open boolean not null default true,
  add column if not exists link_sent_at timestamptz,
  add column if not exists requested_times text,
  add column if not exists requested_at timestamptz;

-- ---------- App settings (key/value) ----------
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('interview_guidelines',
'• The interview takes about 30 minutes over a phone or video call.
• Please be in a quiet place with good network at the chosen time.
• Keep your phone charged and answer calls from unknown numbers at that time.
• If you can no longer make it, please change the time using this same link at least 12 hours before.
• Be yourself – there are no right or wrong answers.'),
  ('min_notice_hours', '12'),
  ('languages', 'Hindi, English, Punjabi, Urdu, Bengali, Gujarati, Marathi')
on conflict (key) do nothing;

-- ---------- Availability, shortlist, bookings ----------
create table if not exists public.interviewer_availability (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists interviewer_availability_person_idx on public.interviewer_availability (person_id, starts_at);

create table if not exists public.candidate_shortlist (
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (candidate_id, person_id)
);

create table if not exists public.interview_bookings (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','completed','cancelled','no_show')),
  booked_by text not null default 'candidate' check (booked_by in ('candidate','coordinator')),
  meeting_link text,
  activity_id uuid references public.activities(id) on delete set null,
  acknowledged_at timestamptz,
  cancelled_reason text,
  cancelled_by text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists interview_bookings_one_active on public.interview_bookings (candidate_id) where status = 'booked';
create unique index if not exists interview_bookings_no_double on public.interview_bookings (person_id, starts_at) where status = 'booked';

-- ---------- RLS ----------
alter table public.app_settings enable row level security;
alter table public.interviewer_availability enable row level security;
alter table public.candidate_shortlist enable row level security;
alter table public.interview_bookings enable row level security;

create policy app_settings_read on public.app_settings for select to authenticated using (public.has_perm('view'));
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.has_perm('manage_settings') or public.has_perm('manage_activities'))
  with check (public.has_perm('manage_settings') or public.has_perm('manage_activities'));

create policy availability_read on public.interviewer_availability for select to authenticated using (public.has_perm('view'));
create policy availability_write on public.interviewer_availability for all to authenticated
  using (public.has_perm('manage_activities') or (public.has_perm('opt_in') and person_id = public.my_person_id()))
  with check (public.has_perm('manage_activities') or (public.has_perm('opt_in') and person_id = public.my_person_id()));

create policy shortlist_read on public.candidate_shortlist for select to authenticated
  using (public.has_perm('manage_activities') or public.has_perm('view_dashboard') or person_id = public.my_person_id());
create policy shortlist_write on public.candidate_shortlist for all to authenticated
  using (public.has_perm('manage_activities')) with check (public.has_perm('manage_activities'));

-- Bookings are only changed through the functions below
create policy bookings_read on public.interview_bookings for select to authenticated
  using (public.has_perm('manage_activities') or public.has_perm('view_dashboard') or person_id = public.my_person_id());

-- Candidate personal details: only coordinators/dashboard roles, or the Ishanga interviewing them
drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates for select to authenticated
  using (
    public.has_perm('manage_activities') or public.has_perm('view_dashboard')
    or exists (select 1 from public.interview_bookings b where b.candidate_id = candidates.id and b.person_id = public.my_person_id())
  );

-- ---------- Internal helpers (not callable from the app) ----------
create or replace function public._open_slots(p_candidate uuid)
returns table (slot_start timestamptz, slot_person uuid)
language sql stable security definer set search_path = public as $$
  select s.t, a.person_id
  from public.candidate_shortlist cs
  join public.people p on p.id = cs.person_id and p.is_active
  join public.interviewer_availability a on a.person_id = cs.person_id
  cross join lateral generate_series(a.starts_at, a.ends_at - interval '30 minutes', interval '30 minutes') as s(t)
  where cs.candidate_id = p_candidate
    and s.t >= now() + make_interval(hours => coalesce((select value::int from public.app_settings where key = 'min_notice_hours'), 12))
    and s.t < now() + interval '45 days'
    and not exists (
      select 1 from public.interview_bookings b
      where b.person_id = a.person_id
        and (b.status = 'booked' or (b.status = 'cancelled' and b.cancelled_by = 'interviewer'))
        and b.starts_at < s.t + interval '30 minutes' and b.ends_at > s.t
    );
$$;

create or replace function public._cancel_bookings(p_ids uuid[], p_reason text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.assignments set status = 'cancelled'
   where activity_id in (select activity_id from public.interview_bookings where id = any(p_ids) and status = 'booked');
  update public.activities set status = 'cancelled'
   where id in (select activity_id from public.interview_bookings where id = any(p_ids) and status = 'booked');
  update public.interview_bookings
     set status = 'cancelled', cancelled_reason = p_reason, cancelled_by = p_by, cancelled_at = now()
   where id = any(p_ids) and status = 'booked';
end $$;

-- Creates the booking plus an Interview activity + assignment so it shows in history/dashboard/export
create or replace function public._create_booking(p_candidate uuid, p_person uuid, p_start timestamptz, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_c public.candidates;
  v_type uuid; v_role uuid; v_act uuid; v_id uuid;
  v_end timestamptz := p_start + interval '30 minutes';
begin
  select * into v_c from public.candidates where id = p_candidate;
  if exists (select 1 from public.interview_bookings
             where person_id = p_person and status = 'booked' and starts_at < v_end and ends_at > p_start) then
    raise exception 'The interviewer already has an interview at this time';
  end if;
  select id into v_type from public.activity_types where has_candidates order by sort_order limit 1;
  if v_type is not null then
    insert into public.activities (activity_type_id, title, start_date, start_time, city, region, status, opt_in_open, created_by)
    values (v_type, 'Interview: ' || v_c.full_name,
            (p_start at time zone 'Asia/Kolkata')::date, (p_start at time zone 'Asia/Kolkata')::time,
            v_c.city, coalesce(v_c.region, 'North Bharat'), 'confirmed', false, null)
    returning id into v_act;
    select id into v_role from public.activity_roles where activity_type_id = v_type order by sort_order limit 1;
    if v_role is not null then
      insert into public.assignments (activity_id, person_id, role_id, status, created_by)
      values (v_act, p_person, v_role, 'confirmed', null);
    end if;
  end if;
  insert into public.interview_bookings (candidate_id, person_id, starts_at, ends_at, booked_by, activity_id)
  values (p_candidate, p_person, p_start, v_end, p_by, v_act)
  returning id into v_id;
  update public.candidates set activity_id = v_act, requested_times = null, requested_at = null where id = p_candidate;
  return v_id;
end $$;

-- ---------- Public functions for the candidate booking link (no login) ----------
create or replace function public.booking_page(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.candidates; v_b public.interview_bookings;
begin
  select * into v_c from public.candidates where booking_token = p_token;
  if not found then return null; end if;
  select * into v_b from public.interview_bookings
   where candidate_id = v_c.id and status in ('booked','completed') order by created_at desc limit 1;
  return jsonb_build_object(
    'name', split_part(v_c.full_name, ' ', 1),
    'language', v_c.language,
    'training', (select name from public.ishanga_types where id = v_c.target_type_id),
    'open', v_c.booking_open and v_c.result = 'pending',
    'guidelines', (select value from public.app_settings where key = 'interview_guidelines'),
    'requested_times', v_c.requested_times,
    'booking', case when v_b.id is null then null else jsonb_build_object(
      'starts_at', v_b.starts_at, 'ends_at', v_b.ends_at, 'status', v_b.status, 'meeting_link', v_b.meeting_link) end,
    'slots', coalesce((select jsonb_agg(t order by t) from (select distinct slot_start as t from public._open_slots(v_c.id)) x), '[]'::jsonb)
  );
end $$;

create or replace function public.book_interview(p_token text, p_start timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.candidates; v_person uuid;
begin
  select * into v_c from public.candidates where booking_token = p_token for update;
  if not found or not v_c.booking_open or v_c.result <> 'pending' then
    raise exception 'This booking link is no longer active. Please contact the coordinator.';
  end if;
  -- Spread load: prefer the free Ishanga with the fewest upcoming interviews
  select s.slot_person into v_person
    from public._open_slots(v_c.id) s
   where s.slot_start = p_start
   order by (select count(*) from public.interview_bookings b
              where b.person_id = s.slot_person and b.status = 'booked' and b.starts_at > now()), random()
   limit 1;
  if v_person is null then
    raise exception 'Sorry, this time was just taken. Please choose another time.';
  end if;
  perform public._cancel_bookings(
    array(select id from public.interview_bookings where candidate_id = v_c.id and status = 'booked'),
    'Rescheduled by candidate', 'candidate');
  perform public._create_booking(v_c.id, v_person, p_start, 'candidate');
  return public.booking_page(p_token);
exception when unique_violation then
  raise exception 'Sorry, this time was just taken. Please choose another time.';
end $$;

create or replace function public.cancel_my_interview(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.candidates where booking_token = p_token;
  if v_id is null then raise exception 'Invalid link'; end if;
  perform public._cancel_bookings(
    array(select id from public.interview_bookings where candidate_id = v_id and status = 'booked'),
    'Cancelled by candidate', 'candidate');
  return public.booking_page(p_token);
end $$;

create or replace function public.request_other_times(p_token text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.candidates set requested_times = left(trim(p_text), 1000), requested_at = now()
   where booking_token = p_token;
  if not found then raise exception 'Invalid link'; end if;
  return public.booking_page(p_token);
end $$;

-- ---------- Functions for logged-in coordinators / Ishangas ----------
create or replace function public.staff_book_interview(p_candidate uuid, p_person uuid, p_start timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('manage_activities') then raise exception 'Not allowed'; end if;
  perform public._cancel_bookings(
    array(select id from public.interview_bookings where candidate_id = p_candidate and status = 'booked'),
    'Rescheduled by coordinator', 'coordinator');
  return public._create_booking(p_candidate, p_person, p_start, 'coordinator');
end $$;

create or replace function public.cancel_interview(p_booking uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_person uuid;
begin
  select person_id into v_person from public.interview_bookings where id = p_booking;
  if public.has_perm('manage_activities') then
    perform public._cancel_bookings(array[p_booking], p_reason, 'coordinator');
  elsif v_person = public.my_person_id() then
    perform public._cancel_bookings(array[p_booking], p_reason, 'interviewer');
  else
    raise exception 'Not allowed';
  end if;
end $$;

create or replace function public.acknowledge_interview(p_booking uuid)
returns void language sql security definer set search_path = public as $$
  update public.interview_bookings set acknowledged_at = now()
   where id = p_booking and person_id = public.my_person_id() and acknowledged_at is null;
$$;

create or replace function public.set_interview_link(p_booking uuid, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.interview_bookings set meeting_link = nullif(trim(p_link), '')
   where id = p_booking and (person_id = public.my_person_id() or public.has_perm('manage_activities'));
end $$;

create or replace function public.record_interview_outcome(p_booking uuid, p_status text, p_result text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.interview_bookings;
begin
  select * into v_b from public.interview_bookings where id = p_booking;
  if not found or not (v_b.person_id = public.my_person_id() or public.has_perm('manage_activities')) then
    raise exception 'Not allowed';
  end if;
  if p_status not in ('completed','no_show') then raise exception 'Invalid status'; end if;
  update public.interview_bookings set status = p_status where id = p_booking;
  update public.activities set status = 'completed' where id = v_b.activity_id;
  update public.assignments set status = case when p_status = 'completed' then 'completed' else 'cancelled' end
   where activity_id = v_b.activity_id;
  update public.candidates
     set result = coalesce(nullif(p_result, ''), result),
         notes = case when coalesce(trim(p_notes), '') = '' then notes
                      else concat_ws(E'\n', notes, to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ': ' || trim(p_notes)) end
   where id = v_b.candidate_id;
end $$;

-- ---------- Permissions on functions ----------
revoke execute on function public._open_slots(uuid) from public, anon, authenticated;
revoke execute on function public._cancel_bookings(uuid[], text, text) from public, anon, authenticated;
revoke execute on function public._create_booking(uuid, uuid, timestamptz, text) from public, anon, authenticated;

revoke execute on function public.staff_book_interview(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.cancel_interview(uuid, text) from public, anon;
revoke execute on function public.acknowledge_interview(uuid) from public, anon;
revoke execute on function public.set_interview_link(uuid, text) from public, anon;
revoke execute on function public.record_interview_outcome(uuid, text, text, text) from public, anon;
grant execute on function public.staff_book_interview(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.cancel_interview(uuid, text) to authenticated;
grant execute on function public.acknowledge_interview(uuid) to authenticated;
grant execute on function public.set_interview_link(uuid, text) to authenticated;
grant execute on function public.record_interview_outcome(uuid, text, text, text) to authenticated;

grant execute on function public.booking_page(text) to anon, authenticated;
grant execute on function public.book_interview(text, timestamptz) to anon, authenticated;
grant execute on function public.cancel_my_interview(text) to anon, authenticated;
grant execute on function public.request_other_times(text, text) to anon, authenticated;
