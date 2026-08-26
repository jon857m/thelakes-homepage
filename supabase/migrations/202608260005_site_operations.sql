create table if not exists public.site_operations (
  id text primary key check (id = 'global'),
  maintenance_enabled boolean not null default false,
  signup_paused boolean not null default false,
  maintenance_message text not null default 'We are carrying out a brief update and will be back shortly.',
  expected_back_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_operations (id) values ('global') on conflict (id) do nothing;

alter table public.site_operations enable row level security;
create policy "Everyone can read site operations" on public.site_operations
  for select using (true);
create policy "Admins can update site operations" on public.site_operations
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.site_operations to anon, authenticated;
grant update on public.site_operations to authenticated;

create or replace function public.set_site_operations(
  requested_maintenance boolean,
  requested_signup_pause boolean,
  requested_message text,
  requested_expected_back_at timestamptz default null
)
returns public.site_operations
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.site_operations;
begin
  if not public.is_admin() then raise exception 'Administrator access is required'; end if;
  if length(btrim(coalesce(requested_message, ''))) < 10 then raise exception 'Enter a useful maintenance message'; end if;
  update public.site_operations set
    maintenance_enabled = requested_maintenance,
    signup_paused = requested_signup_pause or requested_maintenance,
    maintenance_message = btrim(requested_message),
    expected_back_at = requested_expected_back_at,
    updated_at = now(),
    updated_by = auth.uid()
  where id = 'global'
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_site_operations(boolean, boolean, text, timestamptz) from public;
grant execute on function public.set_site_operations(boolean, boolean, text, timestamptz) to authenticated;

create or replace function public.create_subscriber_draft(
  business_name text,
  business_category text
)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  created_business public.businesses;
begin
  if auth.uid() is null then raise exception 'Sign in before creating a listing'; end if;
  if exists (select 1 from public.site_operations where id = 'global' and signup_paused) then
    raise exception 'New subscriptions are temporarily paused. Please try again shortly.';
  end if;
  if length(btrim(business_name)) < 2 then raise exception 'Enter a business name'; end if;
  if business_category not in ('Accommodation', 'Camping', 'Eating', 'Activities', 'Gifts') then raise exception 'Choose a valid category'; end if;

  insert into public.businesses (
    owner_user_id, listing_type, listing_status, name, slug, tagline,
    description, category, latitude, longitude, town
  ) values (
    auth.uid(), 'subscriber', 'draft', btrim(business_name), null, '',
    '', business_category, 54.46, -3.08, ''
  ) returning * into created_business;

  insert into public.business_subscriptions (business_id, owner_user_id)
  values (created_business.id, auth.uid());
  return created_business;
end;
$$;
revoke all on function public.create_subscriber_draft(text, text) from public;
grant execute on function public.create_subscriber_draft(text, text) to authenticated;
