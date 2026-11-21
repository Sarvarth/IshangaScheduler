-- Add center-based Satsang events with scheduled visibility.

alter table public.activities
  add column if not exists center text,
  add column if not exists is_visible boolean not null default true,
  add column if not exists visible_from date;

drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities for select to authenticated
  using (
    public.has_perm('manage_activities')
    or (
      public.has_perm('view')
      and is_visible
      and (visible_from is null or visible_from <= current_date)
    )
  );

drop policy if exists assignments_self_opt_in on public.assignments;
create policy assignments_self_opt_in on public.assignments for insert to authenticated
  with check (
    public.has_perm('opt_in')
    and person_id = public.my_person_id()
    and status = 'opted_in'
    and exists (
      select 1 from public.activities a
      where a.id = activity_id
        and a.opt_in_open
        and a.is_visible
        and (a.visible_from is null or a.visible_from <= current_date)
        and a.status in ('planned','confirmed')
    )
    and exists (select 1 from public.activity_roles r where r.id = role_id and r.allow_self_opt_in)
  );