-- =====================================================================
-- Ishanga Scheduler - Reassign interviewer (run after 002_interviews.sql)
-- Swaps the Ishanga on a booking while keeping the same time, so the candidate sees no change.
-- =====================================================================

create or replace function public.reassign_interview(p_booking uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_b public.interview_bookings;
begin
  if not public.has_perm('manage_activities') then raise exception 'Not allowed'; end if;
  select * into v_b from public.interview_bookings where id = p_booking and status = 'booked' for update;
  if not found then raise exception 'Booking not found or no longer active'; end if;
  if v_b.person_id = p_person then return; end if;
  if exists (select 1 from public.interview_bookings
             where person_id = p_person and status = 'booked' and id <> p_booking
               and starts_at < v_b.ends_at and ends_at > v_b.starts_at) then
    raise exception 'This Ishanga already has an interview at that time';
  end if;

  -- Keep a record for the previous interviewer so it shows in their history
  insert into public.interview_bookings
    (candidate_id, person_id, starts_at, ends_at, status, booked_by, cancelled_reason, cancelled_by, cancelled_at)
  values
    (v_b.candidate_id, v_b.person_id, v_b.starts_at, v_b.ends_at, 'cancelled', v_b.booked_by,
     'Reassigned to another Ishanga', 'coordinator', now());

  update public.interview_bookings
     set person_id = p_person, acknowledged_at = null
   where id = p_booking;

  update public.assignments set person_id = p_person
   where activity_id = v_b.activity_id and person_id = v_b.person_id;

  insert into public.candidate_shortlist (candidate_id, person_id)
  values (v_b.candidate_id, p_person) on conflict do nothing;
end $$;

revoke execute on function public.reassign_interview(uuid, uuid) from public, anon;
grant execute on function public.reassign_interview(uuid, uuid) to authenticated;
