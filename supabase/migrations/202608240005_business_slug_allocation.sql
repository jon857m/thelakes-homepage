create or replace function public.business_slug_base(business_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(trim(business_name)), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'business'
  );
$$;

create or replace function public.allocate_business_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
begin
  if new.slug is not null and btrim(new.slug) <> '' then
    return new;
  end if;

  base_slug := public.business_slug_base(new.name);
  candidate := base_slug;

  -- Serialise simultaneous sign-ups that resolve to the same base slug.
  perform pg_advisory_xact_lock(hashtext(base_slug));

  while exists (
    select 1 from public.businesses
    where slug = candidate and id is distinct from new.id
  ) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

drop trigger if exists allocate_business_slug on public.businesses;
create trigger allocate_business_slug
before insert on public.businesses
for each row execute function public.allocate_business_slug();

create or replace function public.protect_business_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and (
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

comment on function public.allocate_business_slug() is
  'Allocates stable unique business slugs on insert: name, name-2, name-3, and so on.';
