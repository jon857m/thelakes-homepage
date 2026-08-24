alter table public.shared_locations
  add column if not exists view_state jsonb;

alter table public.shared_locations
  drop constraint if exists shared_locations_view_state_size;

alter table public.shared_locations
  add constraint shared_locations_view_state_size
  check (view_state is null or octet_length(view_state::text) <= 8192);

drop policy if exists "Public can create shared locations" on public.shared_locations;
create policy "Public can create shared locations"
  on public.shared_locations for insert to anon, authenticated
  with check (
    expires_at > now()
    and (
      (view_state is null and expires_at <= now() + interval '31 days')
      or (view_state is not null and expires_at <= now() + interval '366 days')
    )
    and view_count = 0
  );

drop function if exists public.get_shared_location(text);

create function public.get_shared_location(requested_code text)
returns table (
  short_code text,
  latitude double precision,
  longitude double precision,
  zoom double precision,
  pitch double precision,
  bearing double precision,
  expires_at timestamptz,
  view_state jsonb
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
    select s.short_code, s.latitude, s.longitude, s.zoom, s.pitch, s.bearing, s.expires_at, s.view_state
    from public.shared_locations s
    where s.short_code = upper(requested_code)
      and s.expires_at > now();
end;
$$;

revoke all on function public.get_shared_location(text) from public;
grant execute on function public.get_shared_location(text) to anon, authenticated;

comment on column public.shared_locations.view_state is
  'Complete versioned map state used by short /map/p/CODE share links.';
