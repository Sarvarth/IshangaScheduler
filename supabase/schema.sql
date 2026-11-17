-- =====================================================================
-- Ishanga Scheduler - Supabase schema
-- Run this whole file once in Supabase Dashboard > SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Settings / lookup tables (all editable from the app's Settings page)
-- ---------------------------------------------------------------------

-- App roles control what a logged-in user can do. Permissions are free text so new ones can be added.
-- Known permissions: admin, view, view_dashboard, opt_in, manage_people, manage_activities,
--                    manage_settings, manage_users, export
create table public.app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  permissions text[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.ishanga_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  -- To be interviewed for training of this type, the candidate must already hold this type
  prerequisite_type_id uuid references public.ishanga_types(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.ishanga_attributes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  color text not null default 'orange',
  has_candidates boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.activity_roles (
  id uuid primary key default gen_random_uuid(),
  activity_type_id uuid not null references public.activity_types(id) on delete cascade,
  name text not null,
  description text,
  default_capacity int,
  allow_self_opt_in boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (activity_type_id, name)
);

-- If a role has no rows here, anyone can take it. Otherwise person must hold one of these types.
create table public.activity_role_eligibility (
  role_id uuid not null references public.activity_roles(id) on delete cascade,
  type_id uuid not null references public.ishanga_types(id) on delete cascade,
  primary key (role_id, type_id)
);

-- ---------------------------------------------------------------------
-- People (Ishangas / volunteers)
-- ---------------------------------------------------------------------
create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  city text,
  center text,
  region text not null default 'North Bharat',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table public.person_types (
  person_id uuid not null references public.people(id) on delete cascade,
  type_id uuid not null references public.ishanga_types(id) on delete cascade,
  primary key (person_id, type_id)
);

create table public.person_attributes (
  person_id uuid not null references public.people(id) on delete cascade,
  attribute_id uuid not null references public.ishanga_attributes(id) on delete cascade,
  primary key (person_id, attribute_id)
);

-- One row per login. Linked to a person so they can opt in for themselves.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role_id uuid references public.app_roles(id) on delete set null,
  person_id uuid unique references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Activities, assignments (history) and interview candidates
-- ---------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  activity_type_id uuid not null references public.activity_types(id) on delete restrict,
  title text not null,
  start_date date not null,
  end_date date,
  start_time time,
  location text,
  city text,
  region text not null default 'North Bharat',
  status text not null default 'planned' check (status in ('planned','confirmed','completed','cancelled')),
  opt_in_open boolean not null default true,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.activities (start_date);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role_id uuid not null references public.activity_roles(id) on delete restrict,
  status text not null default 'opted_in' check (status in ('opted_in','confirmed','completed','declined','cancelled')),
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (activity_id, person_id, role_id)
);
create index on public.assignments (person_id);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references public.activities(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  city text,
  person_id uuid references public.people(id) on delete set null,
  target_type_id uuid not null references public.ishanga_types(id) on delete restrict,
  result text not null default 'pending' check (result in ('pending','selected','not_selected','on_hold','withdrawn')),
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------
create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles pr
    join public.app_roles r on r.id = pr.role_id
    where pr.id = auth.uid() and (p = any(r.permissions) or 'admin' = any(r.permissions))
  );
$$;

create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select person_id from public.profiles where id = auth.uid();
$$;

-- First user to sign up becomes Admin, everyone else gets the default (Pending) role.
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
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), r);
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.check_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.activity_roles ar join public.activities a on a.activity_type_id = ar.activity_type_id
    where ar.id = new.role_id and a.id = new.activity_id
  ) then
    raise exception 'Role does not belong to this activity type';
  end if;
  if exists (select 1 from public.activity_role_eligibility e where e.role_id = new.role_id)
     and not exists (
       select 1 from public.activity_role_eligibility e
       join public.person_types pt on pt.type_id = e.type_id and pt.person_id = new.person_id
       where e.role_id = new.role_id
     ) then
    raise exception 'This person is not eligible for the selected role';
  end if;
  return new;
end $$;

create trigger assignments_check
before insert or update of activity_id, person_id, role_id on public.assignments
for each row execute function public.check_assignment();

