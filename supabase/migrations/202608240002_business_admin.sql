create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create policy "Admins can read every business"
  on public.businesses for select to authenticated
  using (public.is_admin());

create policy "Admins can insert businesses"
  on public.businesses for insert to authenticated
  with check (public.is_admin());

create policy "Admins can update every business"
  on public.businesses for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete draft businesses"
  on public.businesses for delete to authenticated
  using (public.is_admin() and listing_status = 'draft');

grant insert, update, delete on public.businesses to authenticated;

create or replace function public.protect_business_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and (
    new.owner_user_id is distinct from old.owner_user_id or
    new.listing_type is distinct from old.listing_type or
    new.listing_status is distinct from old.listing_status or
    new.featured is distinct from old.featured
  ) then
    raise exception 'Only an administrator can change ownership, type, status or featured state';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_business_admin_fields on public.businesses;
create trigger protect_business_admin_fields
before update on public.businesses
for each row execute function public.protect_business_admin_fields();

-- Run once, after creating your Supabase Auth account:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'you@example.com';
