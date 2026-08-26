# The Lakes in Cumbria

The existing site is static HTML/CSS/JavaScript. The interactive map is an isolated React and TypeScript application whose source lives in `map-app/` and whose deployable output is generated at `/map/`.

## Interactive map development

Requirements: Node.js 20 or newer and npm.

```sh
npm install
cp map-app/.env.example map-app/.env.local
npm run map:dev
```

Open `http://127.0.0.1:5173/map/`.

Environment variables:

- `VITE_MAPTILER_KEY`: Optional MapTiler browser key restricted to the production domain. Uses MapTiler Satellite and its terrain service while retaining the site's OpenFreeMap cartography.
- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key. Never use a secret or service-role key here.

Without a MapTiler key, the application uses OpenFreeMap's Liberty vector style and public Mapzen Terrain Tiles hosted on AWS. This provides genuine 3D terrain at no service-account cost. Without Supabase variables, persistent sharing is disabled rather than emulated.

## Verification and production output

```sh
npm run map:check
```

The generated `/map/` directory is checked in because the current production host publishes the repository as static files without running a build command. Run `npm run map:build` and commit the refreshed bundle before deployment. The build also creates physical entry points for `/map/login/`, `/map/admin/` and `/map/business/` because the current host does not honour SPA fallback rules. If hosting later moves to a build-aware Cloudflare Pages project, it can instead run that command during deployment and ignore the generated directory. `_redirects` supplies the SPA fallback for shared-location URLs where the host supports redirect rules.

Apply `supabase/migrations/202608240001_map_mvp.sql` to a Supabase project before enabling sharing.

## Admin test-account reset

The business administration screen includes a developer-only account purge for repeating complete subscriber signup tests. It removes every business owned by the selected Auth user, the associated subscription and image rows, files below those business IDs in the `business-images` bucket, and finally the Auth user. It can optionally delete linked Stripe customers only when the configured Stripe secret is a test-mode key.

Deploy and explicitly enable the Edge Function on a Supabase project:

```sh
supabase functions deploy purge-test-account
supabase secrets set ALLOW_TEST_ACCOUNT_PURGE=true
```

The function independently verifies the caller against `public.admin_users`, blocks self-deletion, and requires the target email as confirmation. Leave `ALLOW_TEST_ACCOUNT_PURGE` unset or set it to `false` on any project where account purging should not be available.

## Subscriber notifications

Paid-subscriber and incomplete-onboarding notifications use Resend when these Edge Function secrets are configured:

```sh
npx supabase secrets set RESEND_API_KEY=re_... ADMIN_NOTIFICATION_EMAIL=you@example.com EMAIL_FROM='The Lakes <listings@your-verified-domain>' ABANDONMENT_CRON_SECRET=a-long-random-value
```

Schedule a daily POST to `/functions/v1/notify-abandoned-signups` with the same value in the `x-cron-secret` header. Until the email secrets and schedule exist, the application continues normally and sends no notification email.

## Refreshing the geographic search catalogue

The checked-in `map-app/public/data/map_search.json` is a cached, deduplicated OpenStreetMap extract. After downloading deliberate Overpass JSON snapshots, rebuild it with:

```sh
python3 tools/build_map_search.py --input /path/to/places.json --input /path/to/waters.json
```

Do not query a public geocoder from the search-as-you-type interface. OpenStreetMap attribution must remain visible in the application.