create or replace function public.check_candidate()
returns trigger language plpgsql security definer set search_path = public as $$
declare pre uuid; pre_name text;
begin
  select prerequisite_type_id into pre from public.ishanga_types where id = new.target_type_id;
  if pre is not null and (new.person_id is null or not exists (
      select 1 from public.person_types where person_id = new.person_id and type_id = pre)) then
    select name into pre_name from public.ishanga_types where id = pre;
    raise exception 'Candidate must already be a % for this training', pre_name;
  end if;
  return new;
end $$;

create trigger candidates_check
before insert or update of person_id, target_type_id on public.candidates
for each row execute function public.check_candidate();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.app_roles enable row level security;
alter table public.ishanga_types enable row level security;
alter table public.ishanga_attributes enable row level security;
alter table public.activity_types enable row level security;
alter table public.activity_roles enable row level security;
alter table public.activity_role_eligibility enable row level security;
alter table public.people enable row level security;
alter table public.person_types enable row level security;
alter table public.person_attributes enable row level security;
alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.assignments enable row level security;
alter table public.candidates enable row level security;

-- app_roles: everyone logged in can read (needed to know own permissions)
create policy app_roles_read on public.app_roles for select to authenticated using (true);
create policy app_roles_write on public.app_roles for all to authenticated
  using (public.has_perm('manage_users')) with check (public.has_perm('manage_users'));

-- profiles
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('manage_users'));
create policy profiles_write on public.profiles for update to authenticated
  using (public.has_perm('manage_users')) with check (public.has_perm('manage_users'));
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.has_perm('manage_users'));

-- settings tables
create policy ishanga_types_read on public.ishanga_types for select to authenticated using (public.has_perm('view'));
create policy ishanga_types_write on public.ishanga_types for all to authenticated
  using (public.has_perm('manage_settings')) with check (public.has_perm('manage_settings'));
create policy ishanga_attributes_read on public.ishanga_attributes for select to authenticated using (public.has_perm('view'));
create policy ishanga_attributes_write on public.ishanga_attributes for all to authenticated
  using (public.has_perm('manage_settings')) with check (public.has_perm('manage_settings'));
create policy activity_types_read on public.activity_types for select to authenticated using (public.has_perm('view'));
create policy activity_types_write on public.activity_types for all to authenticated
  using (public.has_perm('manage_settings')) with check (public.has_perm('manage_settings'));
create policy activity_roles_read on public.activity_roles for select to authenticated using (public.has_perm('view'));
create policy activity_roles_write on public.activity_roles for all to authenticated
  using (public.has_perm('manage_settings')) with check (public.has_perm('manage_settings'));
create policy activity_role_eligibility_read on public.activity_role_eligibility for select to authenticated using (public.has_perm('view'));
create policy activity_role_eligibility_write on public.activity_role_eligibility for all to authenticated
  using (public.has_perm('manage_settings')) with check (public.has_perm('manage_settings'));

-- people
create policy people_read on public.people for select to authenticated using (public.has_perm('view'));
create policy people_write on public.people for all to authenticated
  using (public.has_perm('manage_people')) with check (public.has_perm('manage_people'));
create policy person_types_read on public.person_types for select to authenticated using (public.has_perm('view'));
create policy person_types_write on public.person_types for all to authenticated
  using (public.has_perm('manage_people')) with check (public.has_perm('manage_people'));
create policy person_attributes_read on public.person_attributes for select to authenticated using (public.has_perm('view'));
create policy person_attributes_write on public.person_attributes for all to authenticated
  using (public.has_perm('manage_people')) with check (public.has_perm('manage_people'));

-- activities & candidates
create policy activities_read on public.activities for select to authenticated using (public.has_perm('view'));
create policy activities_write on public.activities for all to authenticated
  using (public.has_perm('manage_activities')) with check (public.has_perm('manage_activities'));
create policy candidates_read on public.candidates for select to authenticated using (public.has_perm('view'));
create policy candidates_write on public.candidates for all to authenticated
  using (public.has_perm('manage_activities')) with check (public.has_perm('manage_activities'));

