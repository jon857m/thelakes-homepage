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

- `VITE_MAPTILER_KEY`: Optional MapTiler browser key restricted to the production domain. Upgrades the basemap to MapTiler Outdoor and uses its terrain service.
- `VITE_SUPABASE_URL`: Supabase project URL.
- `VITE_SUPABASE_ANON_KEY`: Supabase publishable/anonymous key. Never use the service-role key here.

Without a MapTiler key, the application uses OpenFreeMap's Liberty vector style and public Mapzen Terrain Tiles hosted on AWS. This provides genuine 3D terrain at no service-account cost. Without Supabase variables, persistent sharing is disabled rather than emulated.

## Verification and production output

```sh
npm run map:check
```

The generated `/map/` directory is ignored by Git and should be produced during deployment. Cloudflare Pages must run `npm run map:build` before publishing the repository root. `_redirects` supplies the SPA fallback for shared-location URLs.

Apply `supabase/migrations/202608240001_map_mvp.sql` to a Supabase project before enabling sharing.

## Refreshing the geographic search catalogue

The checked-in `map-app/public/data/map_search.json` is a cached, deduplicated OpenStreetMap extract. After downloading deliberate Overpass JSON snapshots, rebuild it with:

```sh
python3 tools/build_map_search.py --input /path/to/places.json --input /path/to/waters.json
```

Do not query a public geocoder from the search-as-you-type interface. OpenStreetMap attribution must remain visible in the application.
