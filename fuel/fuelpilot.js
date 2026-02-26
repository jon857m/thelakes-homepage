/* FuelPilot UI v1.2 (baseline + includeMissing)
   - Map-first Leaflet + MarkerCluster
   - Presets + My Location + Fuel dropdown (remembered)
   - Quintile-colour price flags (unchanged)
   - Missing stations supported via includeMissing=1
   - Prices only toggle (persisted)
*/

(() => {
  // -----------------------------
  // Config
  // -----------------------------
  const DEFAULT_API_BASE = "https://fuelpilot-api.jonmargree.workers.dev";
  const API_BASE = (window.FP_API_BASE && String(window.FP_API_BASE).trim()) || DEFAULT_API_BASE;

  const LS = {
    fuel: "fp_fuel",
    sort: "fp_sort",           // "price" | "distance"
    region: "fp_region",
    map: "fp_map",             // {lat,lng,zoom}
    pricesOnly: "fp_prices_only" // "1" (prices only) | "0" (include no-price)
  };

  const PRESETS = {
    lakes:   { name: "Lakes (wide)",   lat: 54.55, lng: -3.15, zoom: 10, radiusMiles: 28, limit: 250 },
    north:   { name: "North Lakes",    lat: 54.70, lng: -3.00, zoom: 11, radiusMiles: 16, limit: 200 },
    central: { name: "Central Lakes",  lat: 54.55, lng: -3.15, zoom: 11, radiusMiles: 16, limit: 200 },
    south:   { name: "South Lakes",    lat: 54.25, lng: -2.95, zoom: 11, radiusMiles: 16, limit: 200 }
  };

  function isInView(st) {
    if (!map) return false;

    const lat = Number(st.lat != null ? st.lat : st.latitude);
    const lng = Number(st.lng != null ? st.lng : (st.lon != null ? st.lon : st.longitude));

    if (!isFinite(lat) || !isFinite(lng)) return false;

    return map.getBounds().contains([lat, lng]);
  }

function recolorForViewport() {
  if (!stations || !stations.length || !map || !cluster) return;

  const withPrices = stations.filter((s) => s._priceNum != null && isFinite(s._priceNum));
  if (!withPrices.length) return;

  const inViewWithPrices = withPrices.filter(isInView);   

  const cutsGlobal = computeQuintiles(withPrices).cuts;
  const cutsView = computeQuintiles(inViewWithPrices).cuts;

  // Use viewport cuts if we have enough priced stations visible, otherwise fall back
  const cuts = (inViewWithPrices.length >= 10 && cutsView) ? cutsView : cutsGlobal;

  window.__FP_CUTS = cuts;

  // Rebuild markers + list (NO refetch)
  clearMarkers();
  for (let i = 0; i < stations.length; i++) {
    const m = buildMarker(stations[i], cuts);
    if (m) cluster.addLayer(m);
  }

  renderList();

  if (activeMarkerId) setActiveFlag(activeMarkerId);
}

function invalidateMapSoon() {
  if (!map) return;
  // next frame + a short delay catches layout settling on iOS/Safari
  requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  setTimeout(() => map.invalidateSize({ pan: false }), 200);
}

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  const els = {
    status: $("fpStatus"),
    regionSelect: $("fpRegionSelect"),
    fuelSelect: $("fpFuelSelect"),
    myLocBtn: $("fpMyLocationBtn"),
    refreshBtn: $("fpRefreshBtn"),
    sortBtn: $("fpSortBtn"),
    sortLabel: $("fpSortLabel"),
    pricesOnlyBtn: $("fpPricesOnlyBtn"),
    searchAreaBtn: $("fpSearchAreaBtn"),
    drawer: $("fpDrawer"),
    drawerHandle: $("fpDrawerHandle"),
    closeDrawerBtn: $("fpCloseDrawerBtn"),
    countLine: $("fpCountLine"),
    list: $("fpList"),
    selectedCard: $("fpSelectedCard"),
    helpBtn: $("fpHelpBtn"),
    modal: $("fpModal"),
    modalBackdrop: $("fpModalBackdrop"),
    modalClose: $("fpModalCloseBtn"),
    legendBtn: $("fpLegendBtn"),
    legend: $("fpLegend"),
  };

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function readJSONLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSONLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function readLS(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  // -----------------------------
  // Prices-only toggle (persisted)
  // -----------------------------
  function getPricesOnly() {
    // default ON
    return readLS(LS.pricesOnly, "0") !== "0";
  }

  function setPricesOnly(v) {
    writeLS(LS.pricesOnly, v ? "1" : "0");
    refreshPricesOnlyLabel();
  }

  function refreshPricesOnlyLabel() {
    if (!els.pricesOnlyBtn) return;
    els.pricesOnlyBtn.textContent = getPricesOnly() ? "Prices only" : "Include no-price";
  }

  // -----------------------------
  // Host-aware header injection (kept)
  // -----------------------------
  async function injectLakesHeaderIfNeeded() {
    const host = window.location.hostname || "";
    const isLakesSite = host.includes("thelakesincumbria.co.uk");
    if (!isLakesSite) return;

    const candidates = ["/assets/js/app.js", "/js/app.js", "/app.js"];

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve(src);
        s.onerror = () => reject(new Error("Failed " + src));
        document.head.appendChild(s);
      });

    for (const src of candidates) {
      try {
        await loadScript(src);
        const maybeFns = ["initHeader", "injectHeader", "loadHeader", "initSiteChrome"];
        for (const fnName of maybeFns) {
          if (typeof window[fnName] === "function") {
            try { window[fnName](); } catch (e) {}
            break;
          }
        }
        setStatus("Loaded (Lakes mode)");
        return;
      } catch (e) {}
    }

    setStatus("Loaded (Lakes mode — header script not found)");
  }

  // -----------------------------
  // Map setup
  // -----------------------------
  let map;
  let cluster;
  let activeMarkerId = null;

  let lastSearchCenter = null; // {lat,lng}
  let lastOrigin = null;       // {lat,lng}
  let stations = [];
  let mapDirty = false;

  function initMap() {
    map = L.map("fpMap", { zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    invalidateMapSoon();

    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 15,
      maxClusterRadius: 45
    });

    map.addLayer(cluster);

    const savedMap = readJSONLS(LS.map, null);
    if (savedMap && isFinite(savedMap.lat) && isFinite(savedMap.lng) && isFinite(savedMap.zoom)) {
      map.setView([savedMap.lat, savedMap.lng], savedMap.zoom);
      invalidateMapSoon();
      setStatus("Restored last map");
    } else {
      const def = PRESETS.central;
      map.setView([def.lat, def.lng], def.zoom);
      invalidateMapSoon();
    }

    map.on("dragend zoomend", () => {
      const c = map.getCenter();
      const newCenter = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) };
      writeJSONLS(LS.map, { ...newCenter, zoom: map.getZoom() });

      if (!lastSearchCenter) {
        mapDirty = true;
      } else {
        const d = haversineMiles(lastSearchCenter, newCenter);
        if (d > 0.4) mapDirty = true;
      }

      updateSearchAreaButton();

      // ✅ Re-colour markers/list based on what's currently visible
      recolorForViewport();
    });
  }

  function updateSearchAreaButton() {
    if (!els.searchAreaBtn) return;
    const shouldShow = mapDirty || (Array.isArray(stations) && stations.length === 0);
    if (shouldShow) els.searchAreaBtn.classList.add("is-visible");
    else els.searchAreaBtn.classList.remove("is-visible");
  }

  // -----------------------------
  // API calls
  // -----------------------------
  async function tryFetchJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { res, text, data };
  }

  function apiUrl(path, paramsObj) {
    const qs = new URLSearchParams(paramsObj);
    return `${API_BASE.replace(/\/+$/, "")}${path}?${qs.toString()}`;
  }

  function shortUrl(u) {
    try {
      const url = new URL(u, window.location.origin);
      return url.origin === window.location.origin
        ? url.pathname + url.search
        : url.origin + url.pathname;
    } catch (e) {
      return String(u);
    }
  }

  async function fetchNear({ lat, lng, fuel, radiusMiles, limit }) {
    const sortMode = readLS(LS.sort, "price");
    const includeMissing = getPricesOnly() ? "0" : "1";

    const url = apiUrl("/api/fuel/near", {
      lat: String(lat),
      lng: String(lng),
      fuel: String(fuel),
      radiusMiles: String(radiusMiles),
      limit: String(limit),
      sort: String(sortMode),
      includeMissing
    });

    setStatus(`Fetching… ${shortUrl(url)}`);

    const { res, data, text } = await tryFetchJson(url);

    if (!res.ok) {
      const msg = data && data.message ? data.message : `HTTP ${res.status}`;
      throw new Error(`${msg} via ${shortUrl(url)}`);
    }
    if (!data) throw new Error(`Non-JSON response via ${shortUrl(url)} (starts: ${text.slice(0, 60)})`);
    if (data.ok === false) throw new Error(`${data.message || "API returned ok:false"} via ${shortUrl(url)}`);

    return data;
  }

  async function fetchNearBox({ bounds, fuel, limit }) {
    const sortMode = readLS(LS.sort, "price");
    const includeMissing = getPricesOnly() ? "0" : "1";

    const url = apiUrl("/api/fuel/near-box", {
      minLat: String(bounds.getSouthWest().lat),
      minLng: String(bounds.getSouthWest().lng),
      maxLat: String(bounds.getNorthEast().lat),
      maxLng: String(bounds.getNorthEast().lng),
      fuel: String(fuel),
      limit: String(limit),
      sort: String(sortMode),
      includeMissing
    });

    setStatus(`Searching area… ${shortUrl(url)}`);

    const { res, data, text } = await tryFetchJson(url);

    if (!res.ok) {
      const msg = data && data.message ? data.message : `HTTP ${res.status}`;
      throw new Error(`${msg} via ${shortUrl(url)}`);
    }
    if (!data) throw new Error(`Non-JSON response via ${shortUrl(url)} (starts: ${text.slice(0, 60)})`);
    if (data.ok === false) throw new Error(`${data.message || "API returned ok:false"} via ${shortUrl(url)}`);

    return data;
  }

  // -----------------------------
  // Quintiles + marker rendering
  // -----------------------------
  function getNumericPrice(st) {
    // Worker cards use st.price (number or null)
    if (typeof st.price === "number" && isFinite(st.price)) return st.price;

    const candidates = [st.price_pence, st.fuelPrice, st.pricePence];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (typeof c === "number" && isFinite(c)) return c;
      if (typeof c === "string") {
        const n = Number(c);
        if (isFinite(n)) return n;
      }
    }
    if (st.prices && typeof st.prices === "object") {
      const keys = Object.keys(st.prices);
      for (let i = 0; i < keys.length; i++) {
        const n = Number(st.prices[keys[i]]);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }

  function formatPrice(p) {
    if (p == null) return "—";
    const n = Number(p);
    if (!isFinite(n)) return "—";
    if (n > 300) return (n / 10).toFixed(1) + "p";
    return n.toFixed(1) + "p";
  }

function computeQuintiles(stationsWithPrices) {
  const prices = stationsWithPrices
    .map((s) => s._priceNum)
    .filter((v) => typeof v === "number" && isFinite(v))
    .sort((a, b) => a - b);

  // If we have 0–1 prices, quintiles are meaningless
  if (prices.length < 2) return { cuts: null };

  // Works even for 2–4 prices (indexes just collapse naturally)
  const q = (pct) => {
    const idx = Math.floor((prices.length - 1) * pct);
    return prices[idx];
  };

  return { cuts: [q(0.2), q(0.4), q(0.6), q(0.8)] };
}

  function quintileClass(priceNum, cuts) {
    if (!cuts || !Array.isArray(cuts)) return "fp-q2";
    const c1 = cuts[0], c2 = cuts[1], c3 = cuts[2], c4 = cuts[3];
    if (priceNum <= c1) return "fp-q0";
    if (priceNum <= c2) return "fp-q1";
    if (priceNum <= c3) return "fp-q2";
    if (priceNum <= c4) return "fp-q3";
    return "fp-q4";
  }

  function clearMarkers() {
    cluster.clearLayers();
    activeMarkerId = null;
  }

  function buildMarker(st, cuts) {
    const lat = Number(st.lat != null ? st.lat : st.latitude);
    const lng = Number(st.lng != null ? st.lng : (st.lon != null ? st.lon : st.longitude));
    if (!isFinite(lat) || !isFinite(lng)) return null;

    const priceNum = st._priceNum;

    // ✅ Missing / no-price path
    if (priceNum == null || !isFinite(priceNum)) {
    const html = `
        <div class="fp-flag fp-flag--missing" data-mid="${escapeHtml(st._id)}">—</div>
    `;
    const icon = L.divIcon({ html, className: "", iconSize: [1, 1] });
    const m = L.marker([lat, lng], { icon });
    m.on("click", () => selectStation(st._id, { openDrawer: true, pan: true }));
    return m;
}

    // ✅ Existing priced marker path (unchanged)
    const qClass = quintileClass(priceNum, cuts);
    const priceText = formatPrice(priceNum);
    const html = `<div class="fp-flag ${qClass}" data-mid="${escapeHtml(st._id)}">${escapeHtml(priceText)}</div>`;
    const icon = L.divIcon({ html, className: "", iconSize: [1, 1] });

    const m = L.marker([lat, lng], { icon });
    m.on("click", () => selectStation(st._id, { openDrawer: true, pan: true }));
    return m;
  }

  // -----------------------------
  // Selection + drawer/card rendering
  // -----------------------------
  function openDrawer() { if (els.drawer) els.drawer.classList.add("is-open"); }
  function closeDrawer() { if (els.drawer) els.drawer.classList.remove("is-open"); }

  function setActiveFlag(mid) {
    const prev = document.querySelector(".fp-flag.is-active");
    if (prev) prev.classList.remove("is-active");
    if (!mid) return;
    const next = document.querySelector(`.fp-flag[data-mid="${cssEscape(mid)}"]`);
    if (next) next.classList.add("is-active");
  }

  function stationDirectionsUrl(st) {
    const lat = Number(st.lat != null ? st.lat : st.latitude);
    const lng = Number(st.lng != null ? st.lng : (st.lon != null ? st.lon : st.longitude));
    const q = `${lat},${lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`;
  }

  function stationName(st) {
    return st.name || st.tradingName || st.brand || st.siteName || "Station";
  }

  function stationAddress(st) {
    const parts = [];
    const a = st.address || st.addr || null;

    if (typeof a === "string" && a.trim()) parts.push(a.trim());
    if (a && typeof a === "object") {
      const keys = ["line1", "line2", "town", "city", "postcode"];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (a[k]) parts.push(String(a[k]));
      }
    }

    // Worker cards provide addressShort
    if (st.addressShort) parts.push(String(st.addressShort));

    if (st.town) parts.push(st.town);
    if (st.postcode) parts.push(st.postcode);

    const out = parts.map((x) => String(x).trim()).filter(Boolean).join(", ");
    return out || "Address unavailable";
  }

  function stationBadges(st) {
    const arr = st.badges || st.amenities || st.services || st.facilities || [];
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  }

  function distanceMilesFromOrigin(st) {
    const lat = Number(st.lat != null ? st.lat : st.latitude);
    const lng = Number(st.lng != null ? st.lng : (st.lon != null ? st.lon : st.longitude));
    if (!isFinite(lat) || !isFinite(lng)) return null;

    const origin = lastOrigin || lastSearchCenter;
    if (!origin) return null;

    return haversineMiles(origin, { lat, lng });
  }

  function distanceLabel(st) {
    const d = distanceMilesFromOrigin(st);
    if (d == null) return "";
    if (d < 0.1) return "Very close";
    return `${d.toFixed(1)} mi`;
  }

  function renderSelectedCard(st) {
    const hasPrice = st._priceNum != null && isFinite(st._priceNum);

        // ✅ Give selected card the same accent class as list rows
    const cuts = window.__FP_CUTS || null;
    const selClass = hasPrice ? quintileClass(st._priceNum, cuts) : "fp-missing";
    const priceText = hasPrice ? formatPrice(st._priceNum) : "No Price";
    const name = stationName(st);
    const addr = stationAddress(st);
    const badges = stationBadges(st);
    const dir = stationDirectionsUrl(st);

    const lastUpdated = st.updatedAt || st.lastUpdated || st.last_update || st.timestamp || null;

    els.selectedCard.hidden = false;
    els.selectedCard.innerHTML = `
      <div class="fp-card fp-sel ${selClass}">
        <div class="fp-card__price">${escapeHtml(priceText)}</div>
        <div class="fp-card__name">${escapeHtml(name)}</div>
        <div class="fp-card__addr">${escapeHtml(addr)}</div>

        ${!hasPrice ? `<div class="fp-card__trust">No recent price reported for this station.</div>` : ""}

        ${badges.length ? `
          <div class="fp-badges">
            ${badges.map((b) => `<span class="fp-badge">${escapeHtml(b)}</span>`).join("")}
          </div>
        ` : ""}

        <div class="fp-card__cta">
          <a class="fp-link-btn" href="${dir}" target="_blank" rel="noopener">
            Directions ↗
          </a>
          <span class="fp-mini">${escapeHtml(distanceLabel(st))}</span>
        </div>

        ${hasPrice && lastUpdated ? `<div class="fp-card__trust">Updated: ${escapeHtml(String(lastUpdated))}</div>` : ""}
      </div>
    `;
  }

