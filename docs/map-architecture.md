# Interactive map architecture

## Rollout boundary

The map launches at `/map/`; the existing homepage remains unchanged. Shared pins use `/map/p/:shortCode`. This route boundary allows the map to become `/` later while the current homepage moves to `/about/` or `/community/` without changing the product internals.

## Mapping stack

The client uses React, TypeScript, Vite and MapLibre GL JS. The validation-stage default combines OpenFreeMap's Liberty vector style with public Mapzen Terrarium elevation tiles hosted in the AWS Open Data programme. This produces real 3D terrain without an account or browser API key. Required source attribution remains visible on the map. On ordinary `/map/` loads, the opening camera fits a fixed Lake District planning boundary spanning Nether Wasdale and Ulverston to Penrith and Carlisle; fitting geographic bounds rather than using one fixed zoom keeps the initial composition consistent across viewport shapes. Shared-location URLs retain their stored camera instead.

MapTiler Outdoor remains an optional upgrade through `VITE_MAPTILER_KEY` if the project later needs commercial support, a stronger outdoor cartographic base, or predictable service quotas. The terrain exaggeration is deliberately modest (`1.35`) to preserve geographic credibility.

EOX Sentinel-2 Cloudless 2025 is the default visual layer and can be toggled back to the vector map by the visitor. Unlike a multi-date aerial mosaic, this single-year colour-balanced dataset avoids obvious changes in imagery processing between adjacent tiles and zoom levels. Terrain, geographic labels and product markers remain visible above it, and the required EOX/Copernicus attribution is supplied through MapLibre's attribution control.

Satellite imagery uses a consistent in-client colour grade with modest saturation and contrast enhancement. Raster tile fading is disabled. A deep neutral underlay covers the pale vector surface while new imagery tiles load, preventing it flashing through during zoom changes. The separate hillshade layer is disabled in Satellite mode because the photography already contains natural light and shadow; the 3D terrain mesh remains active. In vector Map view, the underlay is removed and hillshade returns.

Satellite mode also applies a warm-white label treatment with a dark green halo, restoring legibility over detailed terrain while retaining the original Liberty styling in vector Map view. The camera permits zooming to level 18 so roads, labels, pins and 3D buildings remain useful at close range. Sentinel-2 reaches its native imagery detail sooner, so its photographic texture will appear softer at the deepest zoom levels.

Road and path geometry from OpenFreeMap's `transportation` source layer is promoted above the imagery as a hybrid-map overlay. Its casing and fill layers retain their original ordering and can be hidden independently through the `Roads & paths` control; no additional road tile service is requested.

Vector building footprints from OpenMapTiles are extruded above zoom 14 using their supplied render heights, with a conservative fallback height where none is available. The 3D building layer is enabled by default and has an independent visibility toggle.

## Data overlay registry

Summit datasets are normalised in `map-app/src/data/overlays.ts` and exposed through a registry containing stable source and layer identifiers. The initial overlay contains the repository's verified 214 Wainwright summits. The Birkett dataset is explicitly excluded until its OS-grid conversion is corrected and all records pass Lake District bounds validation; once repaired, it can be registered without changing the Layers control architecture.

The optional `High ground +400m` overlay uses MapLibre's client-side colour-relief renderer against the same Mapzen DEM already used for 3D terrain. Pixels below 400 metres remain transparent; higher ground receives a progressively stronger amber-to-russet tint. It is disabled by default and described as a terrain guide rather than a campsite layer, since elevation does not establish access, suitability, safety or permission.

`Special walks` is a lazy-loaded long-distance route group. The first registered route is the supplied Lakeland Way GPX, converted at build time to compact GeoJSON with start and finish features. Route data is requested only when the group is enabled. Each route has independent visibility, a high-contrast cased line, endpoint labels and a planning card with measured GPX distance and whole-route framing. `tools/convert_gpx.py` provides the repeatable import path for the Cumbria Way when its authorised GPX becomes available.

Route cards also offer a desktop-friendly cinematic fly-through. The camera advances along cumulative GPX distance at a constant speed and maintains a pitched terrain view. Direction uses a broad look-ahead window across the route plus time-based damping, with still slower correction for turns over 25 degrees, preventing individual GPX segments or sharp bends from snapping the camera. A pulsing terracotta marker tracks the current route position and rotates to the forward route bearing independently of the slower camera. Scroll-wheel and pinch zoom remain live during flight because animation frames do not overwrite the current zoom. A persistent stop control cancels the animation; dragging the map also stops it.

