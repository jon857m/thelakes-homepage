// ========================================
// 7-Day Forecast (blank-by-default)
// UPGRADE:
// - Fell-first search using /assets/data/fells.json (name + aliases)
// - Fallback to Open-Meteo Geocoding for non-fell places
// - Shows picked meta (lat/lon/elev) when a fell is selected
// - Keeps existing buttons + blank-by-default UX
// ========================================

(function () {
  const LS_PREFS = "ld_conditions_location_v1";     // existing saved preference from Snapshot
  const LS_VIEW  = "ld_forecast_view_v1";           // optional last-viewed for this page (we do NOT auto-load)

    // Per-page feature flags (the “tidy off mechanism” you asked for)
  const ENABLE_FELL_SEARCH = false; // 🏔 fells.json name+aliases test
  const ENABLE_GEO_SEARCH  = true; // 📍 Open-Meteo geocoding fallback

  const statusEl = document.getElementById("forecastStatus");
  const errEl = document.getElementById("forecastError");
  const viewingEl = document.getElementById("forecastViewing");

  const inputEl = document.getElementById("forecastSearch");
  const clearBtn = document.getElementById("forecastClearBtn");
  const suggestEl = document.getElementById("forecastSuggest");

  const presets = {
    north:   { name: "North Lakes",   lat: 54.70, lon: -3.00 },
    central: { name: "Central Lakes", lat: 54.55, lon: -3.15 },
    south:   { name: "South Lakes",   lat: 54.25, lon: -2.95 },
  };

  const presetBtns = document.querySelectorAll(".presetBtn");
  const btnUsePrefs = document.getElementById("btnUsePrefs");
  const btnUseDevice = document.getElementById("btnUseDevice");
  const wrap = document.getElementById("forecastWrap");

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

  function save(key, obj) {
    try {
      if (obj == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(obj));
    } catch (_) {}
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
    // We’ll inject a second line under “Viewing” using existing .formNote style
    let el = document.getElementById("forecastPickedMeta");
    if (el) return el;

    if (!viewingEl || !viewingEl.parentNode) return null;
    viewingEl.insertAdjacentHTML(
      "afterend",
      `<p class="formNote" id="forecastPickedMeta" style="margin-top:6px;">&nbsp;</p>`
    );
    return document.getElementById("forecastPickedMeta");
  }

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

  // Fallback: enableDragScroll (if not defined globally)
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

  // ---------------------------
  // Preset buttons (unchanged)
  // ---------------------------
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      const p = key ? presets[key] : null;
      if (!p) return;
      setLocation({ name: p.name, lat: p.lat, lon: p.lon, elev_m: null, source: "Preset" });
    });
  });

  // ---------------------------
  // Fell data (from /assets/data/fells.json)
  // ---------------------------
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
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!Array.isArray(data)) return [];
        // Precompute a search string per fell for fast contains matching
        fellsCache = data.map((f) => {
          const names = [f.name].concat(Array.isArray(f.aliases) ? f.aliases : []);
          return {
            ...f,
            _search: norm(names.join(" "))
          };
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

    // Basic contains scoring (short and stable)
    const out = [];
    for (const f of fellsCache) {
      if (!f || !f._search) continue;
      const idx = f._search.indexOf(q);
      if (idx === -1) continue;

      // prefer name match over alias match
      const nameIdx = norm(f.name).indexOf(q);
      const score = (nameIdx !== -1) ? 0 : 1; // 0 = best
      out.push({ f, score, idx });
    }

    out.sort((a, b) => (a.score - b.score) || (a.idx - b.idx));
    return out.slice(0, limit).map(x => x.f);
  }

  // ---------------------------
  // Geocoding search (Open-Meteo)
  // ---------------------------
  let debounceTimer = null;
  let activeReq = 0;

  async function geocode(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.results)) ? data.results : [];
  }

  function showSuggestFellsAndPlaces(fells, places) {
    suggestEl.hidden = false;
    suggestEl.innerHTML = "";

    // Fells first (🏔)
    (fells || []).forEach((f) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");

      const elevTxt = (f.elev_m != null && f.elev_m !== "")
        ? ` • ${Math.round(Number(f.elev_m))}m`
        : "";

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

  // ---------------------------
  // Search input (fell-first, then geocode)
  // ---------------------------
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

    if (!ENABLE_FELL_SEARCH && !ENABLE_GEO_SEARCH) {
      hideSuggest();
      setStatus("Search is disabled on this page.");
      return;
    }


      try {
    let fellMatches = [];

    if (ENABLE_FELL_SEARCH) {
      await loadFells();
      if (reqId !== activeReq) return;

      fellMatches = matchFells(q, 6);
    }

        // 2) Always ALSO fetch geocode (so user can still pick “Keswick” etc),
        // but if fell match exists, show them first for UX consistency.
        let placeResults = [];

    if (ENABLE_GEO_SEARCH) {
      placeResults = await geocode(q);
      if (reqId !== activeReq) return;
    }

        if (!fellMatches.length && !placeResults.length) {
          hideSuggest();
          setStatus("No matches — try a different search.");
          return;
        }

        showSuggestFellsAndPlaces(fellMatches, placeResults);
        setStatus("Pick a match from the list.");
      } catch (_) {
        if (reqId !== activeReq) return;
        hideSuggest();
        setStatus("Search unavailable — try again.");
      }
    }, 250);
  });

  inputEl.addEventListener("blur", () => {
    setTimeout(() => hideSuggest(), 150);
  });

  clearBtn?.addEventListener("click", () => {
    inputEl.value = "";
    hideSuggest();
    clearErr();
    setViewing(null);
    setStatus("Cleared. Choose a location to begin.");
  });

  // ---------------------------
  // Forecast fetch (Open-Meteo daily)
  // ---------------------------
  async function fetchDaily(lat, lon) {
    const url =
      "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max"
      + "&timezone=auto";

    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.daily) throw new Error("Bad daily forecast response");
    return data;
  }

  function renderDaily(loc, data) {
    const daily = data.daily;

    const times = daily.time || [];
    const tMax = daily.temperature_2m_max || [];
    const tMin = daily.temperature_2m_min || [];
    const ppMax = daily.precipitation_probability_max || [];
    const rain = daily.precipitation_sum || [];
    const wind = daily.wind_speed_10m_max || [];
    const gust = daily.wind_gusts_10m_max || [];

    const rows = times.slice(0, 7).map((t, i) => {
      return {
        date: t,
        tMax: tMax[i],
        tMin: tMin[i],
        ppMax: ppMax[i],
        rainMm: rain[i],
        windMax: wind[i],
        gustMax: gust[i]
      };
    });

    // Reuse the Fell Planner rail style (icons + matrix)
    const iconTemp = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconWind = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h10a3 3 0 1 0-3-3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h15a3 3 0 1 1-3 3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconRain = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .9-7.9A5 5 0 0 1 18 8.5a3.5 3.5 0 0 1 .5 7H7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const iconVis = `<svg class="hourIcon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

    function fmtDateShort(iso) {
      const d = new Date(iso + "T12:00:00");
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit" });
    }

    function dayRisk(d) {
      const pp = Number(d.ppMax ?? 0);
      const g = Number(d.gustMax ?? 0);
      const mm = Number(d.rainMm ?? 0);

      if (pp >= 70 || g >= 45 || mm >= 15) return { cls: "red", label: "Red" };
      if (pp >= 40 || g >= 30 || mm >= 5)  return { cls: "amber", label: "Amber" };
      return { cls: "green", label: "Green" };
    }

    wrap.innerHTML = `
      <div class="hourMatrix">

        <div class="hourMatrixRail" aria-hidden="true">
          <div class="hourMatrixRailItem">${iconTemp}<span>High</span></div>
          <div class="hourMatrixRailItem isSub"><span>Low</span></div>

          <div class="hourMatrixRailItem">${iconWind}<span>Wind</span></div>
          <div class="hourMatrixRailItem isSub"><span>Gust</span></div>

          <div class="hourMatrixRailItem">${iconRain}<span>Rain</span></div>
          <div class="hourMatrixRailItem">${iconVis}<span>Total</span></div>
        </div>

        <div class="hourMatrixScroll" id="dayMatrixScroll">
          <div class="hourMatrixGrid">

            ${rows.map(d => {
              const r = dayRisk(d);

              const hi = (d.tMax != null) ? `${Math.round(d.tMax)}°C` : "—";
              const lo = (d.tMin != null) ? `${Math.round(d.tMin)}°C` : "—";
              const w  = (d.windMax != null) ? `${Math.round(d.windMax)} mph` : "—";
              const g  = (d.gustMax != null) ? `${Math.round(d.gustMax)} mph` : "—";
              const pp = (d.ppMax != null) ? `${Math.round(d.ppMax)}%` : "—";
              const mm = (d.rainMm != null) ? `${Number(d.rainMm).toFixed(1)} mm` : "—";

              return `
                <div class="hourCol hourCol--${r.cls}">
                  <div class="hourColHeader">${fmtDateShort(d.date)}</div>

                  <div class="hourColVal">${hi}</div>
                  <div class="hourColVal">${lo}</div>

                  <div class="hourColVal">${w}</div>
                  <div class="hourColVal">${g}</div>

                  <div class="hourColVal">${pp}</div>
                  <div class="hourColVal">${mm}</div>

                  <div class="hourColBar" aria-hidden="true"></div>
                </div>
              `;
            }).join("")}

          </div>
        </div>

      </div>
    `;

    const scroller = document.getElementById("dayMatrixScroll");
    if (scroller && typeof window.enableDragScroll === "function") {
      window.enableDragScroll(scroller);
    }

    setStatus(`Showing 7-day outlook for ${loc.name}.`);
  }

  async function setLocation(loc) {
    clearErr();
    hideSuggest();

    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) {
      showErr("Please choose a valid location.");
      return;
    }

    setViewing(loc);
    setStatus(`Loading 7-day outlook for ${loc.name}…`);

    try {
      const data = await fetchDaily(loc.lat, loc.lon);
      renderDaily(loc, data);

      // Store last-viewed, but never auto-load it (keeps your “blank-by-default” principle)
      save(LS_VIEW, { ...loc, savedAt: new Date().toISOString() });
    } catch (e) {
      showErr("Forecast unavailable — please try again.");
      setStatus("Couldn’t load forecast.");
    }
  }

  // ---------------------------
  // Buttons (unchanged)
  // ---------------------------
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
        const lat = Number(pos.coords.latitude);
        const lon = Number(pos.coords.longitude);
        setLocation({ name: "My location", lat, lon, elev_m: null, source: "Device" });
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

