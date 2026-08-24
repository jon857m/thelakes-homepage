import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { demoBusinesses } from "./data/demoBusinesses";
import { searchableSummits, summitOverlayRegistry, type Summit } from "./data/overlays";
import { specialWalks, type SpecialWalk } from "./data/routes";
import { nearbyBusinesses } from "./lib/geo";
import { decodeMapView, encodeMapView } from "./lib/mapShare";
import {
  coreSearchItems,
  loadGeographicSearchItems,
  searchIndex,
  type SearchItem
} from "./lib/search";
import {
  getSharedLocation,
  supabase
} from "./lib/supabase";
import type { Business, CameraState, MapLayerState, PinLocation } from "./types";

const DEFAULT_CAMERA: CameraState = {
  longitude: -3.08,
  latitude: 54.5,
  zoom: 9.25,
  pitch: 58,
  bearing: -18
};

const LAKE_DISTRICT_OPENING_BOUNDS: [[number, number], [number, number]] = [
  [-3.38, 54.18], // west/south of Nether Wasdale and Ulverston
  [-2.72, 54.92]  // east/north of Penrith and Carlisle
];

const BUSINESS_CATEGORIES = ["Accommodation", "Camping", "Eating", "Activities", "Gifts"] as const;
type BusinessCategory = typeof BUSINESS_CATEGORIES[number];

const BUSINESS_CATEGORY_ICONS: Record<BusinessCategory, string> = {
  Accommodation: '<path d="M3 18V8m0 7h18v3M6 15v-5h6a4 4 0 0 1 4 4v1M6 10V7h5a3 3 0 0 1 3 3"/>',
  Camping: '<path d="m3 19 9-15 9 15H3Zm9-15v15m-4 0 4-6 4 6"/>',
  Eating: '<path d="M6 3v7m-3-7v5a3 3 0 0 0 6 0V3M6 11v10m10-18v18m0-18c3 2 4 5 4 8h-4"/>',
  Activities: '<path d="M3 14c4 3 14 3 18 0l-3 5H6l-3-5Zm4-3 10 3m-1-8 3 3m-3-3L8 18"/>',
  Gifts: '<path d="M3 10h18v11H3V10Zm-1-5h20v5H2V5Zm10 0v16M12 5C9 5 7 4 7 2.5 7 1.5 8 1 9 1c2 0 3 2 3 4Zm0 0c3 0 5-1 5-2.5 0-1-.9-1.5-2-1.5-2 0-3 2-3 4Z"/>'
};

function businessCategory(category: string): BusinessCategory {
  const normalised = category.toLowerCase();
  if (normalised.includes("accommodation") || normalised.includes("hotel") || normalised.includes("stay")) return "Accommodation";
  if (normalised.includes("camp") || normalised.includes("caravan")) return "Camping";
  if (normalised.includes("food") || normalised.includes("drink") || normalised.includes("eat") || normalised.includes("cafe") || normalised.includes("restaurant")) return "Eating";
  if (normalised.includes("gift") || normalised.includes("retail") || normalised.includes("shop")) return "Gifts";
  return "Activities";
}

const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY as string | undefined;
const styleUrl = mapTilerKey
  ? `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${mapTilerKey}`
  : "https://tiles.openfreemap.org/styles/liberty";

const shareCandidate: unknown = Reflect.get(navigator, "share");
const nativeShare: ((data: ShareData) => Promise<void>) | undefined =
  typeof shareCandidate === "function" ? shareCandidate.bind(navigator) : undefined;

function sharedCodeFromPath() {
  const match = window.location.pathname.match(/^\/map\/p\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1]?.toUpperCase() ?? null;
}

function sharedViewFromUrl() {
  return decodeMapView(new URLSearchParams(window.location.search).get("share"));
}

function markerElement(business: Business) {
  const category = businessCategory(business.category);
  const shell = document.createElement("div");
  shell.className = "business-marker-shell";
  const button = document.createElement("button");
  button.className = `business-marker business-marker--${category.toLowerCase()}${business.featured ? " business-marker--featured" : ""}`;
  button.type = "button";
  button.title = business.name;
  button.setAttribute("aria-label", `View ${business.name}`);
  button.innerHTML = `<span><svg viewBox="0 0 24 24" aria-hidden="true">${BUSINESS_CATEGORY_ICONS[category]}</svg></span>`;
  shell.append(button);
  return shell;
}

function formatCoordinates(pin: PinLocation) {
  return `${pin.latitude.toFixed(4)}° N, ${Math.abs(pin.longitude).toFixed(4)}° W`;
}

function routeDistance(a: number[], b: number[]) {
  const toRadians = Math.PI / 180;
  const latA = a[1] * toRadians;
  const latB = b[1] * toRadians;
  const deltaLat = (b[1] - a[1]) * toRadians;
  const deltaLon = (b[0] - a[0]) * toRadians;
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(value));
}

function routeBearing(a: number[], b: number[]) {
  const toRadians = Math.PI / 180;
  const latA = a[1] * toRadians;
  const latB = b[1] * toRadians;
  const deltaLon = (b[0] - a[0]) * toRadians;
  const y = Math.sin(deltaLon) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(deltaLon);
  return Math.atan2(y, x) / toRadians;
}

