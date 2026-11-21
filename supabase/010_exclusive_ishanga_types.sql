-- A person may be an SPS Ishanga or a Satsang Ishanga, but not both.

create or replace function public.enforce_single_sps_satsang_type()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type_name text;
begin
  select name into v_type_name from public.ishanga_types where id = new.type_id;
  if v_type_name in ('SPS Ishanga', 'Satsang Ishanga') then
    perform 1 from public.people where id = new.person_id for update;
    if exists (
      select 1
      from public.person_types pt
      join public.ishanga_types it on it.id = pt.type_id
      where pt.person_id = new.person_id
        and pt.type_id <> new.type_id
        and it.name in ('SPS Ishanga', 'Satsang Ishanga')
    ) then
      raise exception 'An Ishanga can only be one of SPS Ishanga or Satsang Ishanga';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists person_types_single_ishanga_category on public.person_types;
create trigger person_types_single_ishanga_category
before insert or update of person_id, type_id on public.person_types
for each row execute function public.enforce_single_sps_satsang_type();