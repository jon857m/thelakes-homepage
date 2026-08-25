alter table public.businesses
  add column if not exists directions_url text,
  add column if not exists opening_hours jsonb not null default '{}'::jsonb,
  add column if not exists hours_vary boolean not null default false;

create table if not exists public.business_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null default 'standard_monthly',
  amount_pence integer not null default 1000 check (amount_pence > 0),
  currency text not null default 'gbp',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  stripe_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.business_subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "Owners can read their subscription"
  on public.business_subscriptions for select to authenticated
  using (owner_user_id = auth.uid());

create policy "Admins can read every subscription"
  on public.business_subscriptions for select to authenticated
  using (public.is_admin());

grant select on public.business_subscriptions to authenticated;

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
  if auth.uid() is null then
    raise exception 'Sign in before creating a listing';
  end if;
  if length(btrim(business_name)) < 2 then
    raise exception 'Enter a business name';
  end if;
  if business_category not in ('Accommodation', 'Camping', 'Eating', 'Activities', 'Gifts') then
    raise exception 'Choose a valid category';
  end if;

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

create index if not exists business_subscriptions_owner_idx
  on public.business_subscriptions (owner_user_id);
create index if not exists business_subscriptions_customer_idx
  on public.business_subscriptions (stripe_customer_id);
create index if not exists business_subscriptions_stripe_subscription_idx
  on public.business_subscriptions (stripe_subscription_id);

comment on table public.business_subscriptions is
  'Server-managed Stripe state. Webhooks are authoritative; browsers receive read-only access.';
