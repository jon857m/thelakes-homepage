-- The account purge Edge Function uses the service role after independently
-- authenticating the caller and checking public.is_admin(). Keep browser roles
-- governed by their existing RLS policies.
grant select, delete on table public.businesses to service_role;
grant select on table public.business_subscriptions to service_role;
grant select on table public.business_images to service_role;
