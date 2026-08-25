grant select, insert, update, delete
  on table public.business_subscriptions
  to service_role;

grant select, insert, update, delete
  on table public.stripe_webhook_events
  to service_role;

grant select, insert, update
  on table public.businesses
  to service_role;

comment on table public.business_subscriptions is
  'Server-managed Stripe state. Owners and admins have read-only browser access; the service role processes Checkout and webhooks.';
