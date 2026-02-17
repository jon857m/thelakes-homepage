// ========================================
// Pro (Beta) — today + next 24h (Open-Meteo)
// - Blank by default
// - Search + Use preferences + Use device
// - Horizontal matrix base (like Fell Planner)
// - Risk Flags panel above matrix
// - Collapsible Environmental Data section
//
// Adds:
// - Wind direction
// - Low / Mid / High cloud
// - Dew point
// - Snowfall
// - Solar radiation
// ========================================

(function () {
  const LS_PREFS = "ld_conditions_location_v1";

  const statusEl = document.getElementById("proStatus");
  const errEl = document.getElementById("proError");
  const viewingEl = document.getElementById("proViewing");

  const inputEl = document.getElementById("proSearch");
  const clearBtn = document.getElementById("proClearBtn");
  const suggestEl = document.getElementById("proSuggest");

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

  function setViewing(loc) {
    if (!viewingEl) return;
    if (!loc) viewingEl.textContent = "Viewing: —";
    else viewingEl.textContent = `Viewing: ${loc.name} (${loc.source || "—"})`;
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

  // ----------------------------------------
  // Geocoding
  // ----------------------------------------
  let debounceTimer = null;
  let activeReq = 0;

  async function geocode(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.results)) ? data.results : [];
  }

  function showSuggest(results) {
    suggestEl.hidden = false;
    suggestEl.innerHTML = "";

    results.forEach((r) => {
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
          source: "Search"
        });
      });

      suggestEl.appendChild(btn);
    });
  }

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
        const results = await geocode(q);
        if (reqId !== activeReq) return;

        if (!results.length) {
          hideSuggest();
          setStatus("No matches — try a different place.");
          return;
        }

        showSuggest(results);
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
    setStatus("Cleared. Choose a location to begin.");
  });

  // ----------------------------------------
  // Pro fetch (Open-Meteo hourly)
  // ----------------------------------------
  function isoNowHour() {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d;
  }

  async function fetchPro(lat, lon) {
    // Expanded hourly set for Pro V1.1
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
      "freezing_level_height",
      "boundary_layer_height",

      "surface_pressure",
      "shortwave_radiation"
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

  function pickNext24h(hourly) {
    const t = hourly.time || [];
    const now = isoNowHour();
    const startIdx = t.findIndex(x => new Date(x).getTime() >= now.getTime());
    const i0 = Math.max(0, startIdx === -1 ? 0 : startIdx);
    const i1 = Math.min(t.length, i0 + 24);

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
      freeze: slice(hourly.freezing_level_height),
      pbl: slice(hourly.boundary_layer_height),

      press: slice(hourly.surface_pressure),
      solar: slice(hourly.shortwave_radiation)
    };
  }

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

  // ----------------------------------------
  // Risk flags + Environmental panel
  // ----------------------------------------
  function computeRiskFlags(hours) {
    const flags = [];
    if (!hours || !hours.length) return flags;

    const maxGust = Math.max(...hours.map(h => h.gustMph ?? 0));
    const maxP = Math.max(...hours.map(h => h.precipProb ?? 0));
    const minVis = Math.min(...hours.map(h => (h.visKm ?? 99)));
    const anySnow = hours.some(h => (h.snowMm ?? 0) >= 0.5);

    // Low cloud / summit clag hint
    const lowCloudLikely = hours.some(h => (h.cloudLow ?? 0) >= 70);
    if (lowCloudLikely) flags.push({ tone: "amber", text: "Low cloud likely (clag risk)" });

    // Inversion heuristic (LIKELY, not guaranteed)
    const inversionLikely = hours.some(h => {
      const low = (h.cloudLow ?? 0) >= 70;
      const moist = (h.rh ?? 0) >= 90 || ((h.tempC != null && h.dewC != null) ? ((h.tempC - h.dewC) <= 1.5) : false);
      const stable = (h.pblM ?? 9999) <= 800;
      const hh = Number(h.hour);
      const morningBias = Number.isFinite(hh) ? (hh >= 0 && hh <= 11) : false;
      return low && moist && stable && morningBias;
    });
    if (inversionLikely) flags.push({ tone: "green", text: "Inversion possible (peaks may be above cloud)" });

    // Wind exposure
    if (maxGust >= 45) flags.push({ tone: "red", text: "Strong ridge gusts likely" });
    else if (maxGust >= 30) flags.push({ tone: "amber", text: "Breezy on exposed ridges" });

    // Precip
    if (maxP >= 70) flags.push({ tone: "amber", text: "High rain chance in period" });

    // Visibility
    if (minVis <= 2) flags.push({ tone: "red", text: "Poor visibility risk" });
    else if (minVis <= 5) flags.push({ tone: "amber", text: "Reduced visibility possible" });

    // Snow
    if (anySnow) flags.push({ tone: "amber", text: "Snowfall signal (check freezing level)" });

    return flags.slice(0, 6);
  }

  function renderRiskFlags(hours) {
    const flags = computeRiskFlags(hours);
    if (!flags.length) {
      return `<p class="formNote">No major flags detected in this period.</p>`;
    }
    return `
      <div class="riskFlagsBar">
        ${flags.map(f => `<span class="riskFlag riskFlag--${f.tone}">${f.text}</span>`).join("")}
      </div>
    `;
  }

  function renderEnvironmental(summary) {
    // summary = a single representative hour (we use "now" hour if possible, else first)
    const solar = (summary.solarWm2 != null) ? `${Math.round(summary.solarWm2)} W/m²` : "—";
    const press = (summary.pressureHpa != null) ? `${Math.round(summary.pressureHpa)} hPa` : "—";
    const freeze = (summary.freezingM != null) ? `${Math.round(summary.freezingM)} m` : "—";
    const pbl = (summary.pblM != null) ? `${Math.round(summary.pblM)} m` : "—";
    const clouds = `
      Low ${summary.cloudLow != null ? Math.round(summary.cloudLow) + "%" : "—"} ·
      Mid ${summary.cloudMid != null ? Math.round(summary.cloudMid) + "%" : "—"} ·
      High ${summary.cloudHigh != null ? Math.round(summary.cloudHigh) + "%" : "—"}
    `;
    const dew = (summary.dewC != null) ? `${Math.round(summary.dewC)}°C` : "—";

    return `
      <div class="conditionsFacts">
        <div><span class="conditionsKey">Cloud layers</span> <span>${clouds}</span></div>
        <div><span class="conditionsKey">Dew point</span> <span>${dew}</span></div>
        <div><span class="conditionsKey">Solar</span> <span>${solar}</span></div>
        <div><span class="conditionsKey">Pressure</span> <span>${press}</span></div>
        <div><span class="conditionsKey">Freezing level</span> <span>${freeze}</span></div>
        <div><span class="conditionsKey">Stable layer (PBL)</span> <span>${pbl}</span></div>
      </div>
      <p class="formNote" style="margin-top:10px;">
        Environmental values are model signals (useful context), not guarantees.
      </p>
    `;
  }

  // ----------------------------------------
  // Render
  // ----------------------------------------
  function renderPro(loc, data) {
    const next = pickNext24h(data.hourly);

    // Build normalized hour objects for the matrix (24 columns)
    const hours = next.time.map((t, i) => {
      const d = new Date(t);
      const hh = Number.isNaN(d.getTime())
        ? String(i).padStart(2, "0")
        : String(d.getHours()).padStart(2, "0");

      const label = Number.isNaN(d.getTime())
        ? `${hh}:00`
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const visKm = (next.vis[i] != null) ? (Number(next.vis[i]) / 1000) : null;

      return {
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

        pressureHpa: next.press[i],
        freezingM: next.freeze[i],
        pblM: next.pbl[i],
        solarWm2: next.solar[i]
      };
    });

    // Summary
    const maxGust = statMax(next.gust);
    const maxWind = statMax(next.wind);
    const maxPP = statMax(next.pp);
    const sumRain = next.rain.map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0);
    const sumSnow = next.snow.map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0);

    // Pick an hour for the Environmental panel: "now" if present, else first
    const nowHour = String(new Date().getHours()).padStart(2, "0");
    const envHour = hours.find(h => h.hour === nowHour) || hours[0] || null;

    // Icons (same style as your matrix)
    const iconTemp = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconWind = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h10a3 3 0 1 0-3-3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h15a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconRain = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .9-7.9A5 5 0 0 1 18 8.5a3.5 3.5 0 0 1 .5 7H7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconCloud = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .9-7.9A5 5 0 0 1 18 8.5a3.5 3.5 0 0 1 .5 7H7Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconSnow  = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M4 6l16 12M20 6L4 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

    // Risk band for column colouring (simple, consistent)
    function hourRiskPro(pp, gust, lowCloud) {
      const p = Number(pp ?? 0);
      const g = Number(gust ?? 0);
      const lc = Number(lowCloud ?? 0);

      if (p >= 60 || g >= 45) return { cls: "red" };
      if (p >= 30 || g >= 30 || lc >= 70) return { cls: "amber" };
      return { cls: "green" };
    }

    wrap.innerHTML = `
      <div class="conditionsFacts" style="margin-bottom: 12px;">
        <div><span class="conditionsKey">Max wind</span> <span>${maxWind != null ? Math.round(maxWind) + " mph" : "—"}</span></div>
        <div><span class="conditionsKey">Max gust</span> <span>${maxGust != null ? Math.round(maxGust) + " mph" : "—"}</span></div>
        <div><span class="conditionsKey">Max rain chance</span> <span>${maxPP != null ? Math.round(maxPP) + "%" : "—"}</span></div>
        <div><span class="conditionsKey">Rain total</span> <span>${Number.isFinite(sumRain) ? sumRain.toFixed(1) + " mm" : "—"}</span></div>
        <div><span class="conditionsKey">Snow total</span> <span>${Number.isFinite(sumSnow) ? sumSnow.toFixed(1) + " mm" : "—"}</span></div>
      </div>

      <div class="card conditionsCard" style="margin-bottom: 12px;">
        <h3 style="margin:0 0 10px;">Risk Flags</h3>
        ${renderRiskFlags(hours)}
      </div>

      <details class="envDetails" style="margin-bottom: 12px;">
        <summary>Environmental Data</summary>
        <div class="envInner">
          ${envHour ? renderEnvironmental(envHour) : `<p class="formNote">No data available.</p>`}
        </div>
      </details>

      <div class="hourMatrix">

        <div class="hourMatrixRail" aria-hidden="true">
          <div class="hourMatrixRailItem">${iconTemp}<span>Temp</span></div>
          <div class="hourMatrixRailItem isSub"><span>Feels</span></div>

          <div class="hourMatrixRailItem">${iconWind}<span>Wind</span></div>
          <div class="hourMatrixRailItem isSub"><span>Gust</span></div>

          <div class="hourMatrixRailItem">${iconRain}<span>Rain</span></div>
          <div class="hourMatrixRailItem">${iconCloud}<span>Low cloud</span></div>
        </div>

        <div class="hourMatrixScroll" id="proMatrixScroll">
          <div class="hourMatrixGrid">
            ${hours.map(h => {
              const r = hourRiskPro(h.precipProb, h.gustMph, h.cloudLow);

              const temp  = (h.tempC != null) ? `${Math.round(h.tempC)}°C` : "—";
              const feels = (h.feelsC != null) ? `${Math.round(h.feelsC)}°C` : "—";

              const wdir = (h.windDirDeg != null && Number.isFinite(h.windDirDeg))
                ? `${degToArrow(h.windDirDeg)} ${degToCompass(h.windDirDeg)}`
                : "—";
              const wind = (h.windMph != null) ? `${Math.round(h.windMph)} mph` : "—";
              const windWithDir = (wind !== "—" || wdir !== "—") ? `${wind} • ${wdir}` : "—";

              const gust  = (h.gustMph != null) ? `${Math.round(h.gustMph)} mph` : "—";
              const pp    = (h.precipProb != null) ? `${Math.round(h.precipProb)}%` : "—";
              const lc    = (h.cloudLow != null) ? `${Math.round(h.cloudLow)}%` : "—";

              return `
                <div class="hourCol hourCol--${r.cls}" data-hour="${h.hour}">
                  <div class="hourColHeader">${h.time}</div>

                  <div class="hourColVal">${temp}</div>
                  <div class="hourColVal">${feels}</div>

                  <div class="hourColVal">${windWithDir}</div>
                  <div class="hourColVal">${gust}</div>

                  <div class="hourColVal">${pp}</div>
                  <div class="hourColVal">${lc}</div>

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

    // Highlight "now" and snap into view
    const currentCol = wrap.querySelector(`.hourCol[data-hour="${nowHour}"]`);
    if (currentCol) {
      currentCol.classList.add("isNow");

      const scrollerEl = wrap.querySelector("#proMatrixScroll");
      if (scrollerEl) {
        const colRect = currentCol.getBoundingClientRect();
        const scRect  = scrollerEl.getBoundingClientRect();
        const colLeftInsideScroller = colRect.left - scRect.left;

        const leftGutter = 14; // tweak only if your CSS padding changes
        const targetDelta = colLeftInsideScroller - leftGutter;

        const maxScroll = scrollerEl.scrollWidth - scrollerEl.clientWidth;
        const nextLeft = Math.max(0, Math.min(maxScroll, scrollerEl.scrollLeft + targetDelta));
        scrollerEl.scrollTo({ left: nextLeft, behavior: "auto" });
      }
    }

    setStatus(`Showing Pro (beta) for ${loc.name}.`);
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

  btnUsePrefs?.addEventListener("click", () => {
    clearErr();
    const pref = load(LS_PREFS);
    if (!pref || !Number.isFinite(pref.lat) || !Number.isFinite(pref.lon)) {
      showErr("No saved preference yet — go to Snapshot, choose a location, then try again.");
      return;
    }
    const label = String(pref.name || pref.place || "Saved preference").trim();
    setLocation({ name: label, lat: Number(pref.lat), lon: Number(pref.lon), source: "Preference" });
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

  setViewing(null);
  setStatus("Choose a location to begin.");
})();
