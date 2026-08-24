create table if not exists public.business_images (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  image_url text not null,
  storage_path text not null unique,
  sort_order smallint not null default 0 check (sort_order between 0 and 20),
  created_at timestamptz not null default now()
);

create index if not exists business_images_business_idx
  on public.business_images (business_id, sort_order);

alter table public.business_images enable row level security;

create policy "Public can read images for active businesses"
  on public.business_images for select
  using (exists (
    select 1 from public.businesses
    where businesses.id = business_images.business_id and businesses.active
  ));

create policy "Admins can manage business images"
  on public.business_images for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Owners can manage their business images"
  on public.business_images for all to authenticated
  using (exists (
    select 1 from public.businesses
    where businesses.id = business_images.business_id and businesses.owner_user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.businesses
    where businesses.id = business_images.business_id and businesses.owner_user_id = auth.uid()
  ));

grant select on public.business_images to anon, authenticated;
grant insert, update, delete on public.business_images to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-images', 'business-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can view business image files"
  on storage.objects for select
  using (bucket_id = 'business-images');

create policy "Admins can upload business image files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'business-images' and public.is_admin());

create policy "Admins can update business image files"
  on storage.objects for update to authenticated
  using (bucket_id = 'business-images' and public.is_admin())
  with check (bucket_id = 'business-images' and public.is_admin());

create policy "Admins can delete business image files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'business-images' and public.is_admin());

create policy "Owners can upload their business image files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'business-images' and exists (
    select 1 from public.businesses
    where businesses.owner_user_id = auth.uid()
      and businesses.id::text = split_part(storage.objects.name, '/', 1)
  ));

create policy "Owners can update their business image files"
  on storage.objects for update to authenticated
  using (bucket_id = 'business-images' and exists (
    select 1 from public.businesses
    where businesses.owner_user_id = auth.uid()
      and businesses.id::text = split_part(storage.objects.name, '/', 1)
  ))
  with check (bucket_id = 'business-images' and exists (
    select 1 from public.businesses
    where businesses.owner_user_id = auth.uid()
      and businesses.id::text = split_part(storage.objects.name, '/', 1)
  ));

create policy "Owners can delete their business image files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'business-images' and exists (
    select 1 from public.businesses
    where businesses.owner_user_id = auth.uid()
      and businesses.id::text = split_part(storage.objects.name, '/', 1)
  ));
