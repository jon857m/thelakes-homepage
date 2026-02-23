/* FuelPilot UI v1 (diagnostic + fallback endpoints)
   - Map-first Leaflet + MarkerCluster
   - Host-aware header injection
   - Presets + My Location + Fuel dropdown (remembered)
   - Quintile-colour price flags
   - Bottom sheet / drawer list
   - Sort Price/Distance (remembered)
   - Directions deep links everywhere
   - "Search this area" when map moved
*/

(() => {
  // -----------------------------
  // Config
  // -----------------------------
  const DEFAULT_API_BASE = "https://fuelpilot-api.jonmargree.workers.dev";
  const API_BASE = (window.FP_API_BASE && String(window.FP_API_BASE).trim()) || DEFAULT_API_BASE;

  // LocalStorage keys
  const LS = {
    fuel: "fp_fuel",
    sort: "fp_sort", // "price" | "distance"
    region: "fp_region",
    map: "fp_map" // {lat,lng,zoom}
  };

  const PRESETS = {
    lakes:   { name: "Lakes (wide)",   lat: 54.46, lng: -3.10, zoom: 9 },
    north:   { name: "North Lakes",    lat: 54.62, lng: -3.18, zoom: 11 },
    central: { name: "Central Lakes",  lat: 54.46, lng: -3.10, zoom: 11 },
    south:   { name: "South Lakes",    lat: 54.28, lng: -3.08, zoom: 11 }
  };

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
    modalClose: $("fpModalCloseBtn")
  };

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function readJSONLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeJSONLS(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function readLS(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }

  // -----------------------------
  // Host-aware header injection
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
            try { window[fnName](); } catch {}
            break;
          }
        }
        setStatus("Loaded (Lakes mode)");
        return;
      } catch {
        // try next
      }
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
  let lastOrigin = null;       // {lat,lng} user location if available
  let stations = [];           // current stations list
  let mapDirty = false;

  function initMap() {
    map = L.map("fpMap", { zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

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
      setStatus("Restored last map");
    } else {
      const def = PRESETS.central;
      map.setView([def.lat, def.lng], def.zoom);
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
    });
  }

  function updateSearchAreaButton() {
    if (!els.searchAreaBtn) return;
    if (mapDirty) els.searchAreaBtn.classList.add("is-visible");
    else els.searchAreaBtn.classList.remove("is-visible");
  }
    async function tryFetchJson(url) {
    // If CORS blocks, fetch() will throw before we get a status.
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { res, text, data };
    }
  // -----------------------------
  // API calls (diagnostic + fallbacks)
  // -----------------------------
