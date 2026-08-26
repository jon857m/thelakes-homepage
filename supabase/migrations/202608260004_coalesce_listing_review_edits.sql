create or replace function public.capture_subscriber_listing_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fields text[] := '{}';
  tracked_new jsonb;
  tracked_old jsonb;
  pending_edit_id uuid;
begin
  if new.listing_type <> 'subscriber' then return new; end if;

  tracked_new := jsonb_build_object(
    'name', new.name, 'tagline', new.tagline, 'description', new.description,
    'category', new.category, 'address', new.address, 'town', new.town,
    'postcode', new.postcode, 'website_url', new.website_url, 'phone', new.phone,
    'facebook_url', new.facebook_url, 'instagram_url', new.instagram_url,
    'logo_url', new.logo_url, 'image_url', new.image_url, 'opening_hours', new.opening_hours
  );
  tracked_old := jsonb_build_object(
    'name', old.name, 'tagline', old.tagline, 'description', old.description,
    'category', old.category, 'address', old.address, 'town', old.town,
    'postcode', old.postcode, 'website_url', old.website_url, 'phone', old.phone,
    'facebook_url', old.facebook_url, 'instagram_url', old.instagram_url,
    'logo_url', old.logo_url, 'image_url', old.image_url, 'opening_hours', old.opening_hours
  );

  if old.listing_status is distinct from 'active' and new.listing_status = 'active' then
    insert into public.listing_review_events (business_id, owner_user_id, event_type, current_values)
    values (new.id, new.owner_user_id, 'published', tracked_new);
  elsif old.listing_status = 'active' and tracked_old is distinct from tracked_new then
    select coalesce(array_agg(key), '{}') into fields
    from jsonb_each(tracked_new) item
    where tracked_old -> item.key is distinct from item.value;

    select id into pending_edit_id
    from public.listing_review_events
    where business_id = new.id and event_type = 'edited' and review_status = 'pending'
    order by created_at desc limit 1;

    if pending_edit_id is null then
      insert into public.listing_review_events (business_id, owner_user_id, event_type, changed_fields, previous_values, current_values)
      values (new.id, new.owner_user_id, 'edited', fields, tracked_old, tracked_new);
    else
      update public.listing_review_events
      set changed_fields = (select array_agg(distinct field) from unnest(changed_fields || fields) field),
          current_values = tracked_new,
          created_at = now()
      where id = pending_edit_id;
    end if;
  end if;

  if auth.uid() = new.owner_user_id and tracked_old is distinct from tracked_new then
    new.last_subscriber_activity_at := now();
    new.abandonment_notified_at := null;
  end if;
  return new;
end;
$$;
