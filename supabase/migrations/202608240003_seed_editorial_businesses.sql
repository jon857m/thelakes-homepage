insert into public.businesses (
  id, listing_type, name, slug, tagline, description, category,
  latitude, longitude, town, listing_status, featured
)
values
  ('10000000-0000-4000-8000-000000000001', 'editorial', 'Grasmere Gingerbread', 'grasmere-gingerbread', 'Development listing — details awaiting business approval', 'Demonstration map card. Confirm all details with the business before publication.', 'Eating', 54.4591, -3.0249, 'Grasmere', 'active', true),
  ('10000000-0000-4000-8000-000000000002', 'editorial', 'Development listing 2', 'development-listing-2', 'Placeholder business location', 'Development data only — not a published business claim.', 'Activities', 54.6013, -3.1347, 'Keswick', 'active', false),
  ('10000000-0000-4000-8000-000000000003', 'editorial', 'Development listing 3', 'development-listing-3', 'Placeholder business location', 'Development data only — not a published business claim.', 'Gifts', 54.4316, -2.9613, 'Ambleside', 'active', false),
  ('10000000-0000-4000-8000-000000000004', 'editorial', 'Development listing 4', 'development-listing-4', 'Placeholder business location', 'Development data only — not a published business claim.', 'Accommodation', 54.3807, -2.9068, 'Windermere', 'active', false),
  ('10000000-0000-4000-8000-000000000005', 'editorial', 'Development listing 5', 'development-listing-5', 'Placeholder business location', 'Development data only — not a published business claim.', 'Eating', 54.3649, -2.9206, 'Bowness', 'active', false),
  ('10000000-0000-4000-8000-000000000006', 'editorial', 'Development listing 6', 'development-listing-6', 'Placeholder business location', 'Development data only — not a published business claim.', 'Activities', 54.3689, -3.0758, 'Coniston', 'active', false),
  ('10000000-0000-4000-8000-000000000007', 'editorial', 'Development listing 7', 'development-listing-7', 'Placeholder business location', 'Development data only — not a published business claim.', 'Activities', 54.5768, -2.8785, 'Ullswater', 'active', false),
  ('10000000-0000-4000-8000-000000000008', 'editorial', 'Development listing 8', 'development-listing-8', 'Placeholder business location', 'Development data only — not a published business claim.', 'Camping', 54.5224, -3.1468, 'Borrowdale', 'active', false),
  ('10000000-0000-4000-8000-000000000009', 'editorial', 'Development listing 9', 'development-listing-9', 'Placeholder business location', 'Development data only — not a published business claim.', 'Accommodation', 54.5413, -3.2763, 'Buttermere', 'active', false),
  ('10000000-0000-4000-8000-000000000010', 'editorial', 'Development listing 10', 'development-listing-10', 'Placeholder business location', 'Development data only — not a published business claim.', 'Camping', 54.4431, -3.2894, 'Wasdale', 'active', false)
on conflict (slug) do nothing;