async function fetchNear({ lat, lng, fuel }) {
  const sortMode = readLS(LS.sort, "price"); // "price" | "distance"
  const limit = 200; // more results for the map/list; adjust later
  const radiusMiles = 12; // decent Lakes coverage when centered

  const qs = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    fuel: String(fuel),
    radiusMiles: String(radiusMiles),
    limit: String(limit),
    sort: sortMode
  });

  const url = `${API_BASE.replace(/\/+$/, "")}/api/fuel/near?${qs.toString()}`;

  setStatus(`Fetching… ${shortUrl(url)}`);

  try {
    const { res, data, text } = await tryFetchJson(url);

    if (!res.ok) {
      const msg = data?.message || `HTTP ${res.status}`;
      throw new Error(`${msg} via ${shortUrl(url)}`);
    }

    if (!data) {
      throw new Error(`Non-JSON response via ${shortUrl(url)} (starts: ${text.slice(0, 60)})`);
    }

    if (data.ok === false) {
      throw new Error(`${data.message || "API returned ok:false"} via ${shortUrl(url)}`);
    }

    return data;
  } catch (err) {
    // If you’re testing locally, this is where CORS would show up.
    throw new Error(`Fetch failed via ${shortUrl(url)} — ${err.message || "Network/CORS"}`);
  }
}

  function shortUrl(u) {
    try {
      const url = new URL(u, window.location.origin);
      // keep it readable
      return url.origin === window.location.origin
        ? url.pathname + url.search
        : url.origin + url.pathname;
    } catch {
      return String(u);
    }
  }

  // -----------------------------
  // Quintiles + marker rendering
  // -----------------------------
  function getNumericPrice(st) {
    const candidates = [st.price, st.price_pence, st.fuelPrice, st.pricePence];
    for (const c of candidates) {
      if (typeof c === "number" && isFinite(c)) return c;
      if (typeof c === "string") {
        const n = Number(c);
        if (isFinite(n)) return n;
      }
    }
    if (st.prices && typeof st.prices === "object") {
      for (const k of Object.keys(st.prices)) {
        const n = Number(st.prices[k]);
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

    if (prices.length < 5) return { cuts: null };

    const q = (pct) => {
      const idx = Math.floor((prices.length - 1) * pct);
      return prices[idx];
    };

    return { cuts: [q(0.2), q(0.4), q(0.6), q(0.8)] };
  }

  function quintileClass(priceNum, cuts) {
    if (!cuts || !Array.isArray(cuts)) return "fp-q2";
    const [c1, c2, c3, c4] = cuts;
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
    const lat = Number(st.lat ?? st.latitude);
    const lng = Number(st.lng ?? st.lon ?? st.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;

    const priceNum = st._priceNum;
    const qClass = quintileClass(priceNum, cuts);
    const priceText = formatPrice(priceNum);

    const html = `<div class="fp-flag ${qClass}" data-mid="${escapeHtml(st._id)}">${escapeHtml(priceText)}</div>`;

    const icon = L.divIcon({
      html,
      className: "",
      iconSize: [1, 1]
    });

    const m = L.marker([lat, lng], { icon });
    m.on("click", () => selectStation(st._id, { openDrawer: true, pan: true }));
    return m;
  }

  // -----------------------------
  // Selection + drawer/card rendering
  // -----------------------------
  function openDrawer() { els.drawer?.classList.add("is-open"); }
  function closeDrawer() { els.drawer?.classList.remove("is-open"); }

  function setActiveFlag(mid) {
    const prev = document.querySelector(".fp-flag.is-active");
    if (prev) prev.classList.remove("is-active");
    if (!mid) return;
    const next = document.querySelector(`.fp-flag[data-mid="${cssEscape(mid)}"]`);
    if (next) next.classList.add("is-active");
  }

  function stationDirectionsUrl(st) {
    const lat = Number(st.lat ?? st.latitude);
    const lng = Number(st.lng ?? st.lon ?? st.longitude);
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
      for (const k of keys) if (a[k]) parts.push(String(a[k]));
    }

    if (st.town) parts.push(st.town);
    if (st.postcode) parts.push(st.postcode);

    const out = parts.map((x) => String(x).trim()).filter(Boolean).join(", ");
    return out || "Address unavailable";
  }

  function stationBadges(st) {
    const arr = st.amenities || st.services || st.facilities || [];
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 6);
  }

  function distanceMilesFromOrigin(st) {
    const lat = Number(st.lat ?? st.latitude);
    const lng = Number(st.lng ?? st.lon ?? st.longitude);
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
    const priceText = formatPrice(st._priceNum);
    const name = stationName(st);
    const addr = stationAddress(st);
    const badges = stationBadges(st);
    const dir = stationDirectionsUrl(st);

    const lastUpdated =
      st.updatedAt || st.lastUpdated || st.last_update || st.timestamp || null;

    els.selectedCard.hidden = false;
    els.selectedCard.innerHTML = `
      <div class="fp-card">
        <div class="fp-card__price">${escapeHtml(priceText)}</div>
        <div class="fp-card__name">${escapeHtml(name)}</div>
        <div class="fp-card__addr">${escapeHtml(addr)}</div>

        ${badges.length ? `
          <div class="fp-badges">
            ${badges.map(b => `<span class="fp-badge">${escapeHtml(b)}</span>`).join("")}
          </div>
        ` : ""}

        <div class="fp-card__cta">
          <a class="fp-link-btn" href="${dir}" target="_blank" rel="noopener">
            Directions ↗
          </a>
          <span class="fp-mini">${escapeHtml(distanceLabel(st))}</span>
        </div>

        ${lastUpdated ? `<div class="fp-card__trust">Updated: ${escapeHtml(String(lastUpdated))}</div>` : ""}
      </div>
    `;
  }

  function renderList() {
    const sortMode = readLS(LS.sort, "price");
    const fuel = readLS(LS.fuel, "E10");

    const sorted = [...stations];
    if (sortMode === "distance") {
      sorted.sort((a, b) => (distanceMilesFromOrigin(a) ?? 1e9) - (distanceMilesFromOrigin(b) ?? 1e9));
    } else {
      sorted.sort((a, b) => (a._priceNum ?? 1e9) - (b._priceNum ?? 1e9));
    }

    els.list.innerHTML = sorted.map((st) => {
      const name = stationName(st);
      const addr = stationAddress(st);
      const p = formatPrice(st._priceNum);
      const dir = stationDirectionsUrl(st);
      const dist = distanceLabel(st);

      return `
        <div class="fp-row" role="listitem" data-id="${escapeHtml(st._id)}">
          <div class="fp-row__left">
            <div class="fp-row__price">${escapeHtml(p)} <span class="fp-mini" style="opacity:.75">(${escapeHtml(fuel)})</span></div>
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

    els.list.querySelectorAll(".fp-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        const link = e.target.closest("a");
        if (link) return;

        const id = row.getAttribute("data-id");
        if (id) selectStation(id, { openDrawer: true, pan: true });
      });
    });
  }

  function selectStation(id, opts = {}) {
    const st = stations.find((s) => s._id === id);
    if (!st) return;

    activeMarkerId = id;
    setActiveFlag(id);
    renderSelectedCard(st);

    if (opts.openDrawer) openDrawer();

    if (opts.pan) {
      const lat = Number(st.lat ?? st.latitude);
      const lng = Number(st.lng ?? st.lon ?? st.longitude);
      if (isFinite(lat) && isFinite(lng)) {
        map.panTo([lat, lng], { animate: true, duration: 0.35 });
      }
    }
  }

  // -----------------------------
  // Search + render pipeline
  // -----------------------------
  async function runSearchAtCenter(center, reason = "search") {
    const fuel = els.fuelSelect.value || readLS(LS.fuel, "E10");
    writeLS(LS.fuel, fuel);

    setStatus("Searching…");

    try {
      const data = await fetchNear({ lat: center.lat, lng: center.lng, fuel });

      const list = Array.isArray(data.stations) ? data.stations : (Array.isArray(data.results) ? data.results : []);
      stations = list.map((st, idx) => {
        const priceNum = getNumericPrice(st);
        return {
          ...st,
          _id: String(st.id ?? st.stationId ?? st.siteId ?? idx),
          _priceNum: priceNum
        };
      });

      const withPrices = stations.filter((s) => s._priceNum != null);
      const { cuts } = computeQuintiles(withPrices);

      clearMarkers();

      let markerCount = 0;
      for (const st of stations) {
        const m = buildMarker(st, cuts);
        if (m) {
          cluster.addLayer(m);
          markerCount++;
        }
      }

      lastSearchCenter = { lat: center.lat, lng: center.lng };
      mapDirty = false;
      updateSearchAreaButton();

      els.countLine.textContent = `${stations.length} results • ${markerCount} mapped`;
      setStatus(`Showing ${stations.length} stations`);

      renderList();
      openDrawer();

      const sortMode = readLS(LS.sort, "price");
      if (stations.length) {
        let pick = stations[0];
        if (sortMode === "price") {
          pick = [...stations].sort((a, b) => (a._priceNum ?? 1e9) - (b._priceNum ?? 1e9))[0];
        } else {
          pick = [...stations].sort((a, b) => (distanceMilesFromOrigin(a) ?? 1e9) - (distanceMilesFromOrigin(b) ?? 1e9))[0];
        }
        if (pick?._id) selectStation(pick._id, { openDrawer: false, pan: false });
      }
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message || "Search failed"}`);
      els.countLine.textContent = `0 results`;
      els.list.innerHTML = "";
      els.selectedCard.hidden = true;
    }
  }

  // -----------------------------
  // Sorting + persistence
  // -----------------------------
  function refreshSortLabel() {
    const sortMode = readLS(LS.sort, "price");
    els.sortLabel.textContent = sortMode === "distance" ? "Distance" : "Price";
  }

  function toggleSort() {
    const current = readLS(LS.sort, "price");
    const next = current === "price" ? "distance" : "price";
    writeLS(LS.sort, next);
    refreshSortLabel();
    renderList();
  }

  // -----------------------------
  // Regions + My Location
  // -----------------------------
  function applyPreset(key) {
    if (key === "restore") {
      const savedMap = readJSONLS(LS.map, null);
      if (savedMap && isFinite(savedMap.lat) && isFinite(savedMap.lng) && isFinite(savedMap.zoom)) {
        map.setView([savedMap.lat, savedMap.lng], savedMap.zoom);
        setStatus("Restored last view");
        return;
      }
      key = "central";
    }

    const p = PRESETS[key] || PRESETS.central;
    writeLS(LS.region, key);
    map.setView([p.lat, p.lng], p.zoom, { animate: true, duration: 0.35 });
    setStatus(`Region: ${p.name}`);
    mapDirty = true;
    updateSearchAreaButton();
  }

  async function useMyLocation() {
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
  function openModal() { els.modal.hidden = false; }
  function closeModal() { els.modal.hidden = true; }

  // -----------------------------
  // Drawer interactions
  // -----------------------------
  function initDrawerInteractions() {
    els.drawerHandle?.addEventListener("click", () => {
      els.drawer.classList.toggle("is-open");
    });
    els.closeDrawerBtn?.addEventListener("click", () => closeDrawer());
  }

  // -----------------------------
  // Main init
  // -----------------------------
  async function init() {
    await injectLakesHeaderIfNeeded();

    const savedFuel = readLS(LS.fuel, "E10");
    els.fuelSelect.value = savedFuel;

    const savedSort = readLS(LS.sort, "price");
    writeLS(LS.sort, savedSort);
    refreshSortLabel();

    const savedRegion = readLS(LS.region, "central");
    if (els.regionSelect) {
      if (savedRegion && (savedRegion in PRESETS)) els.regionSelect.value = savedRegion;
      else els.regionSelect.value = "central";
    }

    initMap();
    initDrawerInteractions();

    els.regionSelect?.addEventListener("change", (e) => applyPreset(e.target.value));
    els.fuelSelect?.addEventListener("change", () => {
      writeLS(LS.fuel, els.fuelSelect.value);
      setStatus(`Fuel: ${els.fuelSelect.value}`);
      mapDirty = true;
      updateSearchAreaButton();
    });
    els.myLocBtn?.addEventListener("click", useMyLocation);
    els.refreshBtn?.addEventListener("click", () => {
      const c = map.getCenter();
      runSearchAtCenter({ lat: c.lat, lng: c.lng }, "search");
    });
    els.searchAreaBtn?.addEventListener("click", () => {
      const c = map.getCenter();
      runSearchAtCenter({ lat: c.lat, lng: c.lng }, "search-area");
    });
    els.sortBtn?.addEventListener("click", toggleSort);

    els.helpBtn?.addEventListener("click", openModal);
    els.modalBackdrop?.addEventListener("click", closeModal);
    els.modalClose?.addEventListener("click", closeModal);

    // First load search
    const c = map.getCenter();
    lastSearchCenter = { lat: c.lat, lng: c.lng };
    mapDirty = false;
    updateSearchAreaButton();

    setStatus(`Ready • API: ${shortUrl(API_BASE)}`);
    await runSearchAtCenter({ lat: c.lat, lng: c.lng }, "initial");
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