export function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const businessMarkers = useRef<Marker[]>([]);
  const pinMarker = useRef<Marker | null>(null);
  const setSatelliteLabels = useRef<(enabled: boolean) => void>(() => undefined);
  const roadOverlayLayers = useRef<string[]>([]);
  const flightFrame = useRef<number | null>(null);
  const flightToken = useRef(0);
  const flightMarker = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>(demoBusinesses);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [selectedSummit, setSelectedSummit] = useState<Summit | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<SearchItem | null>(null);
  const [selectedWalk, setSelectedWalk] = useState<SpecialWalk | null>(null);
  const [flyingWalk, setFlyingWalk] = useState<SpecialWalk | null>(null);
  const [pin, setPin] = useState<PinLocation | null>(null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [pinIsShared, setPinIsShared] = useState(false);
  const [dropMode, setDropMode] = useState(false);
  const [satelliteEnabled, setSatelliteEnabled] = useState(true);
  const [roadsEnabled, setRoadsEnabled] = useState(false);
  const [buildingsEnabled, setBuildingsEnabled] = useState(false);
  const [wainwrightsEnabled, setWainwrightsEnabled] = useState(false);
  const [highGroundEnabled, setHighGroundEnabled] = useState(false);
  const [commercialEnabled, setCommercialEnabled] = useState(true);
  const [specialWalksEnabled, setSpecialWalksEnabled] = useState(false);
  const [activeSpecialWalks, setActiveSpecialWalks] = useState<Set<string>>(
    () => new Set(specialWalks.map((walk) => walk.id))
  );
  const [activeBusinessCategories, setActiveBusinessCategories] = useState<Set<BusinessCategory>>(
    () => new Set(BUSINESS_CATEGORIES)
  );
  const [layersOpen, setLayersOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [geographicSearchItems, setGeographicSearchItems] = useState<SearchItem[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const adminMode = isAdmin && new URLSearchParams(window.location.search).get("admin") === "1";

  const nearby = useMemo(
    () => (pin ? nearbyBusinesses(pin, businesses) : []),
    [pin, businesses]
  );
  const allSearchItems = useMemo(
    () => [...coreSearchItems(businesses, searchableSummits), ...geographicSearchItems],
    [businesses, geographicSearchItems]
  );
  const searchResults = useMemo(
    () => searchIndex(allSearchItems, searchQuery),
    [allSearchItems, searchQuery]
  );

  useEffect(() => setActiveSearchIndex(0), [searchQuery]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("is_admin").then(({ data }) => setIsAdmin(Boolean(data)));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from("businesses")
      .select("id,name,slug,tagline,description,category,latitude,longitude,town,address,postcode,website_url,logo_url,image_url,featured,business_images(image_url,sort_order)")
      .eq("active", true)
      .then(({ data, error }) => {
        if (error || !data?.length) return;
        setBusinesses(
          data.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            tagline: row.tagline ?? "",
            description: row.description ?? "",
            category: row.category,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            town: row.town ?? "",
            address: row.address ?? undefined,
            postcode: row.postcode ?? undefined,
            websiteUrl: row.website_url ?? undefined,
            imageUrl: row.image_url ?? undefined,
            logoUrl: row.logo_url ?? undefined,
            galleryImages: (row.business_images ?? [])
              .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
              .map((image) => image.image_url),
            featured: Boolean(row.featured)
          }))
        );
      });
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: [DEFAULT_CAMERA.longitude, DEFAULT_CAMERA.latitude],
      zoom: DEFAULT_CAMERA.zoom,
      pitch: DEFAULT_CAMERA.pitch,
      bearing: DEFAULT_CAMERA.bearing,
      // Preserve close-range navigation for roads, labels, pins and buildings,
      // even though the regional Sentinel imagery reaches native detail sooner.
      maxZoom: 18,
      maxPitch: 80,
      attributionControl: false
    });
    map.current = instance;
    const cancelFlightFromMap = () => stopRouteFlight();
    instance.on("dragstart", cancelFlightFromMap);
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    // MapLibre deliberately opens compact attribution on first render. Keep the
    // required credits one tap away without letting them cover the mobile map.
    const collapseAttribution = () => {
      const attribution = instance
        .getContainer()
        .querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib.maplibregl-compact");
      attribution?.classList.remove("maplibregl-compact-show");
      attribution?.removeAttribute("open");
    };
    window.requestAnimationFrame(collapseAttribution);
    instance.once("idle", collapseAttribution);
    instance.on("load", () => {
      const labelPaint = new Map<string, {
        color: unknown;
        haloColor: unknown;
        haloWidth: unknown;
        haloBlur: unknown;
      }>();

      instance.getStyle().layers.forEach((layer) => {
        if (layer.type !== "symbol" || !("text-field" in (layer.layout ?? {}))) return;
        labelPaint.set(layer.id, {
          color: instance.getPaintProperty(layer.id, "text-color"),
          haloColor: instance.getPaintProperty(layer.id, "text-halo-color"),
          haloWidth: instance.getPaintProperty(layer.id, "text-halo-width"),
          haloBlur: instance.getPaintProperty(layer.id, "text-halo-blur")
        });
      });

      setSatelliteLabels.current = (enabled) => {
        labelPaint.forEach((original, layerId) => {
          if (!instance.getLayer(layerId)) return;
          instance.setPaintProperty(layerId, "text-color", enabled ? "#fffaf0" : original.color);
          instance.setPaintProperty(layerId, "text-halo-color", enabled ? "rgba(10, 26, 18, 0.94)" : original.haloColor);
          instance.setPaintProperty(layerId, "text-halo-width", enabled ? 1.6 : original.haloWidth);
          instance.setPaintProperty(layerId, "text-halo-blur", enabled ? 0.25 : original.haloBlur);
        });
      };

      // The product's paid/editorial listings must be the only commercial POIs.
      // Retain the dedicated transit layer for useful public-transport context.
      instance.getStyle().layers.forEach((layer) => {
        const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
        if (sourceLayer === "poi" && layer.id !== "poi_transit") {
          instance.setLayoutProperty(layer.id, "visibility", "none");
        }
      });

      if (mapTilerKey) {
        instance.addSource("terrain", {
          type: "raster-dem",
          url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${mapTilerKey}`,
          tileSize: 256
        });
      } else {
        instance.addSource("terrain", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 15,
          attribution: "Elevation © Mapzen contributors"
        });
      }
      instance.setTerrain({ source: "terrain", exaggeration: 1.35 });

      instance.addSource("satellite-imagery", {
        type: "raster",
        tiles: [
          "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg"
        ],
        tileSize: 256,
        maxzoom: 14,
        attribution: "Sentinel-2 cloudless 2025 © EOX IT Services GmbH · Contains modified Copernicus Sentinel data 2025"
      });

      const firstLabelLayer = instance.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
      instance.addLayer(
        {
          id: "satellite-underlay",
          type: "background",
          layout: { visibility: "visible" },
          paint: { "background-color": "#16251c" }
        },
        firstLabelLayer
      );
      setSatelliteLabels.current(true);
      instance.addLayer(
        {
          id: "satellite-imagery",
          type: "raster",
          source: "satellite-imagery",
          layout: { visibility: "visible" },
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 0,
            "raster-saturation": 0.08,
            "raster-contrast": 0.08,
            "raster-brightness-min": 0.02,
            "raster-brightness-max": 0.96
          }
        },
        firstLabelLayer
      );

      // Liberty's road geometry normally sits below raster imagery. Promote
      // its complete casing/fill stack to make Satellite mode a hybrid map.
      roadOverlayLayers.current = instance.getStyle().layers
        .filter((layer) => {
          const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
          return layer.type === "line" && sourceLayer === "transportation";
        })
        .map((layer) => layer.id);
      roadOverlayLayers.current.forEach((layerId) => instance.moveLayer(layerId, firstLabelLayer));
      roadOverlayLayers.current.forEach((layerId) => instance.setLayoutProperty(layerId, "visibility", "none"));

      instance.addLayer(
        {
          id: "high-ground-400m",
          type: "color-relief",
          source: "terrain",
          layout: { visibility: "none" },
          paint: {
            "color-relief-color": [
              "interpolate",
              ["linear"],
              ["elevation"],
              0,
              "rgba(0, 0, 0, 0)",
              399,
              "rgba(0, 0, 0, 0)",
              400,
              "rgba(240, 197, 83, 0.28)",
              600,
              "rgba(225, 143, 68, 0.36)",
              850,
              "rgba(190, 85, 62, 0.44)",
              1100,
              "rgba(142, 54, 54, 0.5)"
            ],
            "color-relief-opacity": 1
          }
        },
        firstLabelLayer
      );

      if (!instance.getLayer("terrain-hillshade")) {
        instance.addLayer(
          {
            id: "terrain-hillshade",
            type: "hillshade",
            source: "terrain",
            layout: { visibility: "none" },
            paint: {
              "hillshade-shadow-color": "rgba(15, 32, 22, 0.48)",
              "hillshade-highlight-color": "rgba(255, 244, 207, 0.2)",
              "hillshade-accent-color": "rgba(57, 79, 61, 0.34)",
              "hillshade-exaggeration": 0.2
            }
          },
          firstLabelLayer
        );
      }

      // Liberty includes its own extrusion. Keep flat building footprints for
      // map context, but suppress every pre-existing 3D building layer so the
      // product toggle has one unambiguous source of truth.
      instance.getStyle().layers.forEach((layer) => {
        const sourceLayer = "source-layer" in layer ? layer["source-layer"] : undefined;
        if (layer.type === "fill-extrusion" && sourceLayer === "building") {
          instance.setLayoutProperty(layer.id, "visibility", "none");
        }
      });

      instance.addLayer(
        {
          id: "lakes-3d-buildings",
          type: "fill-extrusion",
          source: "openmaptiles",
          "source-layer": "building",
          minzoom: 14,
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-color": [
              "interpolate",
              ["linear"],
              ["zoom"],
              14,
              "#d8d1c1",
              17,
              "#ece7dc"
            ],
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 7],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.9,
            "fill-extrusion-vertical-gradient": true
          }
        },
        firstLabelLayer
      );

      const wainwrightOverlay = summitOverlayRegistry.wainwrights;
      instance.addSource(wainwrightOverlay.sourceId, {
        type: "geojson",
        data: wainwrightOverlay.data
      });
      instance.addLayer({
        id: wainwrightOverlay.pointLayerId,
        type: "circle",
        source: wainwrightOverlay.sourceId,
        minzoom: 8,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 6, 16, 8],
          "circle-color": "#f0c85a",
          "circle-stroke-color": "#183426",
          "circle-stroke-width": 2,
          "circle-opacity": 0.95
        }
      });
      instance.addLayer({
        id: wainwrightOverlay.labelLayerId,
        type: "symbol",
        source: wainwrightOverlay.sourceId,
        minzoom: 11,
        layout: {
          visibility: "none",
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 13],
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": false
        },
        paint: {
          "text-color": "#fffaf0",
          "text-halo-color": "#183426",
          "text-halo-width": 1.5
        }
      });
      instance.on("mouseenter", wainwrightOverlay.pointLayerId, () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", wainwrightOverlay.pointLayerId, () => {
        instance.getCanvas().style.cursor = "";
      });
      instance.on("click", wainwrightOverlay.pointLayerId, (event) => {
        const feature = event.features?.[0];
        const coordinates = feature?.geometry.type === "Point" ? feature.geometry.coordinates : null;
        if (!feature?.properties || !coordinates) return;
        setSelectedSummit({
          name: String(feature.properties.name),
          aliases: feature.properties.aliases ? String(feature.properties.aliases).split(" · ") : [],
          latitude: Number(coordinates[1]),
          longitude: Number(coordinates[0]),
          elevationMetres: Number(feature.properties.elevationMetres),
          list: "Wainwright"
        });
        setSelectedBusiness(null);
      setSelectedPlace(null);
      setSelectedWalk(null);
      });

      if (!mapTilerKey) {
        setNotice("Free 3D terrain preview · OpenFreeMap and Mapzen elevation data");
      }
      if (!sharedCodeFromPath() && !sharedViewFromUrl()) {
        instance.fitBounds(LAKE_DISTRICT_OPENING_BOUNDS, {
          padding: { top: 105, right: 70, bottom: 75, left: 70 },
          bearing: -12,
          pitch: 52,
          duration: 0,
          maxZoom: 10.6
        });
        // A pitched camera reserves substantial space for the horizon. Tighten
        // the calculated fit so Cumbria, rather than southern Scotland, owns
        // the frame on tall and near-square desktop windows.
        instance.setZoom(Math.min(10.6, instance.getZoom() + 1.15));
      }
      setMapReady(true);
    });
    return () => {
      flightToken.current += 1;
      if (flightFrame.current !== null) cancelAnimationFrame(flightFrame.current);
      flightMarker.current?.remove();
      instance.off("dragstart", cancelFlightFromMap);
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    businessMarkers.current.forEach((marker) => marker.remove());
    businessMarkers.current = businesses
      .filter((business) => commercialEnabled && activeBusinessCategories.has(businessCategory(business.category)))
      .map((business) => {
      const element = markerElement(business);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (adminMode) {
          window.location.assign(`/map/admin/?business=${business.id}`);
          return;
        }
        setSelectedBusiness(business);
        setSelectedSummit(null);
        setSelectedPlace(null);
        instance.easeTo({
          center: [business.longitude, business.latitude],
          duration: 700,
          padding: { bottom: 220, top: 0, left: 0, right: 0 }
        });
      });
      return new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([business.longitude, business.latitude])
        .addTo(instance);
      });
    return () => businessMarkers.current.forEach((marker) => marker.remove());
  }, [activeBusinessCategories, adminMode, businesses, commercialEnabled, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const requestedId = new URLSearchParams(window.location.search).get("business");
    const requested = businesses.find((business) => business.id === requestedId);
    if (!requested) return;
    setSelectedBusiness(requested);
    map.current?.flyTo({
      center: [requested.longitude, requested.latitude],
      zoom: 15,
      pitch: 58,
      duration: 900,
      essential: true
    });
  }, [businesses, mapReady]);

  const placePin = useCallback((location: PinLocation) => {
    const instance = map.current;
    if (!instance) return;
    pinMarker.current?.remove();
    const element = document.createElement("div");
    element.className = "location-pin";
    element.innerHTML = "<span></span>";
    const marker = new maplibregl.Marker({ element, draggable: true, anchor: "bottom" })
      .setLngLat([location.longitude, location.latitude])
      .addTo(instance);
    marker.on("dragend", () => {
      const coordinates = marker.getLngLat();
      setPin({ latitude: coordinates.lat, longitude: coordinates.lng });
      setPinIsShared(false);
      setPinSheetOpen(true);
      setShareUrl("");
    });
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      setPinSheetOpen(true);
    });
    pinMarker.current = marker;
    setPin(location);
    setPinIsShared(false);
    setPinSheetOpen(true);
    setShareUrl("");
    setSelectedBusiness(null);
    setSelectedSummit(null);
    setSelectedPlace(null);
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (!dropMode) {
        if (pinSheetOpen) setPinSheetOpen(false);
        return;
      }
      placePin({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
      setDropMode(false);
      instance.easeTo({
        center: event.lngLat,
        offset: [0, window.innerWidth <= 680 ? -105 : -130],
        duration: 550
      });
    };
    instance.on("click", onClick);
    return () => { instance.off("click", onClick); };
  }, [dropMode, mapReady, pinSheetOpen, placePin]);

  useEffect(() => {
    const shared = sharedViewFromUrl();
    if (!shared || !mapReady) return;
    applyLayerState(shared.layers);
    if (shared.pin) {
      placePin(shared.pin);
      setPinIsShared(true);
    }
    map.current?.flyTo({ ...shared.camera, center: [shared.camera.longitude, shared.camera.latitude], duration: 1200 });
    setShareUrl(window.location.href);
    setNotice(shared.pin ? "Location shared from The Lakes in Cumbria" : "Map view shared from The Lakes in Cumbria");
  }, [mapReady, placePin]);

  useEffect(() => {
    const code = sharedCodeFromPath();
    if (!code || !mapReady) return;
    setBusy(true);
    getSharedLocation(code)
      .then((location) => {
        if (!location) {
          setNotice("This shared location has expired or could not be found.");
          return;
        }
        placePin(location);
        setPinIsShared(true);
        map.current?.flyTo({
          center: [location.longitude, location.latitude],
          zoom: location.zoom,
          pitch: location.pitch,
          bearing: location.bearing,
          duration: 1800
        });
        setShareUrl(window.location.href);
        setNotice("Location shared from The Lakes in Cumbria");
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Unable to open this location."))
      .finally(() => setBusy(false));
  }, [mapReady, placePin]);

  function currentLayerState(): MapLayerState {
    return {
      satellite: satelliteEnabled,
      roads: roadsEnabled,
      buildings: buildingsEnabled,
      wainwrights: wainwrightsEnabled,
      highGround: highGroundEnabled,
      commercial: commercialEnabled,
      specialWalks: specialWalksEnabled,
      businessCategories: [...activeBusinessCategories],
      walkIds: [...activeSpecialWalks]
    };
  }

  async function shareMap(pinToShare?: PinLocation) {
    if (!map.current) return;
    setBusy(true);
    setNotice(null);
    try {
      const centre = map.current.getCenter();
      const encoded = encodeMapView({
        longitude: centre.lng,
        latitude: centre.lat,
        zoom: map.current.getZoom(),
        pitch: map.current.getPitch(),
        bearing: map.current.getBearing()
      }, currentLayerState(), pinToShare);
      const url = `${window.location.origin}/map/?share=${encoded}`;
      setShareUrl(url);
      if (nativeShare) await nativeShare({ title: pinToShare ? "Lake District location" : "Lake District map view", url });
      else await navigator.clipboard.writeText(url);
      if (!pinToShare) setNotice("Map view link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(error instanceof Error ? error.message : "Unable to share this location.");
    } finally {
      setBusy(false);
    }
  }

  async function shareLocation() {
    if (pin) await shareMap(pin);
  }

  function applyLayerState(state: MapLayerState) {
    const instance = map.current;
    if (!instance) return;
    setSatelliteEnabled(state.satellite);
    ["satellite-imagery", "satellite-underlay"].forEach((id) => {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, "visibility", state.satellite ? "visible" : "none");
    });
    if (instance.getLayer("terrain-hillshade")) instance.setLayoutProperty("terrain-hillshade", "visibility", state.satellite ? "none" : "visible");
    setSatelliteLabels.current(state.satellite);
    setRoadsEnabled(state.roads);
    roadOverlayLayers.current.forEach((id) => instance.setLayoutProperty(id, "visibility", state.roads ? "visible" : "none"));
    setBuildingsEnabled(state.buildings);
    if (instance.getLayer("lakes-3d-buildings")) instance.setLayoutProperty("lakes-3d-buildings", "visibility", state.buildings ? "visible" : "none");
    setWainwrightsEnabled(state.wainwrights);
    const summit = summitOverlayRegistry.wainwrights;
    [summit.pointLayerId, summit.labelLayerId].forEach((id) => instance.setLayoutProperty(id, "visibility", state.wainwrights ? "visible" : "none"));
    setHighGroundEnabled(state.highGround);
    if (instance.getLayer("high-ground-400m")) instance.setLayoutProperty("high-ground-400m", "visibility", state.highGround ? "visible" : "none");
    setCommercialEnabled(state.commercial);
    setActiveBusinessCategories(new Set(state.businessCategories.filter((category): category is BusinessCategory => BUSINESS_CATEGORIES.includes(category as BusinessCategory))));
    setSpecialWalksEnabled(state.specialWalks);
    const activeWalks = new Set(state.walkIds);
    setActiveSpecialWalks(activeWalks);
    specialWalks.forEach((walk) => setSpecialWalkVisibility(walk, state.specialWalks && activeWalks.has(walk.id)));
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setNotice("Link copied to clipboard.");
  }

  function removePin() {
    pinMarker.current?.remove();
    pinMarker.current = null;
    setPin(null);
    setPinSheetOpen(false);
    setPinIsShared(false);
    setShareUrl("");
    window.history.replaceState({}, "", "/map/");
  }

  function toggleSatellite() {
    const next = !satelliteEnabled;
    setSatelliteEnabled(next);
    if (map.current?.getLayer("satellite-imagery")) {
      map.current.setLayoutProperty("satellite-imagery", "visibility", next ? "visible" : "none");
    }
    if (map.current?.getLayer("satellite-underlay")) {
      map.current.setLayoutProperty("satellite-underlay", "visibility", next ? "visible" : "none");
    }
    if (map.current?.getLayer("terrain-hillshade")) {
      map.current.setLayoutProperty("terrain-hillshade", "visibility", next ? "none" : "visible");
    }
    setSatelliteLabels.current(next);
  }

  function toggleBuildings() {
    const next = !buildingsEnabled;
    setBuildingsEnabled(next);
    if (map.current?.getLayer("lakes-3d-buildings")) {
      map.current.setLayoutProperty("lakes-3d-buildings", "visibility", next ? "visible" : "none");
    }
  }

  function toggleRoads() {
    const next = !roadsEnabled;
    setRoadsEnabled(next);
    roadOverlayLayers.current.forEach((layerId) => {
      if (map.current?.getLayer(layerId)) {
        map.current.setLayoutProperty(layerId, "visibility", next ? "visible" : "none");
      }
    });
  }

  function toggleWainwrights() {
    const next = !wainwrightsEnabled;
    setWainwrightsEnabled(next);
    const overlay = summitOverlayRegistry.wainwrights;
    [overlay.pointLayerId, overlay.labelLayerId].forEach((layerId) => {
      if (map.current?.getLayer(layerId)) {
        map.current.setLayoutProperty(layerId, "visibility", next ? "visible" : "none");
      }
    });
    if (!next) setSelectedSummit(null);
  }

  function toggleHighGround() {
    const next = !highGroundEnabled;
    setHighGroundEnabled(next);
    if (map.current?.getLayer("high-ground-400m")) {
      map.current.setLayoutProperty("high-ground-400m", "visibility", next ? "visible" : "none");
    }
  }

  function specialWalkLayerIds(walk: SpecialWalk) {
    return {
      source: `special-walk-${walk.id}`,
      casing: `special-walk-${walk.id}-casing`,
      line: `special-walk-${walk.id}-line`,
      endpoints: `special-walk-${walk.id}-endpoints`,
      labels: `special-walk-${walk.id}-labels`
    };
  }

  function ensureSpecialWalk(walk: SpecialWalk) {
    const instance = map.current;
    if (!instance) return;
    const ids = specialWalkLayerIds(walk);
    if (instance.getSource(ids.source)) return;
    instance.addSource(ids.source, {
      type: "geojson",
      data: walk.dataUrl,
      attribution: walk.attribution
    });
    const firstLabelLayer = instance.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    instance.addLayer({
      id: ids.casing,
      type: "line",
      source: ids.source,
      filter: ["==", ["get", "kind"], "route"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#13271b", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 8], "line-opacity": 0.9 }
    }, firstLabelLayer);
    instance.addLayer({
      id: ids.line,
      type: "line",
      source: ids.source,
      filter: ["==", ["get", "kind"], "route"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": walk.colour, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 5], "line-opacity": 0.96 }
    }, firstLabelLayer);
    instance.addLayer({
      id: ids.endpoints,
      type: "circle",
      source: ids.source,
      filter: ["in", ["get", "kind"], ["literal", ["start", "finish"]]],
      paint: { "circle-radius": 7, "circle-color": walk.colour, "circle-stroke-color": "#13271b", "circle-stroke-width": 3 }
    });
    instance.addLayer({
      id: ids.labels,
      type: "symbol",
      source: ids.source,
      filter: ["in", ["get", "kind"], ["literal", ["start", "finish"]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top" },
      paint: { "text-color": "#fffaf0", "text-halo-color": "#183426", "text-halo-width": 1.5 }
    });
    instance.on("mouseenter", ids.line, () => { instance.getCanvas().style.cursor = "pointer"; });
    instance.on("mouseleave", ids.line, () => { instance.getCanvas().style.cursor = ""; });
    instance.on("click", ids.line, () => {
      setSelectedWalk(walk);
      setSelectedBusiness(null);
      setSelectedSummit(null);
      setSelectedPlace(null);
    });
  }

  function setSpecialWalkVisibility(walk: SpecialWalk, visible: boolean) {
    ensureSpecialWalk(walk);
    const instance = map.current;
    if (!instance) return;
    const ids = specialWalkLayerIds(walk);
    [ids.casing, ids.line, ids.endpoints, ids.labels].forEach((layerId) => {
      if (instance.getLayer(layerId)) instance.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    });
  }

  function toggleSpecialWalks() {
    const next = !specialWalksEnabled;
    setSpecialWalksEnabled(next);
    specialWalks.forEach((walk) => setSpecialWalkVisibility(walk, next && activeSpecialWalks.has(walk.id)));
  }

  function toggleSpecialWalk(walk: SpecialWalk) {
    const nextActive = !activeSpecialWalks.has(walk.id);
    setActiveSpecialWalks((current) => {
      const next = new Set(current);
      if (nextActive) next.add(walk.id);
      else next.delete(walk.id);
      return next;
    });
    if (specialWalksEnabled) setSpecialWalkVisibility(walk, nextActive);
  }

  function stopRouteFlight() {
    flightToken.current += 1;
    if (flightFrame.current !== null) cancelAnimationFrame(flightFrame.current);
    flightFrame.current = null;
    flightMarker.current?.remove();
    flightMarker.current = null;
    setFlyingWalk(null);
  }

  async function flyRoute(walk: SpecialWalk) {
    const instance = map.current;
    if (!instance) return;
    stopRouteFlight();
    setSelectedWalk(null);
    const token = flightToken.current;
    setFlyingWalk(walk);
    try {
      const response = await fetch(walk.dataUrl);
      if (!response.ok) throw new Error("Unable to load this route.");
      const data = await response.json() as {
        features: Array<{ properties?: { kind?: string }; geometry?: { type?: string; coordinates?: number[][] } }>;
      };
      const coordinates = data.features.find((feature) => feature.properties?.kind === "route")?.geometry?.coordinates;
      if (!coordinates || coordinates.length < 2 || token !== flightToken.current) return;

      const cumulative = [0];
      for (let index = 1; index < coordinates.length; index += 1) {
        cumulative.push(cumulative[index - 1] + routeDistance(coordinates[index - 1], coordinates[index]));
      }
      const total = cumulative[cumulative.length - 1];
      let segment = 1;
      const coordinateAtDistance = (distance: number): [number, number] => {
        const target = Math.max(0, Math.min(total, distance));
        let low = 1;
        let high = cumulative.length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          if (cumulative[middle] < target) low = middle + 1;
          else high = middle;
        }
        const index = low;
        const startDistance = cumulative[index - 1];
        const endDistance = cumulative[index];
        const mix = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
        const start = coordinates[index - 1];
        const end = coordinates[index];
        return [start[0] + (end[0] - start[0]) * mix, start[1] + (end[1] - start[1]) * mix];
      };
      let lastBearing = routeBearing(coordinateAtDistance(0), coordinateAtDistance(700));
      let lastFrameTime = 0;
      const markerShell = document.createElement("div");
      markerShell.className = "route-flight-marker-shell";
      markerShell.innerHTML = '<span class="route-flight-marker"><i></i></span>';
      flightMarker.current = new maplibregl.Marker({ element: markerShell, anchor: "center", rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat(coordinates[0] as [number, number])
        .setRotation(lastBearing)
        .addTo(instance);
      instance.easeTo({ center: coordinates[0] as [number, number], zoom: 12.2, pitch: 67, bearing: lastBearing, duration: 1400 });
      await new Promise((resolve) => window.setTimeout(resolve, 1450));
      if (token !== flightToken.current) return;
      const started = performance.now();
      const duration = Math.max(60_000, walk.distanceKm * 450);

      const frame = (now: number) => {
        if (token !== flightToken.current) return;
        const progress = Math.min(1, (now - started) / duration);
        const target = total * progress;
        while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
        const startDistance = cumulative[segment - 1];
        const endDistance = cumulative[segment];
        const mix = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
        const start = coordinates[segment - 1];
        const end = coordinates[segment];
        const centre: [number, number] = [start[0] + (end[0] - start[0]) * mix, start[1] + (end[1] - start[1]) * mix];
        const bearingFrom = coordinateAtDistance(target - 400);
        const bearingTo = coordinateAtDistance(target + 1400);
        const rawBearing = routeBearing(bearingFrom, bearingTo);
        const bearingDelta = ((rawBearing - lastBearing + 540) % 360) - 180;
        const elapsed = lastFrameTime === 0 ? 16 : Math.min(100, now - lastFrameTime);
        lastFrameTime = now;
        const turnTimeConstant = Math.abs(bearingDelta) > 25 ? 5200 : 3200;
        const turnSmoothing = 1 - Math.exp(-elapsed / turnTimeConstant);
        lastBearing += bearingDelta * turnSmoothing;
        flightMarker.current?.setLngLat(centre).setRotation(rawBearing);
        // Deliberately omit zoom: wheel and pinch gestures remain under the
        // visitor's control while position and direction continue to follow.
        instance.jumpTo({ center: centre, pitch: 67, bearing: lastBearing });
        if (progress < 1) flightFrame.current = requestAnimationFrame(frame);
        else {
          flightFrame.current = null;
          flightMarker.current?.remove();
          flightMarker.current = null;
          setFlyingWalk(null);
        }
      };
      flightFrame.current = requestAnimationFrame(frame);
    } catch (error) {
      stopRouteFlight();
      setNotice(error instanceof Error ? error.message : "Unable to fly this route.");
    }
  }

  function toggleBusinessCategory(category: BusinessCategory) {
    setActiveBusinessCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function ensureGeographicSearch() {
    if (geographicSearchItems.length || searchLoading) return;
    setSearchLoading(true);
    try {
      setGeographicSearchItems(await loadGeographicSearchItems());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The place catalogue could not be loaded.");
    } finally {
      setSearchLoading(false);
    }
  }

  function chooseSearchResult(item: SearchItem) {
    setSearchQuery(item.name);
    setSearchOpen(false);
    setLayersOpen(false);
    setSelectedBusiness(item.business ?? null);
    setSelectedSummit(item.summit ?? null);
    setSelectedPlace(item.kind === "place" ? item : null);
    map.current?.flyTo({
      center: [item.longitude, item.latitude],
      zoom: item.zoom,
      pitch: Math.max(map.current.getPitch(), 58),
      duration: 1400,
      essential: true
    });
  }

  function handleSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.min(index + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && searchResults[activeSearchIndex]) {
      event.preventDefault();
      chooseSearchResult(searchResults[activeSearchIndex]);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
    }
  }

  return (
    <main className={`map-shell${dropMode ? " is-dropping" : ""}${(pin && pinSheetOpen) || selectedBusiness || selectedSummit || selectedPlace || selectedWalk ? " has-sheet" : ""}`}>
      <div ref={mapContainer} className="map-canvas" aria-label="Interactive map of the Lake District" />

      <header className="brand-panel">
        <a href="/" className="brand-link" aria-label="The Lake District homepage">
          <img className="brand-mark" src="/map/brand/hero.jpg" alt="" />
          <span><strong>The Lake District</strong><small><span className="brand-subtitle--desktop">Visitor &amp; local community hub</span><span className="brand-subtitle--mobile">3D Explorer</span></small></span>
        </a>
        <span className="map-label">3D explorer</span>
      </header>

      <div className="universal-search">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={searchQuery}
            placeholder="Search fells, places and businesses"
            aria-label="Search the Lake District map"
            aria-expanded={searchOpen}
            aria-controls="searchResults"
            aria-autocomplete="list"
            aria-activedescendant={searchOpen && searchResults[activeSearchIndex] ? `search-result-${activeSearchIndex}` : undefined}
            role="combobox"
            autoComplete="off"
            onFocus={() => {
              setSearchOpen(true);
              void ensureGeographicSearch();
            }}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchOpen(true);
              void ensureGeographicSearch();
            }}
            onKeyDown={handleSearchKey}
          />
          {searchQuery && <button onClick={() => { setSearchQuery(""); setSearchOpen(true); }} aria-label="Clear search">×</button>}
        </div>
        {searchOpen && searchQuery.trim().length >= 2 && (
          <div className="search-results" id="searchResults" role="listbox">
            {searchLoading && <div className="search-status">Loading Lake District places…</div>}
            {!searchLoading && searchResults.length === 0 && <div className="search-status">No matching place found.</div>}
            {searchResults.map((item, index) => (
              <button
                key={item.id}
                id={`search-result-${index}`}
                role="option"
                aria-selected={index === activeSearchIndex}
                className={index === activeSearchIndex ? "search-result is-active" : "search-result"}
                onMouseEnter={() => setActiveSearchIndex(index)}
                onClick={() => chooseSearchResult(item)}
              >
                <span className={`search-result__icon search-result__icon--${item.kind}`} aria-hidden="true">
                  {item.kind === "business" ? "●" : item.kind === "summit" ? "▲" : "⌖"}
                </span>
                <span><strong>{item.name}</strong><small>{item.category}</small></span>
              </button>
            ))}
            <div className="search-credit">Places © OpenStreetMap contributors</div>
          </div>
        )}
      </div>

      <aside className="business-cta">
        <strong>Own a Lake District business?</strong>
        <span>Founding listings from £5/month</span>
        <a href="/map/business/">Add your business</a>
      </aside>

      {adminMode && <a className="admin-map-mode" href="/map/admin/">Admin edit mode · Exit</a>}

      <div className="map-actions">
        <button
          className={dropMode ? "action-button action-button--active" : "action-button"}
          onClick={() => setDropMode((active) => !active)}
        >
          <span aria-hidden="true">＋</span>{dropMode ? "Tap the map" : "Drop a pin"}
        </button>
        <button
          className={layersOpen ? "action-button action-button--active" : "action-button"}
          onClick={() => setLayersOpen((open) => !open)}
          aria-expanded={layersOpen}
          aria-controls="layersMenu"
        >
          <span className="layer-icon" aria-hidden="true">◫</span>Layers
        </button>
        <button className="action-button" onClick={() => void shareMap()} disabled={busy || !mapReady}>
          <span className="share-icon" aria-hidden="true">↗</span>Share view
        </button>
      </div>

      {layersOpen && (
        <section className="layers-menu" id="layersMenu" aria-label="Map layers">
          <div className="layers-menu__heading"><strong>Map layers</strong><button onClick={() => setLayersOpen(false)} aria-label="Close layers">×</button></div>
          <button className="layer-row" onClick={toggleSatellite} aria-pressed={satelliteEnabled} disabled={!mapReady}>
            <span><strong>Satellite</strong><small>Aerial imagery</small></span><i>{satelliteEnabled ? "On" : "Off"}</i>
          </button>
          <button className="layer-row" onClick={toggleRoads} aria-pressed={roadsEnabled} disabled={!mapReady}>
            <span><strong>Roads &amp; paths</strong><small>Hybrid map linework</small></span><i>{roadsEnabled ? "On" : "Off"}</i>
          </button>
          <button className="layer-row" onClick={toggleBuildings} aria-pressed={buildingsEnabled} disabled={!mapReady}>
            <span><strong>3D buildings</strong><small>At closer zoom</small></span><i>{buildingsEnabled ? "On" : "Off"}</i>
          </button>
          <button className="layer-row" onClick={toggleWainwrights} aria-pressed={wainwrightsEnabled} disabled={!mapReady}>
            <span><strong>Wainwrights</strong><small>{summitOverlayRegistry.wainwrights.count} summits</small></span><i>{wainwrightsEnabled ? "On" : "Off"}</i>
          </button>
          <button className="layer-row" onClick={toggleSpecialWalks} aria-pressed={specialWalksEnabled} disabled={!mapReady}>
            <span><strong>Special walks</strong><small>Long-distance routes</small></span><i>{specialWalksEnabled ? "On" : "Off"}</i>
          </button>
          {specialWalksEnabled && (
            <div className="route-filters" aria-label="Special walks">
              {specialWalks.map((walk) => (
                <div className="route-filter-row" key={walk.id}>
                  <button className="route-filter-toggle" onClick={() => toggleSpecialWalk(walk)} aria-pressed={activeSpecialWalks.has(walk.id)}>
                    <span style={{ background: walk.colour }} aria-hidden="true"></span>
                    <strong>{walk.name}</strong>
                    <small>{Math.round(walk.distanceKm)} km</small>
                  </button>
                  <button className="route-filter-open" onClick={() => setSelectedWalk(walk)} aria-label={`Open ${walk.name} planning card`}>›</button>
                </div>
              ))}
            </div>
          )}
          <button className="layer-row" onClick={() => setCommercialEnabled((enabled) => !enabled)} aria-pressed={commercialEnabled} disabled={!mapReady}>
            <span><strong>Commercial listings</strong><small>{businesses.length} places</small></span><i>{commercialEnabled ? "On" : "Off"}</i>
          </button>
          {commercialEnabled && (
            <div className="business-filters" aria-label="Commercial listing categories">
              {BUSINESS_CATEGORIES.map((category) => (
                <button
                  key={category}
                  className={`business-filter business-filter--${category.toLowerCase()}`}
                  onClick={() => toggleBusinessCategory(category)}
                  aria-pressed={activeBusinessCategories.has(category)}
                >
                  <span aria-hidden="true">
                    <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: BUSINESS_CATEGORY_ICONS[category] }} />
                  </span>{category}
                </button>
              ))}
            </div>
          )}
          <button className="layer-row" onClick={toggleHighGround} aria-pressed={highGroundEnabled} disabled={!mapReady}>
            <span><strong>High ground +400m</strong><small>Terrain guide · not campsites</small></span><i>{highGroundEnabled ? "On" : "Off"}</i>
          </button>
        </section>
      )}

      {dropMode && <div className="drop-hint">Tap anywhere to place your pin</div>}
      {busy && <div className="loading-badge">Working…</div>}
      {notice && <button className={notice.startsWith("Free 3D terrain") ? "notice notice--source" : "notice"} onClick={() => setNotice(null)}>{notice}<span>×</span></button>}
      {flyingWalk && (
        <div className="flight-control" role="group" aria-label={`${flyingWalk.name} flight controls`}>
          <button onClick={() => map.current?.zoomOut({ duration: 250 })} aria-label="Zoom out during flight">−</button>
          <button className="flight-control__stop" onClick={stopRouteFlight}>
            <span aria-hidden="true">■</span> Stop flying {flyingWalk.name}
          </button>
          <button onClick={() => map.current?.zoomIn({ duration: 250 })} aria-label="Zoom in during flight">+</button>
        </div>
      )}

      {selectedBusiness && (
        <section className="bottom-sheet business-sheet" aria-label={selectedBusiness.name}>
          <button className="sheet-close" onClick={() => setSelectedBusiness(null)} aria-label="Close">×</button>
          <div className="sheet-kicker">{selectedBusiness.category} · {selectedBusiness.town}</div>
          <div className="business-sheet__identity">
            {selectedBusiness.logoUrl && <img className="business-sheet__logo" src={selectedBusiness.logoUrl} alt={`${selectedBusiness.name} logo`} />}
            <div>
              <h1>{selectedBusiness.name}</h1>
              <strong className="tagline">{selectedBusiness.tagline}</strong>
            </div>
          </div>
          {selectedBusiness.imageUrl && <img className="business-sheet__hero" src={selectedBusiness.imageUrl} alt={selectedBusiness.name} />}
          <p>{selectedBusiness.description}</p>
          {selectedBusiness.galleryImages && selectedBusiness.galleryImages.length > 0 && <div className="business-sheet__gallery">
            {selectedBusiness.galleryImages.slice(0, 5).map((image, index) => <img key={image} src={image} alt={`${selectedBusiness.name} ${index + 2}`} />)}
          </div>}
          <div className="sheet-actions">
            {selectedBusiness.websiteUrl && <a href={selectedBusiness.websiteUrl} target="_blank" rel="noreferrer">Website</a>}
            <a href={selectedBusiness.directionsUrl ?? `https://www.google.com/maps/dir/?api=1&destination=${selectedBusiness.latitude},${selectedBusiness.longitude}`} target="_blank" rel="noreferrer">Directions</a>
            {isAdmin && <a className="secondary" href={`/map/admin/?business=${selectedBusiness.id}`}>Edit listing</a>}
          </div>
        </section>
      )}

      {selectedSummit && !selectedBusiness && (
        <section className="bottom-sheet summit-sheet" aria-label={selectedSummit.name}>
          <button className="sheet-close" onClick={() => setSelectedSummit(null)} aria-label="Close summit">×</button>
          <div className="sheet-kicker">{selectedSummit.list} summit</div>
          <h1>{selectedSummit.name}</h1>
          <p className="summit-height">{selectedSummit.elevationMetres} metres · {Math.round(selectedSummit.elevationMetres * 3.28084).toLocaleString()} feet</p>
          {selectedSummit.aliases.length > 0 && <p>Also known as {selectedSummit.aliases.join(", ")}.</p>}
          <div className="sheet-actions">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedSummit.latitude},${selectedSummit.longitude}`} target="_blank" rel="noreferrer">Directions</a>
            <button className="secondary" onClick={() => {
              placePin({ latitude: selectedSummit.latitude, longitude: selectedSummit.longitude });
              setSelectedSummit(null);
            }}>Share this summit</button>
          </div>
        </section>
      )}

      {selectedPlace && !selectedBusiness && !selectedSummit && (
        <section className="bottom-sheet place-sheet" aria-label={selectedPlace.name}>
          <button className="sheet-close" onClick={() => setSelectedPlace(null)} aria-label="Close place">×</button>
          <div className="sheet-kicker">{selectedPlace.category}</div>
          <h1>{selectedPlace.name}</h1>
          {selectedPlace.aliases.length > 0 && <p>Also known as {selectedPlace.aliases.join(", ")}.</p>}
          <p className="coordinates">{formatCoordinates({ latitude: selectedPlace.latitude, longitude: selectedPlace.longitude })}</p>
          <div className="sheet-actions">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPlace.latitude},${selectedPlace.longitude}`} target="_blank" rel="noreferrer">Directions</a>
            <button className="secondary" onClick={() => {
              placePin({ latitude: selectedPlace.latitude, longitude: selectedPlace.longitude });
              setSelectedPlace(null);
            }}>Share this place</button>
          </div>
        </section>
      )}

      {selectedWalk && !selectedBusiness && !selectedSummit && !selectedPlace && (
        <section className="bottom-sheet route-sheet" aria-label={selectedWalk.name}>
          <button className="sheet-close" onClick={() => setSelectedWalk(null)} aria-label="Close route">×</button>
          <div className="sheet-kicker">Special walk · GPX route</div>
          <h1>{selectedWalk.name}</h1>
          <p className="route-distance">{selectedWalk.distanceKm.toFixed(1)} km · {(selectedWalk.distanceKm * 0.621371).toFixed(1)} miles</p>
          <p>A planning aid based on the supplied GPX track. Check current access, conditions and official route information before setting out.</p>
          <div className="sheet-actions">
            <button onClick={() => map.current?.fitBounds(selectedWalk.bounds, { padding: 70, duration: 900, pitch: 45 })}>View whole route</button>
            <button className="secondary" onClick={() => void flyRoute(selectedWalk)} disabled={flyingWalk?.id === selectedWalk.id}>Fly the route</button>
            {selectedWalk.id === "lakeland-way" && <a href="https://lakelandway.uk/" target="_blank" rel="noreferrer">Official website</a>}
          </div>
        </section>
      )}

      {pin && pinSheetOpen && !selectedBusiness && !selectedSummit && !selectedPlace && (
        <section className="bottom-sheet pin-sheet" aria-label="Shared location">
          <button className="sheet-close" onClick={removePin} aria-label="Remove pin">×</button>
          <div className="sheet-kicker">Exact location</div>
          <h1>Share this location</h1>
          <p className="coordinates">{formatCoordinates(pin)}</p>
          <div className="sheet-actions">
            <button onClick={shareLocation} disabled={busy}>{nativeShare ? "Share" : "Create link"}</button>
            {shareUrl && <button className="secondary" onClick={copyLink}>Copy link</button>}
            <button className="secondary" onClick={removePin}>Remove pin</button>
          </div>
          {pinIsShared && <div className="nearby-list">
              <h2>Nearby</h2>
              {nearby.map(({ business, distance }) => (
                <button key={business.id} onClick={() => setSelectedBusiness(business)}>
                  <span><strong>{business.name}</strong><small>{business.town}</small></span>
                  <b>{distance < 0.1 ? "< 0.1" : distance.toFixed(1)} miles</b>
                </button>
              ))}
            </div>}
        </section>
      )}
    </main>
  );
}
