-- Prevent candidates from changing a slot after booking and refresh candidate guidelines.

insert into public.app_settings (key, value) values
  ('interview_guidelines',
'• The interview takes about 30 minutes over a phone or video call.
• Please be in a quiet place with a good network connection at the chosen time.
• Please join a few minutes early from a private space with your camera turned on for video interviews.')
on conflict (key) do update set value = excluded.value, updated_at = now();

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
    'booking_locked', exists (
      select 1 from public.interview_bookings
      where candidate_id = v_c.id and booked_by = 'candidate'
    ),
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
  if exists (
    select 1 from public.interview_bookings
    where candidate_id = v_c.id and booked_by = 'candidate'
  ) then
    raise exception 'You have already selected an interview time. Please contact the coordinator to change it.';
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
  perform public._create_booking(v_c.id, v_person, p_start, 'candidate');
  return public.booking_page(p_token);
exception when unique_violation then
  raise exception 'Sorry, this time was just taken. Please choose another time.';
end $$;