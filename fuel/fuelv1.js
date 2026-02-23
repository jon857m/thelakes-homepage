(() => {
  const LS_FUEL = "fuel_last_type_v1";
  const LS_PREF = "fuel_pref_v1"; // we’ll store {lat,lng,zoom,label} later

    // If you're testing locally (file:// or localhost), use the live site API
  const API_ORIGIN =
    (location.protocol === "file:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "https://www.thelakesincumbria.co.uk"
      : "";

  function api(path) {
    return API_ORIGIN + path;
  }

  const statusEl = document.getElementById("fuelStatus");
  const fuelSel = document.getElementById("fuelType");
  const btnMyLocation = document.getElementById("btnMyLocation");
  const btnMyPref = document.getElementById("btnMyPref");
  const regionBtns = Array.from(document.querySelectorAll("[data-region]"));

  // --- Map init (Lake District default view) ---
  const map = L.map("fuelMap", { zoomControl: true }).setView([54.46, -3.10], 9);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function formatPrice(p) {
    // GOV seems to return pence as number, keep simple
    // e.g. 139.9 => "139.9p"
    const n = Number(p);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(n % 1 === 0 ? 0 : 1)}p`;
  }

  function makePriceIcon(price) {
    return L.divIcon({
      className: "",
      html: `<span class="priceBadge">${formatPrice(price)}</span>`,
      iconSize: [1, 1], // size handled by HTML
      iconAnchor: [0, 0]
    });
  }

  function clearMarkers() {
    markersLayer.clearLayers();
  }

  function addStations(stations) {
    clearMarkers();

    for (const s of stations || []) {
      const m = L.marker([s.lat, s.lng], { icon: makePriceIcon(s.price) });

      const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat + "," + s.lng)}`;

      const popupHtml = `
        <div style="font-weight:800; margin-bottom:4px;">${escapeHtml(s.name || "Fuel Station")}</div>
        ${s.brand ? `<div style="opacity:.8; margin-bottom:6px;">${escapeHtml(s.brand)}</div>` : ""}
        <div style="margin-bottom:6px;"><b>${formatPrice(s.price)}</b> • ${Number(s.distanceMiles).toFixed(1)} miles (approx)</div>
        <a href="${gmaps}" target="_blank" rel="noopener">Get directions</a>
      `;

      m.bindPopup(popupHtml);
      m.addTo(markersLayer);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    }[m]));
  }

  // --- Data loading ---
  async function loadLakes() {
    const fuel = fuelSel.value;
    setStatus("Loading Lake District…");

    const r = await fetch(api(`/api/fuel/lakes?fuel=${encodeURIComponent(fuel)}`), { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.message || "Fuel API error");

    addStations(j.stations);
    setStatus(`${j.count} stations • tap a price for details`);
  }

  async function loadRegion(regionKey) {
    const fuel = fuelSel.value;
    setStatus(`Loading ${regionKey}…`);

    const r = await fetch(api(`/api/fuel/region?region=${encodeURIComponent(regionKey)}&fuel=${encodeURIComponent(fuel)}`), { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.message || "Fuel API error");

    // Center map roughly on returned centre if present
    if (j.center?.lat && j.center?.lng) map.setView([j.center.lat, j.center.lng], 10);

    addStations(j.stations);
    setStatus(`${j.count} stations • tap a price for details`);
  }

  async function loadNear(lat, lng, radiusMiles = 15) {
    const fuel = fuelSel.value;
    setStatus("Loading near you…");

    const r = await fetch(api(`/api/fuel/near?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&r=${encodeURIComponent(radiusMiles)}&fuel=${encodeURIComponent(fuel)}`), { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.message || "Fuel API error");

    map.setView([lat, lng], 12);
    addStations(j.stations);
    setStatus(`${j.count} stations within ${radiusMiles} miles • tap a price for details`);
  }

  // --- UI events ---
  regionBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      regionBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const region = btn.getAttribute("data-region");
      try {
        if (region === "lakes") await loadLakes();
        else await loadRegion(region);
      } catch (e) {
        setStatus(`Error: ${e.message || e}`);
      }
    });
  });

  fuelSel.addEventListener("change", async () => {
    localStorage.setItem(LS_FUEL, fuelSel.value);

    // reload whatever is currently active
    const active = regionBtns.find(b => b.classList.contains("active"));
    const region = active?.getAttribute("data-region") || "lakes";

    try {
      if (region === "lakes") await loadLakes();
      else await loadRegion(region);
    } catch (e) {
      setStatus(`Error: ${e.message || e}`);
    }
  });

  btnMyLocation.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation not available on this device/browser.");
      return;
    }

    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      try {
        await loadNear(lat, lng, 15);
      } catch (e) {
        setStatus(`Error: ${e.message || e}`);
      }
    }, () => {
      setStatus("Could not get your location (permission denied?).");
    }, { enableHighAccuracy: true, timeout: 8000 });
  });

  btnMyPref.addEventListener("click", async () => {
    const raw = localStorage.getItem(LS_PREF);
    if (!raw) {
      setStatus("No preference saved yet. (We’ll add Save Preference next.)");
      return;
    }
    try {
      const pref = JSON.parse(raw);
      if (!pref?.lat || !pref?.lng) throw new Error("Bad preference data");
      await loadNear(pref.lat, pref.lng, pref.r || 15);
    } catch (e) {
      setStatus("Preference data invalid. We’ll rebuild this cleanly.");
    }
  });

  // --- Boot ---
  const lastFuel = localStorage.getItem(LS_FUEL);
  if (lastFuel === "E10" || lastFuel === "B7") fuelSel.value = lastFuel;

  // default load
  loadLakes().catch(e => setStatus(`Error: ${e.message || e}`));
})();