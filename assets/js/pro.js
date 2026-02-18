// ========================================
// Pro — next 48 hours (Open-Meteo)
// STRUCTURE UPDATE:
// - Choose Location box now matches Forecast page structure
// - setViewing() now matches Forecast behavior (Viewing + optional meta line)
// - Fell-first search using /assets/data/fells.json (name + aliases)
// - Fallback to Open-Meteo Geocoding for non-fell places
// - Shows picked meta (lat/lon/elev) when a fell is selected
// - Blank by default
// ========================================

(function () {
  const LS_PREFS = "ld_conditions_location_v1";

  const statusEl = document.getElementById("proStatus");
  const errEl = document.getElementById("proError");
  const viewingEl = document.getElementById("proViewing");

  const inputEl = document.getElementById("proSearch");
  const clearBtn = document.getElementById("proClearBtn");
  const suggestEl = document.getElementById("proSuggest");

  const presets = {
    north:   { name: "North Lakes",   lat: 54.70, lon: -3.00 },
    central: { name: "Central Lakes", lat: 54.55, lon: -3.15 },
    south:   { name: "South Lakes",   lat: 54.25, lon: -2.95 },
  };

  const presetBtns = document.querySelectorAll(".presetBtn");
  const btnUsePrefs = document.getElementById("proUsePrefs");
  const btnUseDevice = document.getElementById("proUseDevice");
  const wrap = document.getElementById("proWrap");

  if (!inputEl || !suggestEl || !wrap) return;

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  function showErr(msg) {
    if (!errEl) return;
    errEl.style.display = "block";
    errEl.textContent = msg;
  }
  function clearErr() {
    if (!errEl) return;
    errEl.style.display = "none";
    errEl.textContent = "";
  }

  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function hideSuggest() {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
  }

  function ensurePickedMetaEl() {
    // Inject a second line under “Viewing” using existing .formNote style
    let el = document.getElementById("proPickedMeta");
    if (el) return el;

    if (!viewingEl || !viewingEl.parentNode) return null;
    viewingEl.insertAdjacentHTML(
      "afterend",
      `<p class="formNote" id="proPickedMeta" style="margin-top:6px;">&nbsp;</p>`
    );
    return document.getElementById("proPickedMeta");
  }

  // Matches Forecast behavior: Viewing + optional meta line
  function setViewing(loc) {
    if (!viewingEl) return;

    if (!loc) {
      viewingEl.textContent = "Viewing: —";
      const meta = ensurePickedMetaEl();
      if (meta) meta.innerHTML = "&nbsp;";
      return;
    }

    const src = loc.source ? ` (${loc.source})` : "";
    viewingEl.textContent = `Viewing: ${loc.name}${src}`;

    const meta = ensurePickedMetaEl();
    if (!meta) return;

    const lat = Number(loc.lat);
    const lon = Number(loc.lon);
    const elev = (loc.elev_m == null || loc.elev_m === "") ? null : Number(loc.elev_m);

    // Only show detailed meta for fells (and any other loc that has elev)
    if (Number.isFinite(lat) && Number.isFinite(lon) && (loc.source === "Fell" || Number.isFinite(elev))) {
      const elevTxt = Number.isFinite(elev) ? ` • elev ${Math.round(elev)}m` : "";
      meta.textContent = `Lat ${lat.toFixed(4)} • Lon ${lon.toFixed(4)}${elevTxt}`;
    } else {
      meta.innerHTML = "&nbsp;";
    }
  }

  // ----------------------------------------
  // Fallback: enableDragScroll (if missing)
  // ----------------------------------------
  if (typeof window.enableDragScroll !== "function") {
    window.enableDragScroll = function enableDragScroll(container) {
      if (!container) return;

      let isDown = false;
      let startX = 0;
      let scrollLeft = 0;

      container.addEventListener("mousedown", (e) => {
        isDown = true;
        container.classList.add("isDragging");
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
      });

      window.addEventListener("mouseup", () => {
        isDown = false;
        container.classList.remove("isDragging");
      });

      container.addEventListener("mouseleave", () => {
        isDown = false;
        container.classList.remove("isDragging");
      });

      container.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1.2;
        container.scrollLeft = scrollLeft - walk;
      });
    };
  }

  // ----------------------------------------
  // Helpers: wind direction display
  // ----------------------------------------
  function degToCompass(deg) {
    if (deg == null || !Number.isFinite(deg)) return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const i = Math.round(((deg % 360) / 22.5)) % 16;
    return dirs[i];
  }
  function degToArrow(deg) {
    if (deg == null || !Number.isFinite(deg)) return "—";
    const arrows = ["↑","↗","→","↘","↓","↙","←","↖"];
    const i = Math.round(((deg % 360) / 45)) % 8;
    return arrows[i];
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function statMax(arr) {
    const nums = arr.map(Number).filter(n => Number.isFinite(n));
    if (!nums.length) return null;
    return Math.max(...nums);
  }
  function statMin(arr) {
    const nums = arr.map(Number).filter(n => Number.isFinite(n));
    if (!nums.length) return null;
    return Math.min(...nums);
  }
  function statSum(arr) {
    const nums = arr.map(Number).filter(n => Number.isFinite(n));
    if (!nums.length) return 0;
    return nums.reduce((a, b) => a + b, 0);
  }

  // ----------------------------------------
  // Preset buttons (unchanged)
  // ----------------------------------------
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      const p = key ? presets[key] : null;
      if (!p) return;
      setLocation({ name: p.name, lat: p.lat, lon: p.lon, elev_m: null, source: "Preset" });
    });
  });

  // ----------------------------------------
  // Fell data (from /assets/data/fells.json)
  // ----------------------------------------
  let fellsCache = null;
  let fellsLoading = null;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[’'"]/g, "")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ");
  }

  async function loadFells() {
    if (Array.isArray(fellsCache)) return fellsCache;
    if (fellsLoading) return fellsLoading;

    fellsLoading = fetch("/assets/data/fells.json", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data)) return [];
        fellsCache = data.map((f) => {
          const names = [f.name].concat(Array.isArray(f.aliases) ? f.aliases : []);
          return { ...f, _search: norm(names.join(" ")) };
        });
        return fellsCache;
      })
      .catch(() => {
        fellsCache = [];
        return [];
      })
      .finally(() => {
        fellsLoading = null;
      });

    return fellsLoading;
  }

  function matchFells(query, limit = 6) {
    const q = norm(query);
    if (!q || !Array.isArray(fellsCache) || !fellsCache.length) return [];

    const out = [];
    for (const f of fellsCache) {
      if (!f || !f._search) continue;
      const idx = f._search.indexOf(q);
      if (idx === -1) continue;

      const nameIdx = norm(f.name).indexOf(q);
      const score = nameIdx !== -1 ? 0 : 1; // prefer name match
      out.push({ f, score, idx });
    }

    out.sort((a, b) => (a.score - b.score) || (a.idx - b.idx));
    return out.slice(0, limit).map((x) => x.f);
  }

  // ----------------------------------------
  // Geocoding (Open-Meteo)
  // ----------------------------------------
  let debounceTimer = null;
  let activeReq = 0;

  async function geocode(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.results)) ? data.results : [];
  }

  function showSuggestMixed(fells, places) {
    suggestEl.hidden = false;
    suggestEl.innerHTML = "";

    // Fells first (🏔)
    (fells || []).forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");

      const elevTxt =
        (f.elev_m != null && f.elev_m !== "") ? ` • ${Math.round(Number(f.elev_m))}m` : "";

      btn.textContent = `🏔 ${f.name}${elevTxt}`;

      btn.addEventListener("click", () => {
        hideSuggest();
        inputEl.value = f.name;
        setLocation({
          name: f.name,
          lat: Number(f.lat),
          lon: Number(f.lon),
          elev_m: (f.elev_m == null ? null : Number(f.elev_m)),
          source: "Fell"
        });
      });

      suggestEl.appendChild(btn);
    });

    // Then places (📍)
    (places || []).forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");

      const name = r.name || "Unknown";
      const admin = [r.admin1, r.admin2].filter(Boolean).join(", ");
      const country = r.country || "";
      const label = [name, admin, country].filter(Boolean).join(" • ");

      btn.textContent = `📍 ${label}`;

      btn.addEventListener("click", () => {
        hideSuggest();
        inputEl.value = label;
        setLocation({
          name: label,
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          elev_m: null,
          source: "Search"
        });
      });

      suggestEl.appendChild(btn);
    });
  }

  // ----------------------------------------
  // Search input (fell-first, then geocode)
  // ----------------------------------------
  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    clearErr();

    if (debounceTimer) clearTimeout(debounceTimer);

    if (q.length < 2) {
      hideSuggest();
      return;
    }

    debounceTimer = setTimeout(async () => {
      const reqId = ++activeReq;
      setStatus("Searching…");

      try {
        await loadFells();
        if (reqId !== activeReq) return;

        const fellMatches = matchFells(q, 6);

        const places = await geocode(q);
        if (reqId !== activeReq) return;

        if (!fellMatches.length && !places.length) {
          hideSuggest();
          setStatus("No matches — try a different place.");
          return;
        }

        showSuggestMixed(fellMatches, places);
        setStatus("Pick a match from the list.");
      } catch (_) {
        if (reqId !== activeReq) return;
        hideSuggest();
        setStatus("Search unavailable — try again.");
      }
    }, 250);
  });

  inputEl.addEventListener("blur", () => setTimeout(() => hideSuggest(), 150));

  clearBtn?.addEventListener("click", () => {
    inputEl.value = "";
    hideSuggest();
    clearErr();
    setViewing(null);
    setStatus("Cleared. Choose a location to begin.");
  });

  // ----------------------------------------
  // Fetch (Open-Meteo)
  // ----------------------------------------
  function isoNowHour() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }

  async function fetchPro(lat, lon) {
    const HOURLY = [
      "temperature_2m",
      "apparent_temperature",
      "dew_point_2m",
      "relative_humidity_2m",

      "precipitation_probability",
      "precipitation",
      "snowfall",

      "wind_speed_10m",
      "wind_gusts_10m",
      "wind_direction_10m",

      "cloudcover_low",
      "cloudcover_mid",
      "cloudcover_high",

      "visibility",
      "surface_pressure",
      "shortwave_radiation",

      "freezing_level_height",
      "boundary_layer_height"
    ].join(",");

    const url =
      "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
      + `&hourly=${encodeURIComponent(HOURLY)}`
      + "&temperature_unit=celsius&windspeed_unit=mph&precipitation_unit=mm"
      + "&timezone=auto";

    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.hourly) throw new Error("Bad pro forecast response");
    return data;
  }

  function pickNext48h(hourly) {
    const t = hourly.time || [];
    const now = isoNowHour();
    const startIdx = t.findIndex(x => new Date(x).getTime() >= now.getTime());
    const i0 = Math.max(0, startIdx === -1 ? 0 : startIdx);
    const i1 = Math.min(t.length, i0 + 48);

    function slice(arr) { return Array.isArray(arr) ? arr.slice(i0, i1) : []; }

    return {
      time: t.slice(i0, i1),

      temp: slice(hourly.temperature_2m),
      feels: slice(hourly.apparent_temperature),
      dew: slice(hourly.dew_point_2m),
      rh: slice(hourly.relative_humidity_2m),

      pp: slice(hourly.precipitation_probability),
      rain: slice(hourly.precipitation),
      snow: slice(hourly.snowfall),

      wind: slice(hourly.wind_speed_10m),
      gust: slice(hourly.wind_gusts_10m),
      wdir: slice(hourly.wind_direction_10m),

      cloudLow: slice(hourly.cloudcover_low),
      cloudMid: slice(hourly.cloudcover_mid),
      cloudHigh: slice(hourly.cloudcover_high),

      vis: slice(hourly.visibility),
      press: slice(hourly.surface_pressure),
      solar: slice(hourly.shortwave_radiation),

      freeze: slice(hourly.freezing_level_height),
      pbl: slice(hourly.boundary_layer_height)
    };
  }

  // ----------------------------------------
  // Risk Flags (aggregated across 48h window)
  // ----------------------------------------
  function computeRiskFlags(hours) {
    const flags = [];
    if (!hours || !hours.length) return flags;

    const maxGust = Math.max(...hours.map(h => h.gustMph ?? 0));
    const maxP = Math.max(...hours.map(h => h.precipProb ?? 0));
    const minVis = Math.min(...hours.map(h => (h.visKm ?? 99)));
    const anySnow = hours.some(h => (h.snowMm ?? 0) >= 0.5);
    const lowCloudLikely = hours.some(h => (h.cloudLow ?? 0) >= 70);

    if (lowCloudLikely) flags.push({ tone: "amber", text: "Low cloud likely (clag risk)" });

    const inversionLikely = hours.some(h => {
      const low = (h.cloudLow ?? 0) >= 70;
      const moist = (h.rh ?? 0) >= 90 || ((h.tempC != null && h.dewC != null) ? ((h.tempC - h.dewC) <= 1.5) : false);
      const stable = (h.pblM ?? 9999) <= 800;
      const hh = Number(h.hour);
      const morningBias = Number.isFinite(hh) ? (hh >= 0 && hh <= 11) : false;
      return low && moist && stable && morningBias;
    });
    if (inversionLikely) flags.push({ tone: "green", text: "Inversion possible (peaks may be above cloud)" });

    if (maxGust >= 45) flags.push({ tone: "red", text: "Strong ridge gusts likely" });
    else if (maxGust >= 30) flags.push({ tone: "amber", text: "Breezy on exposed ridges" });

    if (maxP >= 70) flags.push({ tone: "amber", text: "High rain chance in period" });

    if (minVis <= 2) flags.push({ tone: "red", text: "Poor visibility risk" });
    else if (minVis <= 5) flags.push({ tone: "amber", text: "Reduced visibility possible" });

    if (anySnow) flags.push({ tone: "amber", text: "Snowfall signal (check freezing level)" });

    return flags.slice(0, 6);
  }

  function renderRiskFlags(hours) {
    const flags = computeRiskFlags(hours);
    if (!flags.length) return `<p class="formNote">No major flags detected in this period.</p>`;
    return `
      <div class="riskFlagsBar">
        ${flags.map(f => `<span class="riskFlag riskFlag--${f.tone}">${f.text}</span>`).join("")}
      </div>
    `;
  }

  // ----------------------------------------
  // Render
  // ----------------------------------------
  function renderPro(loc, data) {
    const next = pickNext48h(data.hourly);

    const hours = next.time.map((t, i) => {
      const d = new Date(t);
      const hh = Number.isNaN(d.getTime()) ? String(i).padStart(2, "0") : String(d.getHours()).padStart(2, "0");
      const label = Number.isNaN(d.getTime())
        ? `${hh}:00`
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const visKm = (next.vis[i] != null) ? (Number(next.vis[i]) / 1000) : null;

      return {
        idx: i,
        hour: hh,
        time: label,

        tempC: next.temp[i],
        feelsC: next.feels[i],
        dewC: next.dew[i],
        rh: next.rh[i],

        precipProb: next.pp[i],
        rainMm: next.rain[i],
        snowMm: next.snow[i],

        windMph: next.wind[i],
        gustMph: next.gust[i],
        windDirDeg: next.wdir[i],

        cloudLow: next.cloudLow[i],
        cloudMid: next.cloudMid[i],
        cloudHigh: next.cloudHigh[i],

        visKm,
        solarWm2: next.solar[i],
        pressureHpa: next.press[i],
        freezingM: next.freeze[i],
        pblM: next.pbl[i]
      };
    });

    const nowHour = String(new Date().getHours()).padStart(2, "0");
    const defaultIdx = (() => {
      const idx = hours.findIndex(h => h.hour === nowHour);
      return idx >= 0 ? idx : 0;
    })();

    // Icons (keep your existing set)
    const iconTemp = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconDrop = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconWind = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h10a3 3 0 1 0-3-3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h15a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconCloud = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .9-7.9A5 5 0 0 1 18 8.5a3.5 3.5 0 0 1 .5 7H7Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconEye = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconSun = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l-1-1M20 20l-1-1M19 5l1-1M4 20l1-1" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconGauge = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 1 1 8-8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12l6-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    const iconMountain = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l7-12 4 7 2-3 5 8H3Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

    // Column colouring heuristic (keep simple)
    function hourRiskPro(pp, gust, lowCloud, visKm) {
      const p = Number(pp ?? 0);
      const g = Number(gust ?? 0);
      const lc = Number(lowCloud ?? 0);
      const v = Number(visKm ?? 99);

      if (p >= 60 || g >= 45 || v <= 2) return { cls: "red" };
      if (p >= 30 || g >= 30 || lc >= 70 || v <= 5) return { cls: "amber" };
      return { cls: "green" };
    }

    // Helpers for formatting values in dense mode
    function fmtC(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}°C` : "—"; }
    function fmtPct(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}%` : "—"; }
    function fmtMm(x) { return (x != null && Number.isFinite(Number(x))) ? `${Number(x).toFixed(1)}mm` : "—"; }
    function fmtMph(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}mph` : "—"; }
    function fmtKm(x) { return (x != null && Number.isFinite(Number(x))) ? `${Number(x).toFixed(1)}km` : "—"; }
    function fmtM(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}m` : "—"; }
    function fmtHpa(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}hPa` : "—"; }
    function fmtWm2(x) { return (x != null && Number.isFinite(Number(x))) ? `${Math.round(x)}W/m²` : "—"; }

    wrap.innerHTML = `
      ${renderRiskFlags(hours)}
      <div class="hourMatrix hourMatrix--proDense">

        <div class="hourMatrixRail" aria-hidden="true">
          <div class="hourMatrixRailItem">${iconTemp}<span>Temp</span></div>
          <div class="hourMatrixRailItem isSub"><span>Feels</span></div>
          <div class="hourMatrixRailItem isSub"><span>Dew</span></div>
          <div class="hourMatrixRailItem isSub"><span>RH</span></div>

          <div class="hourMatrixRailItem">${iconWind}<span>Wind</span></div>
          <div class="hourMatrixRailItem isSub"><span>Gust</span></div>

          <div class="hourMatrixRailItem">${iconDrop}<span>Rain %</span></div>
          <div class="hourMatrixRailItem isSub"><span>Rain mm</span></div>
          <div class="hourMatrixRailItem isSub"><span>Snow mm</span></div>

          <div class="hourMatrixRailItem">${iconCloud}<span>Cloud L</span></div>
          <div class="hourMatrixRailItem isSub"><span>Cloud M</span></div>
          <div class="hourMatrixRailItem isSub"><span>Cloud H</span></div>

          <div class="hourMatrixRailItem">${iconEye}<span>Vis</span></div>
          <div class="hourMatrixRailItem">${iconSun}<span>Solar</span></div>
          <div class="hourMatrixRailItem">${iconGauge}<span>Press</span></div>

          <div class="hourMatrixRailItem">${iconMountain}<span>Freeze</span></div>
          <div class="hourMatrixRailItem isSub"><span>PBL</span></div>
        </div>

        <div class="hourMatrixScroll" id="proMatrixScroll">
          <div class="hourMatrixGrid">
            ${hours.map((h, i) => {
              const r = hourRiskPro(h.precipProb, h.gustMph, h.cloudLow, h.visKm);
              const isNow = (i === defaultIdx) ? " isNow" : "";

              const windSpeed = fmtMph(h.windMph);
              const windArrow = (h.windDirDeg != null && Number.isFinite(h.windDirDeg)) ? degToArrow(h.windDirDeg) : "—";

              return `
                <div class="hourCol hourCol--${r.cls}${isNow}" data-hour="${h.hour}" data-idx="${i}">
                  <div class="hourColHeader">${h.time}</div>

                  <div class="hourColVal">${fmtC(h.tempC)}</div>
                  <div class="hourColVal">${fmtC(h.feelsC)}</div>
                  <div class="hourColVal">${fmtC(h.dewC)}</div>
                  <div class="hourColVal">${fmtPct(h.rh)}</div>

                  <div class="hourColVal hourColVal--wind">
                    <div class="windStack">
                      <div class="windSpeed">${windSpeed}</div>
                      <div class="windArrow">${windArrow}</div>
                    </div>
                  </div>

                  <div class="hourColVal">${fmtMph(h.gustMph)}</div>

                  <div class="hourColVal">${fmtPct(h.precipProb)}</div>
                  <div class="hourColVal">${fmtMm(h.rainMm)}</div>
                  <div class="hourColVal">${fmtMm(h.snowMm)}</div>

                  <div class="hourColVal">${fmtPct(h.cloudLow)}</div>
                  <div class="hourColVal">${fmtPct(h.cloudMid)}</div>
                  <div class="hourColVal">${fmtPct(h.cloudHigh)}</div>

                  <div class="hourColVal">${fmtKm(h.visKm)}</div>
                  <div class="hourColVal">${fmtWm2(h.solarWm2)}</div>
                  <div class="hourColVal">${fmtHpa(h.pressureHpa)}</div>

                  <div class="hourColVal">${fmtM(h.freezingM)}</div>
                  <div class="hourColVal">${fmtM(h.pblM)}</div>

                  <div class="hourColBar" aria-hidden="true"></div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

      </div>
    `;

    // Enable drag-scroll
    const scroller = document.getElementById("proMatrixScroll");
    if (scroller && typeof window.enableDragScroll === "function") {
      window.enableDragScroll(scroller);
    }

    // Snap default column into view
    const scrollerEl = wrap.querySelector("#proMatrixScroll");
    const defaultCol = wrap.querySelector(`.hourCol[data-idx="${defaultIdx}"]`);
    if (scrollerEl && defaultCol) {
      const colRect = defaultCol.getBoundingClientRect();
      const scRect  = scrollerEl.getBoundingClientRect();
      const colLeftInsideScroller = colRect.left - scRect.left;

      const leftGutter = 14; // matches your CSS padding-left on .hourMatrixScroll
      const targetDelta = colLeftInsideScroller - leftGutter;

      const maxScroll = scrollerEl.scrollWidth - scrollerEl.clientWidth;
      const nextLeft = clamp(scrollerEl.scrollLeft + targetDelta, 0, maxScroll);
      scrollerEl.scrollTo({ left: nextLeft, behavior: "auto" });
    }

    setStatus(`Showing Pro for ${loc.name}.`);
  }

  async function setLocation(loc) {
    clearErr();
    hideSuggest();

    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
      showErr("Please choose a valid location.");
      return;
    }

    setViewing(loc);
    setStatus(`Loading Pro data for ${loc.name}…`);

    try {
      const data = await fetchPro(loc.lat, loc.lon);
      renderPro(loc, data);
    } catch (_) {
      showErr("Pro data unavailable — please try again.");
      setStatus("Couldn’t load Pro data.");
    }
  }

  // ----------------------------------------
  // Buttons (unchanged behavior)
  // ----------------------------------------
  btnUsePrefs?.addEventListener("click", () => {
    clearErr();
    const pref = load(LS_PREFS);

    if (!pref || !Number.isFinite(pref.lat) || !Number.isFinite(pref.lon)) {
      showErr("No saved preference yet — go to Snapshot, choose a location, then try again.");
      return;
    }

    const label = String(pref.name || pref.place || "Saved preference").trim();
    setLocation({ name: label, lat: Number(pref.lat), lon: Number(pref.lon), elev_m: null, source: "Preference" });
  });

  btnUseDevice?.addEventListener("click", () => {
    clearErr();

    if (!navigator.geolocation) {
      showErr("Device location isn’t available on this browser.");
      return;
    }

    setStatus("Requesting location…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          name: "My location",
          lat: Number(pos.coords.latitude),
          lon: Number(pos.coords.longitude),
          elev_m: null,
          source: "Device"
        });
      },
      () => {
        showErr("Couldn’t access your location — please allow it or search for a place.");
        setStatus("Choose a location to begin.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });

  // Blank by default
  setViewing(null);
  setStatus("Choose a location to begin.");
})();
