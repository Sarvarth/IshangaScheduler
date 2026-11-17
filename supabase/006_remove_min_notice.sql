-- =====================================================================
-- Ishanga Scheduler - Remove minimum booking notice
-- Run after 005_auto_link_logins.sql. Any future free time can now be booked.
-- =====================================================================

create or replace function public._open_slots(p_candidate uuid)
returns table (slot_start timestamptz, slot_person uuid)
language sql stable security definer set search_path = public as $$
  select s.t, a.person_id
  from public.candidate_shortlist cs
  join public.people p on p.id = cs.person_id and p.is_active
  join public.interviewer_availability a on a.person_id = cs.person_id
  cross join lateral generate_series(a.starts_at, a.ends_at - interval '30 minutes', interval '30 minutes') as s(t)
  where cs.candidate_id = p_candidate
    and s.t > now()
    and s.t < now() + interval '45 days'
    and not exists (
      select 1 from public.interview_bookings b
      where b.person_id = a.person_id
        and (b.status = 'booked' or (b.status = 'cancelled' and b.cancelled_by = 'interviewer'))
        and b.starts_at < s.t + interval '30 minutes' and b.ends_at > s.t
    );
$$;

revoke execute on function public._open_slots(uuid) from public, anon, authenticated;

delete from public.app_settings where key = 'min_notice_hours';