## Universal search

The universal search merges three adapters: current public businesses, every validated summit dataset in the overlay registry, and a lazy-loaded local geographic catalogue. Search normalisation supports aliases and punctuation-insensitive matching; exact names and prefixes rank above general term matches. Selecting a result flies the map to an appropriate zoom and opens the relevant business, summit or place card.

The geographic catalogue is generated by `tools/build_map_search.py` from cached OpenStreetMap Overpass extracts. It currently contains named settlements, localities, waters, waterfalls, becks, gills, rivers, viewpoints, attractions, valleys, caves, passes and non-Wainwright peaks within the configured Cumbria bounds. Repeated OSM way segments are spatially deduplicated during generation. The browser downloads the compressed catalogue only after search is first used; keystrokes are never transmitted to a public geocoder.

## Business markers

Active businesses are read directly through Supabase RLS. Marker DOM nodes are intentionally compact and the selected record is rendered as a responsive side card/bottom sheet. Development records are visibly described as placeholders and must be replaced by reviewed editorial records before launch.

The Layers panel exposes one master Commercial listings switch and five launch categories: Accommodation, Camping, Eating, Activities and Gifts. All five are enabled initially and can be filtered independently. Legacy or more specific database category labels are normalised into this public taxonomy in the client until the production schema enforces the canonical values.

Commercial and amenity POI layers supplied by the basemap are hidden at runtime, while place names, landscape labels and the dedicated public-transport layer remain. This prevents unlisted businesses from competing visually with the product's own business markers.

## Shared locations

The visitor can share either the current camera view or a dropped, draggable marker. New links encode a versioned, compact map-state payload in the `/map/?share=…` URL. It contains camera centre, zoom, pitch and bearing; every master layer toggle; enabled commercial categories; enabled special-walk identifiers; and the optional pin coordinate. Reopening the link reconstructs the same planning view without requiring an account, a database request or a dynamic server route.

The original `shared_locations` table and `/map/p/:shortCode` reader remain compatible with previously issued short links. A future short-link service can store the same versioned state payload when shorter social URLs justify the extra infrastructure.

Public inserts should be rate-limited by a Cloudflare Worker before launch. Supabase constraints and RLS remain the second enforcement layer.

## Database and security

The initial migration creates `businesses` and `shared_locations`, coordinate and lifecycle constraints, indexes, RLS policies and the narrowly scoped location-read RPC. The browser receives only the Supabase anonymous key. Service-role and Stripe secrets belong only in server-side Worker secrets.

The `businesses` schema already distinguishes editorial and subscriber listings and includes ownership and subscription-ready states. Business hours, subscriptions, uploads, analytics events and admin claims will be added in their phase-specific migrations rather than weakening the initial public policies.

## Accounts and administration

`/map/login/` uses Supabase Auth for the same authenticated session used by business owners and administrators. `/map/admin/` is protected twice: the client checks `is_admin()` for navigation and the database independently applies row-level policies to every business query. A non-admin cannot gain access by changing a URL or a browser flag.

Administrators can search all listings by business name, town or postcode, create editorial drafts, edit listing content and coordinates, change lifecycle state, feature or suspend a listing, and enter an edit-from-map mode. In that mode, selecting a commercial marker opens its record directly in the admin editor. The first admin is bootstrapped once in `admin_users` after their Supabase Auth account exists; routine business management thereafter requires no Supabase table editing.

Owner-editable and administrator-controlled fields are separated at the database boundary. A trigger prevents ordinary owners from changing ownership, listing type, payment-derived status or featured state even if they bypass the interface. Stripe webhooks will remain authoritative for subscriber lifecycle transitions.

## Future screenshot generation

The share-card action boundary is the insertion point for future branded map images. Generation should occur server-side from the stored camera state so social images are stable and do not depend on client screenshot support.

## Future Stripe integration

Stripe Checkout and Customer Portal sessions will be created by a Cloudflare Worker. Webhooks—not browser redirects—will update the local subscription state. Founding-plan allocation will be decided transactionally on the server. No Stripe secret or pricing authority belongs in the map bundle.