-- assignments: coordinators manage all; Ishangas may opt themselves in / withdraw a pending opt-in
create policy assignments_read on public.assignments for select to authenticated using (public.has_perm('view'));
create policy assignments_manage on public.assignments for all to authenticated
  using (public.has_perm('manage_activities')) with check (public.has_perm('manage_activities'));
create policy assignments_self_opt_in on public.assignments for insert to authenticated
  with check (
    public.has_perm('opt_in')
    and person_id = public.my_person_id()
    and status = 'opted_in'
    and exists (select 1 from public.activities a where a.id = activity_id and a.opt_in_open and a.status in ('planned','confirmed'))
    and exists (select 1 from public.activity_roles r where r.id = role_id and r.allow_self_opt_in)
  );
create policy assignments_self_withdraw on public.assignments for delete to authenticated
  using (public.has_perm('opt_in') and person_id = public.my_person_id() and status = 'opted_in');

-- ---------------------------------------------------------------------
-- Seed data (edit freely from Settings afterwards)
-- ---------------------------------------------------------------------
insert into public.app_roles (name, description, permissions, is_default) values
  ('Admin', 'Full access', '{admin}', false),
  ('Coordinator', 'Manages people, activities and scheduling', '{view,view_dashboard,opt_in,manage_people,manage_activities,export}', false),
  ('Dashboard Viewer', 'Read-only access with dashboard and export', '{view,view_dashboard,export}', false),
  ('Ishanga', 'Can view activities and opt in for themselves', '{view,opt_in}', false),
  ('Pending', 'New sign-up awaiting approval', '{}', true);

insert into public.ishanga_types (name, description, sort_order) values
  ('SPS Ishanga', 'Trained SPS Ishanga', 1),
  ('Satsang Ishanga', 'Trained Satsang Ishanga', 2);
update public.ishanga_types
  set prerequisite_type_id = (select id from public.ishanga_types where name = 'SPS Ishanga')
  where name = 'Satsang Ishanga';

insert into public.ishanga_attributes (name) values
  ('Ashram-Ishanga'), ('Fulltime-Ishanga'), ('Borrowed-Ishanga'), ('IE-Ishanga');

insert into public.activity_types (name, description, color, has_candidates, sort_order) values
  ('Satsang', 'Satsang programs', 'orange', false, 1),
  ('Mandala Group', 'Mandala group sessions', 'emerald', false, 2),
  ('IEO Initiation', 'Inner Engineering Online initiations', 'sky', false, 3),
  ('Interview', 'Interviews of candidates for Satsang / SPS Ishanga training', 'violet', true, 4);

with t as (select id, name from public.activity_types)
insert into public.activity_roles (activity_type_id, name, sort_order)
select t.id, r.name, r.ord from t join (values
  ('Satsang', 'Conducting', 1),
  ('Satsang', 'Supporting', 2),
  ('Satsang', 'Observing', 3),
  ('Mandala Group', 'Participating', 1),
  ('IEO Initiation', 'Supporting', 1),
  ('Interview', 'Interviewer', 1)
) as r(type_name, name, ord) on r.type_name = t.name;

insert into public.activity_role_eligibility (role_id, type_id)
select ar.id, it.id
from public.activity_roles ar
join public.activity_types at on at.id = ar.activity_type_id
join (values
  ('Satsang', 'Conducting', 'Satsang Ishanga'),
  ('Satsang', 'Supporting', 'Satsang Ishanga'),
  ('Satsang', 'Supporting', 'SPS Ishanga'),
  ('Satsang', 'Observing', 'Satsang Ishanga'),
  ('Mandala Group', 'Participating', 'Satsang Ishanga'),
  ('Mandala Group', 'Participating', 'SPS Ishanga'),
  ('IEO Initiation', 'Supporting', 'Satsang Ishanga'),
  ('IEO Initiation', 'Supporting', 'SPS Ishanga'),
  ('Interview', 'Interviewer', 'Satsang Ishanga'),
  ('Interview', 'Interviewer', 'SPS Ishanga')
) as e(type_name, role_name, ishanga_type) on e.type_name = at.name and e.role_name = ar.name
join public.ishanga_types it on it.name = e.ishanga_type;
