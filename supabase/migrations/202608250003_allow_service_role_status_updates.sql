create or replace function public.protect_business_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() and (
    new.owner_user_id is distinct from old.owner_user_id or
    new.slug is distinct from old.slug or
    new.listing_type is distinct from old.listing_type or
    new.listing_status is distinct from old.listing_status or
    new.featured is distinct from old.featured
  ) then
    raise exception 'Only an administrator can change ownership, slug, type, status or featured state';
  end if;
  return new;
end;
$$;

-- Reconcile payments that completed while the trigger was rejecting the webhook's
-- server-side listing activation. SQL Editor runs without a service-role JWT, so
-- temporarily suspend this one trigger for the controlled repair.
alter table public.businesses disable trigger protect_business_admin_fields;

update public.businesses as business
set listing_status = case
  when subscription.stripe_status in ('active', 'trialing') then 'active'
  when subscription.stripe_status in ('past_due', 'unpaid', 'incomplete') then 'past_due'
  when subscription.stripe_status in ('canceled', 'incomplete_expired') then 'cancelled'
  else business.listing_status
end,
updated_at = now()
from public.business_subscriptions as subscription
where subscription.business_id = business.id
  and subscription.stripe_status is not null;

alter table public.businesses enable trigger protect_business_admin_fields;
