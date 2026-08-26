create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  stripe_invoice_id text not null unique,
  business_id uuid references public.businesses(id) on delete set null,
  owner_user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text,
  stripe_subscription_id text,
  invoice_number text,
  status text,
  currency text not null default 'gbp',
  amount_due integer not null default 0,
  amount_paid integer not null default 0,
  amount_remaining integer not null default 0,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  stripe_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_payments_business_idx
  on public.subscription_payments (business_id, stripe_created_at desc);
create index if not exists subscription_payments_owner_idx
  on public.subscription_payments (owner_user_id, stripe_created_at desc);
create index if not exists subscription_payments_status_idx
  on public.subscription_payments (status, stripe_created_at desc);

alter table public.subscription_payments enable row level security;

create policy "Admins can read subscription payments"
  on public.subscription_payments for select to authenticated
  using (public.is_admin());

grant select on table public.subscription_payments to authenticated;
grant select, insert, update, delete on table public.subscription_payments to service_role;

comment on table public.subscription_payments is
  'Stripe invoice reporting ledger synchronized by signed webhooks. Stripe remains the financial source of truth.';
