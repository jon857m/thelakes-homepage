create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  listing_type text not null default 'editorial' check (listing_type in ('editorial', 'subscriber')),
  name text not null,
  slug text not null unique,
  tagline text not null default '' check (char_length(tagline) <= 80),
  description text not null default '',
  category text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text,
  town text,
  postcode text,
  timezone text not null default 'Europe/London',
  website_url text,
  phone text,
  facebook_url text,
  instagram_url text,
  logo_url text,
  image_url text,
  listing_status text not null default 'draft' check (listing_status in ('draft', 'awaiting_payment', 'active', 'past_due', 'cancelled', 'suspended')),
  featured boolean not null default false,
  active boolean generated always as (listing_status = 'active') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_locations (
  id uuid primary key default gen_random_uuid(),
  short_code text not null unique check (short_code ~ '^[23456789A-HJ-NP-Z]{6}$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  zoom double precision not null check (zoom between 0 and 24),
  pitch double precision not null check (pitch between 0 and 85),
  bearing double precision not null check (bearing between -360 and 360),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  view_count bigint not null default 0 check (view_count >= 0)
);

create index if not exists businesses_public_map_idx
  on public.businesses (listing_status, latitude, longitude);
create index if not exists businesses_owner_idx on public.businesses (owner_user_id);
create index if not exists shared_locations_expiry_idx on public.shared_locations (expires_at);

alter table public.businesses enable row level security;
alter table public.shared_locations enable row level security;

create policy "Public can read active businesses"
  on public.businesses for select
  using (listing_status = 'active');

create policy "Owners can read their businesses"
  on public.businesses for select to authenticated
  using (owner_user_id = auth.uid());

create policy "Owners can update their businesses"
  on public.businesses for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "Public can create shared locations"
  on public.shared_locations for insert to anon, authenticated
  with check (
    expires_at <= now() + interval '31 days'
    and expires_at > now()
    and view_count = 0
  );

create or replace function public.get_shared_location(requested_code text)
returns table (
  short_code text,
  latitude double precision,
  longitude double precision,
  zoom double precision,
  pitch double precision,
  bearing double precision,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_locations
    set view_count = view_count + 1
    where shared_locations.short_code = upper(requested_code)
      and shared_locations.expires_at > now();

  return query
    select s.short_code, s.latitude, s.longitude, s.zoom, s.pitch, s.bearing, s.expires_at
    from public.shared_locations s
    where s.short_code = upper(requested_code)
      and s.expires_at > now();
end;
$$;

revoke all on function public.get_shared_location(text) from public;
grant execute on function public.get_shared_location(text) to anon, authenticated;

grant select on public.businesses to anon, authenticated;
grant insert on public.shared_locations to anon, authenticated;

-- Production should additionally rate-limit shared-location inserts at the edge.