function renderList() {
  const sortMode = readLS(LS.sort, "price");
  const fuel = readLS(LS.fuel, "E10");

  // Quintile cut points from the latest search (set in applyResults)
  const cuts = window.__FP_CUTS || null;

  const sorted = stations.slice();
  if (sortMode === "distance") {
    sorted.sort((a, b) => (distanceMilesFromOrigin(a) || 1e9) - (distanceMilesFromOrigin(b) || 1e9));
  } else {
    sorted.sort((a, b) => ((a._priceNum == null ? 1e9 : a._priceNum) - (b._priceNum == null ? 1e9 : b._priceNum)));
  }

  els.list.innerHTML = sorted.map((st) => {
    const name = stationName(st);
    const addr = stationAddress(st);
    const hasPrice = st._priceNum != null && isFinite(st._priceNum);

    const p = hasPrice ? formatPrice(st._priceNum) : "No price";
    const fuelLabel = hasPrice ? `(${fuel})` : "";

    const dir = stationDirectionsUrl(st);
    const dist = distanceLabel(st);

    // ✅ Visual link class for list accent bar:
    // priced = fp-q0..fp-q4, missing = fp-missing
    const rowClass = hasPrice ? quintileClass(st._priceNum, cuts) : "fp-missing";

    return `
      <div class="fp-row ${rowClass}" role="listitem" data-id="${escapeHtml(st._id)}">
        <div class="fp-row__left">
          <div class="fp-row__price">
            ${escapeHtml(p)}
            ${fuelLabel ? `<span class="fp-mini" style="opacity:.75">${escapeHtml(fuelLabel)}</span>` : ""}
          </div>
          <div class="fp-row__meta">${escapeHtml(name)} — ${escapeHtml(addr)}</div>
        </div>
        <div class="fp-row__right">
          <span class="fp-mini">${escapeHtml(dist)}</span>
          <a class="fp-link-btn" href="${dir}" target="_blank" rel="noopener" aria-label="Directions">
            ↗
          </a>
        </div>
      </div>
    `;
  }).join("");

  const rows = els.list.querySelectorAll(".fp-row");
  for (let i = 0; i < rows.length; i++) {
    rows[i].addEventListener("click", (e) => {
      const link = e.target.closest("a");
      if (link) return;
      const id = rows[i].getAttribute("data-id");
      if (id) selectStation(id, { openDrawer: true, pan: true });
    });
  }
}

  function selectStation(id, opts) {
    const st = stations.find((s) => s._id === id);
    if (!st) return;

    activeMarkerId = id;
    setActiveFlag(id);
    renderSelectedCard(st);

    const shouldOpen = !opts || opts.openDrawer !== false;
    if (shouldOpen) openDrawer();

    if (opts && opts.pan) {
      const lat = Number(st.lat != null ? st.lat : st.latitude);
      const lng = Number(st.lng != null ? st.lng : (st.lon != null ? st.lon : st.longitude));
      if (isFinite(lat) && isFinite(lng)) {
        map.panTo([lat, lng], { animate: true, duration: 0.35 });
      }
    }
  }

  // -----------------------------
  // Search + render pipeline
  // -----------------------------
  function normalizeStations(data) {
    const list = Array.isArray(data.stations) ? data.stations : (Array.isArray(data.results) ? data.results : []);
    return list.map((st, idx) => {
      const priceNum = getNumericPrice(st);
      return {
        ...st,
        _id: String(st.id != null ? st.id : (st.stationId != null ? st.stationId : (st.siteId != null ? st.siteId : idx))),
        _priceNum: priceNum
      };
    });
  }

  async function applyResults(data) {
  stations = normalizeStations(data);

  const withPrices = stations.filter((s) => s._priceNum != null && isFinite(s._priceNum));
  const cutsGlobal = computeQuintiles(withPrices).cuts;

  // Viewport cuts (only after map exists)
  let cuts = cutsGlobal;
  if (map && withPrices.length) {
    const inViewWithPrices = withPrices.filter(isInView);
    const cutsView = computeQuintiles(inViewWithPrices).cuts;
    if (inViewWithPrices.length >= 10 && cutsView) cuts = cutsView;
  }

  window.__FP_CUTS = cuts;

  clearMarkers();

  let markerCount = 0;
  for (let i = 0; i < stations.length; i++) {
    const m = buildMarker(stations[i], cuts);
    if (m) {
      cluster.addLayer(m);
      markerCount++;
    }
  }

  const c = map.getCenter();
  lastSearchCenter = { lat: c.lat, lng: c.lng };

  mapDirty = false;
  updateSearchAreaButton();

  const pricedCount = withPrices.length;
  const missingCount = stations.length - pricedCount;
  if (els.countLine) {
    els.countLine.textContent = `${stations.length} shown • ${pricedCount} priced • ${missingCount} no-price`;
  }

  setStatus(`Showing ${stations.length} stations (${getPricesOnly() ? "priced only" : "incl. no-price"})`);

  renderList();


  // Auto-pick first station (prefer priced)
  if (stations.length) {
    const pick = stations.find(s => s._priceNum != null) || stations[0];
    if (pick && pick._id) selectStation(pick._id, { openDrawer: false, pan: false });
  } else {
    if (els.selectedCard) els.selectedCard.hidden = true;
    mapDirty = true;
    updateSearchAreaButton();
  }

  // ✅ Final pass: make sure colours match the visible view right now
  recolorForViewport();
}

  async function runSearchPresetOrRefresh(center, presetConfig) {
    const fuel = els.fuelSelect.value || readLS(LS.fuel, "E10");
    writeLS(LS.fuel, fuel);

    setStatus("Searching…");

    const radiusMiles = presetConfig && presetConfig.radiusMiles ? presetConfig.radiusMiles : 16;
    const limit = presetConfig && presetConfig.limit ? presetConfig.limit : 200;

    const data = await fetchNear({ lat: center.lat, lng: center.lng, fuel, radiusMiles, limit });
    await applyResults(data);
  }

  async function runSearchAreaViewport() {
    const fuel = els.fuelSelect.value || readLS(LS.fuel, "E10");
    writeLS(LS.fuel, fuel);

    setStatus("Searching this area…");

    const bounds = map.getBounds();
    const data = await fetchNearBox({ bounds, fuel, limit: 350 });
    await applyResults(data);
  }

  // -----------------------------
  // Sorting + persistence
  // -----------------------------
  function refreshSortLabel() {
    const sortMode = readLS(LS.sort, "price");
    if (els.sortLabel) els.sortLabel.textContent = sortMode === "distance" ? "Distance" : "Price";
  }

  function toggleSort() {
    const current = readLS(LS.sort, "price");
    const next = current === "price" ? "distance" : "price";
    writeLS(LS.sort, next);
    refreshSortLabel();
    renderList();
    if (activeMarkerId) setActiveFlag(activeMarkerId);
  }

  // -----------------------------
  // Regions + My Location
  // -----------------------------
  function applyPreset(key) {
    if (key === "restore") {
      const savedMap = readJSONLS(LS.map, null);
      if (savedMap && isFinite(savedMap.lat) && isFinite(savedMap.lng) && isFinite(savedMap.zoom)) {
        map.setView([savedMap.lat, savedMap.lng], savedMap.zoom);
        invalidateMapSoon();
        setStatus("Restored last view");
        mapDirty = true;
        updateSearchAreaButton();
        return;
      }
      key = "central";
    }

    const p = PRESETS[key] || PRESETS.central;
    writeLS(LS.region, key);
    map.setView([p.lat, p.lng], p.zoom, { animate: true, duration: 0.35 });
    invalidateMapSoon();
    setStatus(`Region: ${p.name}`);
    mapDirty = true;
    updateSearchAreaButton();
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus("Geolocation not available");
      return;
    }

    setStatus("Getting location…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        lastOrigin = { lat, lng };
        map.setView([lat, lng], 12, { animate: true, duration: 0.35 });
        invalidateMapSoon();
        setStatus("My Location set");
        mapDirty = true;
        updateSearchAreaButton();
      },
      () => setStatus("Location permission denied"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  // -----------------------------
  // Modal
  // -----------------------------
  function openModal() { if (els.modal) els.modal.hidden = false; }
  function closeModal() { if (els.modal) els.modal.hidden = true; }

  // -----------------------------
  // Drawer interactions
  // -----------------------------
  function initDrawerInteractions() {
    if (els.drawerHandle) {
      els.drawerHandle.addEventListener("click", () => {
        if (els.drawer) els.drawer.classList.toggle("is-open");
        invalidateMapSoon();
      });
    }
    if (els.closeDrawerBtn) els.closeDrawerBtn.addEventListener("click", () => closeDrawer());
     invalidateMapSoon();
  }

  // -----------------------------
  // Main init
  // -----------------------------
  async function init() {
    await injectLakesHeaderIfNeeded();

    const savedFuel = readLS(LS.fuel, "E10");
    if (els.fuelSelect) els.fuelSelect.value = savedFuel;

    const savedSort = readLS(LS.sort, "price");
    writeLS(LS.sort, savedSort);
    refreshSortLabel();

    // default ON if not present
    if (localStorage.getItem(LS.pricesOnly) == null) writeLS(LS.pricesOnly, "0");
    refreshPricesOnlyLabel();

    const savedRegion = readLS(LS.region, "central");
    if (els.regionSelect) {
      els.regionSelect.value = (savedRegion && PRESETS[savedRegion]) ? savedRegion : "central";
    }

    els.legendBtn?.addEventListener("click", () => {
      if (!els.legend) return;
      els.legend.hidden = !els.legend.hidden;
    });

    document.addEventListener("click", (e) => {
      if (!els.legend || els.legend.hidden) return;
      const insideLegend = e.target.closest("#fpLegend");
      const onBtn = e.target.closest("#fpLegendBtn");
      if (!insideLegend && !onBtn) els.legend.hidden = true;
    });

    initMap();
    initDrawerInteractions();

    if (els.regionSelect) els.regionSelect.addEventListener("change", (e) => applyPreset(e.target.value));

    if (els.fuelSelect) {
      els.fuelSelect.addEventListener("change", () => {
        writeLS(LS.fuel, els.fuelSelect.value);
        setStatus(`Fuel: ${els.fuelSelect.value}`);
        mapDirty = true;
        updateSearchAreaButton();
      });
    }

    if (els.myLocBtn) els.myLocBtn.addEventListener("click", useMyLocation);

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", async () => {
        const c = map.getCenter();
        const regionKey = readLS(LS.region, "central");
        const preset = PRESETS[regionKey] || PRESETS.central;
        try {
          await runSearchPresetOrRefresh({ lat: c.lat, lng: c.lng }, preset);
        } catch (err) {
          console.error(err);
          setStatus(`Error: ${err.message || "Search failed"}`);
        }
      });
    }

    if (els.searchAreaBtn) {
      els.searchAreaBtn.addEventListener("click", async () => {
        try {
          await runSearchAreaViewport();
        } catch (err) {
          console.error(err);
          setStatus(`Error: ${err.message || "Search failed"}`);
        }
      });
    }

    if (els.sortBtn) els.sortBtn.addEventListener("click", toggleSort);

    // ✅ Toggle: Prices only <-> Include no-price, then refetch immediately
    if (els.pricesOnlyBtn) {
      els.pricesOnlyBtn.addEventListener("click", async () => {
        setPricesOnly(!getPricesOnly());

        // Refetch immediately (same behaviour as hitting Refresh)
        const c = map.getCenter();
        const regionKey = readLS(LS.region, "central");
        const preset = PRESETS[regionKey] || PRESETS.central;
        try {
          await runSearchPresetOrRefresh({ lat: c.lat, lng: c.lng }, preset);
        } catch (err) {
          console.error(err);
          setStatus(`Error: ${err.message || "Search failed"}`);
        }
      });
    }

    if (els.helpBtn) els.helpBtn.addEventListener("click", openModal);
    if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", closeModal);
    if (els.modalClose) els.modalClose.addEventListener("click", closeModal);

    // Initial state
    mapDirty = false;
    updateSearchAreaButton();

    setStatus(`Ready • API: ${shortUrl(API_BASE)}`);

    // Initial search
    const regionKey = readLS(LS.region, "central");
    const preset = PRESETS[regionKey] || PRESETS.central;

    const c = map.getCenter();
    try {
      await runSearchPresetOrRefresh({ lat: c.lat, lng: c.lng }, preset);
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message || "Search failed"}`);
      stations = [];
      updateSearchAreaButton();
    }
  }

  // -----------------------------
  // Utilities
  // -----------------------------
  function haversineMiles(a, b) {
    const R = 3958.7613;
    const toRad = (d) => (d * Math.PI) / 180;

    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);

    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);

    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return R * (2 * Math.asin(Math.min(1, Math.sqrt(h))));
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cssEscape(str) {
    return String(str).replaceAll('"', '\\"');
  }

  document.addEventListener("DOMContentLoaded", init);
})();