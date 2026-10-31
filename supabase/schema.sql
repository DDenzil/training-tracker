-- =====================================================================
--  Online Training Tracker — Supabase schema
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  Safe to re-run: objects are created "if not exists" / "or replace".
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Registered users and roles
--    Only emails listed here (and active) can see anything.
--    viewer  = all person pages
--    manager = viewer + overall report + people directory
--    admin   = manager + administration
-- ---------------------------------------------------------------------
create table if not exists public.app_users (
  email       text primary key check (email = lower(email)),
  full_name   text,
  role        text not null default 'viewer' check (role in ('viewer','manager','admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.app_users
  where email = lower(coalesce(auth.jwt() ->> 'email', '')) and active
$$;

create or replace function public.is_registered()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('manager','admin'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Never allow the last active admin to be removed, demoted or deactivated
create or replace function public.app_users_guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)) then
    select count(*) into remaining from public.app_users
     where role = 'admin' and active and email <> old.email;
    if remaining = 0 then
      raise exception 'At least one active admin is required.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.email := lower(trim(new.email));
  return new;
end $$;

drop trigger if exists app_users_guard on public.app_users;
create trigger app_users_guard before update or delete on public.app_users
  for each row execute function public.app_users_guard_last_admin();

create or replace function public.app_users_lower_email()
returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end $$;

drop trigger if exists app_users_lower on public.app_users;
create trigger app_users_lower before insert on public.app_users
  for each row execute function public.app_users_lower_email();

-- ---------------------------------------------------------------------
-- 2. Reference data
-- ---------------------------------------------------------------------
create table if not exists public.job_functions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.courses (
  id              uuid primary key default gen_random_uuid(),
  abbreviation    text not null unique,
  name            text not null,
  category        text,                      -- e.g. HSE, Technical, Induction
  validity_months int check (validity_months is null or validity_months > 0),  -- null = never expires
  delivery_method text,                      -- Classroom, Online, Practical, Blended
  duration_hours  numeric(6,1),
  provider        text,
  description     text,
  sort_order      int not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- One row = "M" (mandatory) for that job function + course
create table if not exists public.training_matrix (
  job_function_id uuid not null references public.job_functions(id) on delete cascade,
  course_id       uuid not null references public.courses(id) on delete cascade,
  primary key (job_function_id, course_id)
);

-- ---------------------------------------------------------------------
-- 3. Personnel
-- ---------------------------------------------------------------------
create table if not exists public.personnel (
  id              uuid primary key default gen_random_uuid(),
  employee_no     text not null unique,
  full_name       text not null,
  position        text,
  job_function_id uuid references public.job_functions(id) on delete set null,
  department      text,
  section         text,
  employer        text,                      -- company name or contractor name
  email           text,
  phone           text,
  date_joined     date,
  status          text not null default 'Active' check (status in ('Active','Inactive')),
  photo_path      text,                      -- path inside the "photos" storage bucket
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists personnel_job_function_idx on public.personnel(job_function_id);

-- ---------------------------------------------------------------------
-- 4. Training records (any course, mandatory or not)
-- ---------------------------------------------------------------------
create table if not exists public.training_records (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.personnel(id) on delete cascade,
  course_id       uuid not null references public.courses(id) on delete restrict,
  completion_date date not null,
  expiry_date     date,                      -- auto-filled from course validity when left empty
  certificate_no  text,
  provider        text,
  remarks         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text
);
create index if not exists training_records_person_idx on public.training_records(person_id);
create index if not exists training_records_course_idx on public.training_records(course_id);

-- Fill expiry from course validity, stamp who/when
create or replace function public.training_records_before_write()
returns trigger language plpgsql set search_path = public as $$
declare v int;
begin
  if new.expiry_date is null then
    select validity_months into v from public.courses where id = new.course_id;
    if v is not null then
      new.expiry_date := (new.completion_date + make_interval(months => v))::date;
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end $$;

drop trigger if exists training_records_before_write on public.training_records;
create trigger training_records_before_write
  before insert or update on public.training_records
  for each row execute function public.training_records_before_write();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists personnel_touch on public.personnel;
create trigger personnel_touch before update on public.personnel
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. Status view — one row per person × course that is either
--    mandatory (from the matrix) or has a training record.
--    Status: Valid | Due soon (≤30 days) | Expired | Not done
--    "Today" is Qatar time.
-- ---------------------------------------------------------------------
create or replace view public.v_training_status
with (security_invoker = true) as
with today as (
  select (now() at time zone 'Asia/Qatar')::date as d
),
req as (
  select p.id as person_id, m.course_id
  from public.personnel p
  join public.training_matrix m on m.job_function_id = p.job_function_id
),
latest as (
  select distinct on (person_id, course_id)
         person_id, course_id, id as record_id, completion_date, expiry_date
  from public.training_records
  order by person_id, course_id, completion_date desc, created_at desc
),
pairs as (
  select person_id, course_id from req
  union
  select person_id, course_id from latest
)
select pr.person_id,
       pr.course_id,
       (r.person_id is not null)  as mandatory,
       l.record_id,
       l.completion_date,
       l.expiry_date,
       case
         when l.record_id is null           then 'Not done'
         when l.expiry_date is null          then 'Valid'
         when l.expiry_date <  t.d           then 'Expired'
         when l.expiry_date <= t.d + 30      then 'Due soon'
         else 'Valid'
       end as status
from pairs pr
cross join today t
left join req    r on r.person_id = pr.person_id and r.course_id = pr.course_id
left join latest l on l.person_id = pr.person_id and l.course_id = pr.course_id;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------
alter table public.app_users        enable row level security;
alter table public.job_functions    enable row level security;
alter table public.courses          enable row level security;
alter table public.training_matrix  enable row level security;
alter table public.personnel        enable row level security;
alter table public.training_records enable row level security;

-- app_users: you can see your own row; admins manage everyone
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin());
drop policy if exists app_users_admin on public.app_users;
create policy app_users_admin on public.app_users for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Everything else: registered users read, admins write
do $$
declare t text;
begin
  foreach t in array array['job_functions','courses','training_matrix','personnel','training_records'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_registered())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

-- Nothing for anonymous visitors
revoke all on public.app_users, public.job_functions, public.courses, public.training_matrix,
              public.personnel, public.training_records, public.v_training_status from anon;
grant select on public.v_training_status to authenticated;
grant execute on function public.my_role(), public.is_registered(), public.is_manager(), public.is_admin() to authenticated;
revoke execute on function public.my_role(), public.is_registered(), public.is_manager(), public.is_admin() from anon;

-- ---------------------------------------------------------------------
-- 7. Photo storage (private bucket, signed URLs)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_read   on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
drop policy if exists photos_delete on storage.objects;

create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_registered());
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_admin()) with check (bucket_id = 'photos' and public.is_admin());
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ---------------------------------------------------------------------
-- 8. FIRST ADMIN — replace the email with your Google account, then run.
-- ---------------------------------------------------------------------
-- insert into public.app_users (email, full_name, role)
-- values ('you@gmail.com', 'Your Name', 'admin')
-- on conflict (email) do update set role = 'admin', active = true;
