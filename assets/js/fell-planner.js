// ========================================
// Fell Forecast Planner (V2 - with toggles)
// - Fell search from /assets/data/fells.json (🏔) (toggleable)
// - Geo search fallback via Open-Meteo geocoding (📍) (toggleable)
// - Presets / Preferences / Device remain available regardless
// - Select date (today/tomorrow/custom)
// - Fetch hour-by-hour forecast from Open-Meteo (no key)
// - Persist: ld_fell_v1 + ld_fell_date_v1 (but boot starts EMPTY by design)
// ========================================

(function () {
  const LS_FELL = "ld_fell_v1";
  const LS_DATE = "ld_fell_date_v1";
  const LS_PREFS = "ld_conditions_location_v1";

  // Per-page feature flags (the “tidy off mechanism” you asked for)
  const ENABLE_FELL_SEARCH = true; // 🏔 fells.json name+aliases
  const ENABLE_GEO_SEARCH  = false; // 📍 Open-Meteo geocoding fallback

  // Elements
  const statusEl = document.getElementById("plannerStatus");
  const errEl = document.getElementById("plannerError");

  const fellInput = document.getElementById("fellSearch");
  const clearFellBtn = document.getElementById("clearFellBtn");
  const fellSuggest = document.getElementById("fellSuggest");

  const btnToday = document.getElementById("btnToday");
  const btnTomorrow = document.getElementById("btnTomorrow");
  const datePick = document.getElementById("datePick");

  const selectedFellNote = document.getElementById("selectedFellNote");
  const selectedDateNote = document.getElementById("selectedDateNote");

  const summaryPill = document.getElementById("summaryPill");
  const fellPointEl = document.getElementById("fellPoint");
  const fellElevEl = document.getElementById("fellElev");
  const bestWindowEl = document.getElementById("bestWindow");
  const worstHourEl = document.getElementById("worstHour");

  const hourlyWrap = document.getElementById("hourlyWrap");

  // Extra location buttons (Preferences / Device / Presets)
  const btnUsePrefs = document.getElementById("plannerUsePrefs");
  const btnUseDevice = document.getElementById("plannerUseDevice");
  const presetBtns = document.querySelectorAll(".presetBtn");

  const presets = {
    north:   { name: "North Lakes",   lat: 54.70, lon: -3.00 },
    central: { name: "Central Lakes", lat: 54.55, lon: -3.15 },
    south:   { name: "South Lakes",   lat: 54.25, lon: -2.95 },
  };

  if (!fellInput || !fellSuggest || !datePick || !hourlyWrap) return;

  // State
  let fells = [];
  let currentFell = null; // {name, lat, lon, elev_m?, source?}
  let currentDate = null; // YYYY-MM-DD

  // Helpers
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

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function save(key, obj) {
    try {
      if (obj === null || obj === undefined) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(obj));
    } catch (_) {}
  }

  function load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function hideSuggest() {
    fellSuggest.hidden = true;
    fellSuggest.innerHTML = "";
  }

  function renderSelected() {
    if (selectedFellNote) {
      if (!currentFell) {
        selectedFellNote.textContent = "Selected fell: —";
      } else {
        const tag = currentFell.source === "geocode" ? "📍" : "🏔";
        selectedFellNote.textContent = `Selected: ${tag} ${currentFell.name}`;
      }
    }

    if (selectedDateNote) {
      selectedDateNote.textContent = currentDate
        ? `Selected date: ${currentDate}`
        : "Selected date: —";
    }

    if (currentFell) {
      if (fellPointEl) {
        fellPointEl.textContent =
          `${Number(currentFell.lat).toFixed(5)}, ${Number(currentFell.lon).toFixed(5)}`;
      }
      if (fellElevEl) {
        fellElevEl.textContent = currentFell.elev_m ? `${currentFell.elev_m} m` : "—";
      }
    } else {
      if (fellPointEl) fellPointEl.textContent = "—";
      if (fellElevEl) fellElevEl.textContent = "—";
    }
  }

  function renderPlaceholderHourly() {
    hourlyWrap.innerHTML = `<p class="formNote">Select a fell (or place) and date to load hourly detail.</p>`;
    summaryPill.textContent = "Choose a fell (or place) and date.";
    bestWindowEl.textContent = "—";
    worstHourEl.textContent = "—";
  }

  // --------------------------------------------------
  // Selection helper for Preset/Prefs/Device (always allowed)
  // --------------------------------------------------
  function setPlaceAsSelection(name, lat, lon, sourceLabel) {
    const loc = {
      name: String(name || "Place").trim(),
      aliases: [],
      lat: Number(lat),
      lon: Number(lon),
      elev_m: null,
      source: "geocode", // treat as 📍 place
    };

    currentFell = loc;
    fellInput.value = loc.name;
    save(LS_FELL, loc);
    renderSelected();
    maybeLoadForecast();

    setStatus(`Selected: 📍 ${loc.name}${sourceLabel ? ` (${sourceLabel})` : ""}`);
  }

  btnUsePrefs?.addEventListener("click", () => {
    clearErr();
    const pref = load(LS_PREFS);
    const lat = pref ? Number(pref.lat) : NaN;
    const lon = pref ? Number(pref.lon) : NaN;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showErr("No saved preference yet — set it on Conditions / Snapshot first.");
      return;
    }

    const label = String(pref.name || pref.place || "My preference").trim();
    setPlaceAsSelection(label, lat, lon, "Preference");
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
        setPlaceAsSelection(
          "My location",
          pos.coords.latitude,
          pos.coords.longitude,
          "Device"
        );
      },
      () => {
        showErr("Couldn’t access your location — please allow it or use search/presets.");
        setStatus("Ready.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      const p = key ? presets[key] : null;
      if (!p) return;
      setPlaceAsSelection(p.name, p.lat, p.lon, "Preset");
    });
  });

  // --------------------------------------------------
  // Scoring + Summary (unchanged)
  // --------------------------------------------------
  function scoreHour(h) {
    const p = h.precipProb ?? 0;
    const g = h.gustMph ?? 0;
    const v = h.visKm ?? 30;

    let s = 0;
    s += p * 1.2;
    s += Math.max(0, g - 20) * 1.6;
    if (v < 2) s += 25;
    else if (v < 5) s += 12;
    return s;
  }

  function pickBestWindow(hours) {
    const filtered = hours.filter(h => {
      const hh = Number(h.hour);
      return hh >= 6 && hh <= 18;
    });

    if (filtered.length < 3) return null;

    let best = null;
    for (let i = 0; i <= filtered.length - 3; i++) {
      const window = filtered.slice(i, i + 3);
      const avg = window.reduce((acc, h) => acc + scoreHour(h), 0) / 3;
      if (!best || avg < best.avg) {
        best = { start: window[0].time, end: window[2].time, avg };
      }
    }
    return best;
  }

  function pickWorstHour(hours) {
    if (!hours.length) return null;
    let worst = hours[0];
    let worstScore = scoreHour(worst);
    for (const h of hours) {
      const s = scoreHour(h);
      if (s > worstScore) {
        worst = h;
        worstScore = s;
      }
    }
    return worst;
  }

  function hourRisk(h) {
    const pp = Number(h.precipProb ?? 0);
    const gust = Number(h.gustMph ?? 0);
    const vis = Number(h.visKm ?? 99);

    if (pp >= 60 || gust >= 45 || vis <= 2) return { cls: "red", label: "Red" };
    if (pp >= 30 || gust >= 30 || vis <= 5) return { cls: "amber", label: "Amber" };
    return { cls: "green", label: "Green" };
  }

  function renderHourly(hours) {
    if (!hours || !hours.length) {
      hourlyWrap.innerHTML = `<p class="formNote">No hourly data for that date.</p>`;
      return;
    }

    const iconTemp = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconWind = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h10a3 3 0 1 0-3-3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h15a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconRain = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .9-7.9A5 5 0 0 1 18 8.5a3.5 3.5 0 0 1 .5 7H7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconVis  = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

    hourlyWrap.innerHTML = `
      <div class="hourMatrix">

        <div class="hourMatrixRail" aria-hidden="true">
          <div class="hourMatrixRailItem">${iconTemp}<span>Temp</span></div>
          <div class="hourMatrixRailItem isSub"><span>Feels</span></div>

          <div class="hourMatrixRailItem">${iconWind}<span>Wind</span></div>
          <div class="hourMatrixRailItem isSub"><span>Gust</span></div>

          <div class="hourMatrixRailItem">${iconRain}<span>Precip</span></div>
          <div class="hourMatrixRailItem">${iconVis}<span>Vis</span></div>
        </div>

        <div class="hourMatrixScroll" id="hourMatrixScroll">
          <div class="hourMatrixGrid">

            ${hours.map(h => {
              const r = hourRisk(h);

              const temp  = (h.tempC != null) ? `${Math.round(h.tempC)}°C` : "—";
              const feels = (h.feelsC != null) ? `${Math.round(h.feelsC)}°C` : "—";
              const wind  = (h.windMph != null) ? `${Math.round(h.windMph)} mph` : "—";
              const gust  = (h.gustMph != null) ? `${Math.round(h.gustMph)} mph` : "—";
              const pp    = (h.precipProb != null) ? `${Math.round(h.precipProb)}%` : "—";
              const vis   = (h.visKm != null) ? `${h.visKm.toFixed(1)} km` : "—";

              return `
                <div class="hourCol hourCol--${r.cls}" data-hour="${h.hour}">
                  <div class="hourColHeader">${h.time}</div>

                  <div class="hourColVal">${temp}</div>
                  <div class="hourColVal">${feels}</div>

                  <div class="hourColVal">${wind}</div>
                  <div class="hourColVal">${gust}</div>

                  <div class="hourColVal">${pp}</div>
                  <div class="hourColVal">${vis}</div>

                  <div class="hourColBar" aria-hidden="true"></div>
                </div>
              `;
            }).join("")}

          </div>
        </div>

      </div>
    `;

    const scroller = document.getElementById("hourMatrixScroll");
    if (scroller && typeof enableDragScroll === "function") {
      enableDragScroll(scroller);
    }

    // Highlight + scroll-to-now ONLY when viewing TODAY
    const todayStr = isoDate(new Date());
    if (currentDate === todayStr) {
      const now = new Date();
      const nowHour = String(now.getHours()).padStart(2, "0");

      const currentCol = hourlyWrap.querySelector(`.hourCol[data-hour="${nowHour}"]`);
      if (currentCol) {
        currentCol.classList.add("isNow");

        const scrollerEl = hourlyWrap.querySelector("#hourMatrixScroll");
        if (scrollerEl) {
          const colRect = currentCol.getBoundingClientRect();
          const scRect  = scrollerEl.getBoundingClientRect();

          const colLeftInsideScroller = colRect.left - scRect.left;
          const leftGutter = 14;
          const targetDelta = colLeftInsideScroller - leftGutter;

          const maxScroll = scrollerEl.scrollWidth - scrollerEl.clientWidth;
          const next = Math.max(0, Math.min(maxScroll, scrollerEl.scrollLeft + targetDelta));

          scrollerEl.scrollTo({ left: next, behavior: "auto" });
        }
      }
    }
  }

  // --------------------------------------------------
  // Fell index load (toggleable)
  // --------------------------------------------------
  async function loadFells() {
    if (!ENABLE_FELL_SEARCH) {
      fells = [];
      return;
    }

    setStatus("Loading fell index…");
    const r = await fetch("/assets/data/fells_master.json", { cache: "no-store" });
    if (!r.ok) throw new Error("Failed to load fells.json");
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("Bad fells.json format");
    fells = data;
    setStatus("Ready.");
  }

  function matchFells(q) {
    if (!ENABLE_FELL_SEARCH) return [];

    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out = [];

    for (const f of fells) {
      const name = String(f.name || "").toLowerCase();
      const aliases = Array.isArray(f.aliases) ? f.aliases.map(a => String(a).toLowerCase()) : [];
      const hit = name.includes(s) || aliases.some(a => a.includes(s));
      if (hit) out.push(f);
      if (out.length >= 8) break;
    }
    return out;
  }

  function showFellSuggest(results) {
    fellSuggest.hidden = false;
    fellSuggest.innerHTML = "";

    results.forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");

      const sub = f.elev_m ? ` • ${f.elev_m}m` : "";
      btn.textContent = `🏔 ${f.name}${sub}`;

      btn.addEventListener("click", () => {
        currentFell = { ...f, source: "fells" };
        fellInput.value = f.name;
        hideSuggest();
        save(LS_FELL, currentFell);
        renderSelected();
        maybeLoadForecast();
      });

      fellSuggest.appendChild(btn);
    });
  }

  // --------------------------------------------------
  // Geo fallback (toggleable)
  // --------------------------------------------------
  let activeGeoReq = 0;

  async function geocodePlaces(q) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.results)) ? data.results : [];
  }

  function showPlaceSuggest(results) {
    fellSuggest.hidden = false;
    fellSuggest.innerHTML = "";

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
        const loc = {
          name: name,
          aliases: [],
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          elev_m: null,
          source: "geocode"
        };

        currentFell = loc;
        fellInput.value = label;
        hideSuggest();
        save(LS_FELL, loc);
        renderSelected();
        maybeLoadForecast();
      });

      fellSuggest.appendChild(btn);
    });
  }

  // --------------------------------------------------
  // Forecast fetch (unchanged)
  // --------------------------------------------------
  async function fetchForecast(lat, lon) {
    const url =
      "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
      + "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover,visibility"
      + "&temperature_unit=celsius&windspeed_unit=mph&precipitation_unit=mm"
      + "&timezone=Europe%2FLondon"
      + "&forecast_days=7";

    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.hourly || !Array.isArray(data.hourly.time)) {
      throw new Error("Bad forecast response");
    }
    return data;
  }

  function extractHoursForDate(forecast, dateStr) {
    const H = forecast.hourly;
    const out = [];

    for (let i = 0; i < H.time.length; i++) {
      const t = H.time[i];
      if (!t || !t.startsWith(dateStr)) continue;

      const time = t.slice(11, 16);
      const hour = t.slice(11, 13);

      out.push({
        time,
        hour,
        tempC: H.temperature_2m?.[i],
        feelsC: H.apparent_temperature?.[i],
        precipProb: H.precipitation_probability?.[i],
        rainMm: H.precipitation?.[i],
        windMph: H.wind_speed_10m?.[i],
        gustMph: H.wind_gusts_10m?.[i],
        cloudPct: H.cloud_cover?.[i],
        visKm: (H.visibility?.[i] != null) ? (Number(H.visibility[i]) / 1000) : null
      });
    }
    return out;
  }

  function buildSummary(hours) {
    if (!hours.length) return { pill: "No hourly data.", best: null, worst: null };

    const avgP = hours.reduce((a, h) => a + (h.precipProb ?? 0), 0) / hours.length;
    const maxG = Math.max(...hours.map(h => h.gustMph ?? 0));
    const minVis = Math.min(...hours.map(h => (h.visKm ?? 99)));

    let pill = "Mixed conditions.";
    if (avgP < 20 && maxG < 30 && minVis > 5) pill = "Looks relatively favourable.";
    else if (avgP > 55 || maxG > 45 || minVis < 2) pill = "Higher risk conditions likely.";
    else if (maxG > 35) pill = "Windy on exposed ridges.";

    const best = pickBestWindow(hours);
    const worst = pickWorstHour(hours);

    return { pill, best, worst };
  }

  async function maybeLoadForecast() {
    clearErr();

    if (!currentFell || !currentDate) {
      renderPlaceholderHourly();
      return;
    }

    setStatus(`Loading hourly forecast for ${currentFell.name} on ${currentDate}…`);
    summaryPill.textContent = "Loading…";
    hourlyWrap.innerHTML = `<p class="formNote">Loading hour-by-hour…</p>`;
    bestWindowEl.textContent = "—";
    worstHourEl.textContent = "—";

    try {
      const fc = await fetchForecast(currentFell.lat, currentFell.lon);
      const hours = extractHoursForDate(fc, currentDate);

      renderHourly(hours);

      const s = buildSummary(hours);
      summaryPill.textContent = s.pill;

      bestWindowEl.textContent = s.best ? `${s.best.start}–${s.best.end}` : "—";
      worstHourEl.textContent = s.worst ? `${s.worst.time}` : "—";

      setStatus("Loaded.");
    } catch (_) {
      showErr("Couldn’t load forecast — please try again.");
      setStatus("Error loading forecast.");
      renderPlaceholderHourly();
    }
  }

  // --------------------------------------------------
  // UI events (search respects toggles)
  // --------------------------------------------------
  let debounce = null;

  fellInput.addEventListener("input", () => {
    clearErr();
    const q = fellInput.value.trim();

    if (debounce) clearTimeout(debounce);
    if (q.length < 2) {
      hideSuggest();
      return;
    }

    debounce = setTimeout(async () => {

      // If both search modes are off, don’t do anything noisy.
      if (!ENABLE_FELL_SEARCH && !ENABLE_GEO_SEARCH) {
        hideSuggest();
        setStatus("Search is disabled on this page.");
        return;
      }

      // 1) Try fells.json first (if enabled)
      if (ENABLE_FELL_SEARCH) {
        const hits = matchFells(q);
        if (hits.length) {
          showFellSuggest(hits);
          setStatus("Pick a fell from the list.");
          return;
        }
      }

      // 2) Fallback to geocoding (if enabled)
      if (!ENABLE_GEO_SEARCH) {
        hideSuggest();
        setStatus("No fell matches (place search is disabled).");
        return;
      }

      const reqId = ++activeGeoReq;
      setStatus("Searching places…");

      try {
        const places = await geocodePlaces(q);
        if (reqId !== activeGeoReq) return;

        if (!places.length) {
          hideSuggest();
          setStatus("No matches — try another name.");
          return;
        }

        showPlaceSuggest(places);
        setStatus("Pick a place from the list.");
      } catch (_) {
        if (reqId !== activeGeoReq) return;
        hideSuggest();
        setStatus("Search unavailable — try again.");
      }
    }, 180);
  });

  fellInput.addEventListener("blur", () => setTimeout(hideSuggest, 150));

  clearFellBtn?.addEventListener("click", () => {
    fellInput.value = "";
    currentFell = null;
    save(LS_FELL, null);
    hideSuggest();
    renderSelected();
    renderPlaceholderHourly();
    setStatus("Cleared selection.");
  });

  btnToday?.addEventListener("click", () => {
    const d = new Date();
    const s = isoDate(d);
    datePick.value = s;
    currentDate = s;
    save(LS_DATE, s);
    renderSelected();
    maybeLoadForecast();
  });

  btnTomorrow?.addEventListener("click", () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const s = isoDate(d);
    datePick.value = s;
    currentDate = s;
    save(LS_DATE, s);
    renderSelected();
    maybeLoadForecast();
  });

  datePick.addEventListener("change", () => {
    const v = String(datePick.value || "").trim();
    currentDate = v || null;
    if (currentDate) save(LS_DATE, currentDate);
    else save(LS_DATE, null);
    renderSelected();
    maybeLoadForecast();
  });

  // --------------------------------------------------
  // Boot (still starts EMPTY by design)
  // --------------------------------------------------
  (async function init() {
    try {
      if (ENABLE_FELL_SEARCH) {
        await loadFells();
      } else {
        setStatus("Ready.");
      }

      // Always start EMPTY (ignore any saved LS_FELL / LS_DATE)
      currentFell = null;
      currentDate = null;

      fellInput.value = "";
      datePick.value = "";

      renderSelected();
      renderPlaceholderHourly();

      // Helpful copy based on toggles
      if (ENABLE_FELL_SEARCH && ENABLE_GEO_SEARCH) setStatus("Pick a fell (or place) and choose a date.");
      else if (ENABLE_FELL_SEARCH && !ENABLE_GEO_SEARCH) setStatus("Pick a fell and choose a date. (Place search disabled)");
      else if (!ENABLE_FELL_SEARCH && ENABLE_GEO_SEARCH) setStatus("Pick a place and choose a date. (Fell search disabled)");
      else setStatus("Choose a date, then use presets / device / preference. (Search disabled)");

    } catch (_) {
      showErr("Fell index failed to load.");
    }
  })();
})();

// Drag-to-scroll helper (unchanged)
function enableDragScroll(container) {
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
}
