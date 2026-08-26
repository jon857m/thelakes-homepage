alter table public.businesses
  add column if not exists last_subscriber_activity_at timestamptz,
  add column if not exists abandonment_notified_at timestamptz;

create table if not exists public.listing_review_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('published', 'edited')),
  changed_fields text[] not null default '{}',
  previous_values jsonb,
  current_values jsonb not null,
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists listing_review_events_status_idx
  on public.listing_review_events (review_status, created_at desc);

alter table public.listing_review_events enable row level security;
create policy "Admins can read listing reviews" on public.listing_review_events
  for select to authenticated using (public.is_admin());
create policy "Admins can update listing reviews" on public.listing_review_events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.listing_review_events to authenticated;
grant select, insert, update, delete on public.listing_review_events to service_role;

create or replace function public.capture_subscriber_listing_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fields text[] := '{}';
  tracked_new jsonb;
  tracked_old jsonb;
begin
  if new.listing_type <> 'subscriber' then return new; end if;

  tracked_new := jsonb_build_object(
    'name', new.name, 'tagline', new.tagline, 'description', new.description,
    'category', new.category, 'address', new.address, 'town', new.town,
    'postcode', new.postcode, 'website_url', new.website_url, 'phone', new.phone,
    'facebook_url', new.facebook_url, 'instagram_url', new.instagram_url,
    'logo_url', new.logo_url, 'image_url', new.image_url, 'opening_hours', new.opening_hours
  );
  tracked_old := jsonb_build_object(
    'name', old.name, 'tagline', old.tagline, 'description', old.description,
    'category', old.category, 'address', old.address, 'town', old.town,
    'postcode', old.postcode, 'website_url', old.website_url, 'phone', old.phone,
    'facebook_url', old.facebook_url, 'instagram_url', old.instagram_url,
    'logo_url', old.logo_url, 'image_url', old.image_url, 'opening_hours', old.opening_hours
  );

  if old.listing_status is distinct from 'active' and new.listing_status = 'active' then
    insert into public.listing_review_events (business_id, owner_user_id, event_type, current_values)
    values (new.id, new.owner_user_id, 'published', tracked_new);
  elsif old.listing_status = 'active' and tracked_old is distinct from tracked_new then
    select coalesce(array_agg(key), '{}') into fields
    from jsonb_each(tracked_new) item
    where tracked_old -> item.key is distinct from item.value;
    insert into public.listing_review_events (business_id, owner_user_id, event_type, changed_fields, previous_values, current_values)
    values (new.id, new.owner_user_id, 'edited', fields, tracked_old, tracked_new);
  end if;

  if auth.uid() = new.owner_user_id and tracked_old is distinct from tracked_new then
    new.last_subscriber_activity_at := now();
    new.abandonment_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_subscriber_listing_review on public.businesses;
create trigger capture_subscriber_listing_review
before update on public.businesses
for each row execute function public.capture_subscriber_listing_review();
