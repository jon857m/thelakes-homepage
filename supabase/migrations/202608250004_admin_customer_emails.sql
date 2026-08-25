create or replace function public.admin_business_owner_emails()
returns table (business_id uuid, owner_email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select businesses.id, users.email::text
  from public.businesses
  left join auth.users on users.id = businesses.owner_user_id
  where public.is_admin();
$$;

revoke all on function public.admin_business_owner_emails() from public;
grant execute on function public.admin_business_owner_emails() to authenticated;
