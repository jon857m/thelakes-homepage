// ========================================
// /conditions full page — Option 2 (search)
// - Open-Meteo Geocoding (no key)
// - Optional "Use my location"
// - Presets North/Central/South
// - Persist selection in localStorage: ld_location_v1
// ========================================

const STORAGE_KEY = "ld_conditions_location_v1";

function saveConditionsLocation({ place, lat, lon }) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        place: String(place || "").trim(),
        lat: Number(lat),
        lon: Number(lon),
        savedAt: new Date().toISOString()
      })
    );
  } catch (e) {
    // ignore storage errors (private mode etc.)
  }
}

(function () {
  const LS_KEY = "ld_conditions_location_v1";

  const presets = {
    north:   { name: "North Lakes",   lat: 54.70, lon: -3.00 },
    central: { name: "Central Lakes", lat: 54.55, lon: -3.15 },
    south:   { name: "South Lakes",   lat: 54.25, lon: -2.95 },
  };

  // Elements
  const statusEl = document.getElementById("conditionsStatus");
  const selectedNoteEl = document.getElementById("selectedNote");

  const inputEl = document.getElementById("placeSearch");
  const clearBtn = document.getElementById("clearSearchBtn");
  const suggestBox = document.getElementById("suggestBox");

  const useMyLocationBtn = document.getElementById("useMyLocationBtn");
  const presetBtns = document.querySelectorAll(".presetBtn");

  const nowTempEl = document.getElementById("nowTemp");
  const nowSummaryEl = document.getElementById("nowSummary");
  const nowWindEl = document.getElementById("nowWind");
  const nowBadgeEl = document.getElementById("nowBadge");
  const nowUpdatedEl = document.getElementById("nowUpdated");
  const errorNoteEl = document.getElementById("errorNote");

  // Guards
  if (!statusEl || !inputEl || !suggestBox) return;

  // Use the existing helper from app.js if present
  const toApi = (path) => (typeof apiUrl === "function" ? apiUrl(path) : path);

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  function showError(msg) {
    if (!errorNoteEl) return;
    errorNoteEl.style.display = "block";
    errorNoteEl.textContent = msg;
  }

  function clearError() {
    if (!errorNoteEl) return;
    errorNoteEl.style.display = "none";
    errorNoteEl.textContent = "";
  }

  function fmtUpdated(updatedAt) {
    if (!updatedAt) return "—";
    const d = new Date(updatedAt);
    if (Number.isNaN(d.getTime())) return "—";
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (mins <= 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  function badgeToEmoji(badge) {
    const b = String(badge || "").toLowerCase();
    if (b.includes("green")) return "🟢";
    if (b.includes("red")) return "🔴";
    return "🟡";
  }

  function setSelectedNote(loc) {
    if (!selectedNoteEl) return;
    selectedNoteEl.textContent = loc?.name
      ? `Selected: ${loc.name}`
      : "Selected: —";
  }

  function saveLoc(loc) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(loc));
    } catch (_) {}
  }

  function loadSavedLoc() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.lat !== "number" || typeof obj.lon !== "number") return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  async function fetchConditions(lat, lon) {
    const url = toApi(`/api/conditions?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data || !data.ok) throw new Error("Bad conditions response");
    return data;
  }

  function renderNow(data) {
    // Worker returns: { ok, lat, lon, tempC, summary, windMph, badgeText, badge, updatedAt }
    const temp = (data.tempC ?? "—");
    nowTempEl.textContent = `${temp}°C`;

    nowSummaryEl.textContent = data.summary || "—";
    nowWindEl.textContent = data.windMph != null ? `${data.windMph} mph` : "—";

    const badgeEmoji = badgeToEmoji(data.badge);
    const badgeText = data.badgeText ? `${badgeEmoji} ${data.badgeText}` : `${badgeEmoji} —`;
    nowBadgeEl.textContent = badgeText;

    nowUpdatedEl.textContent = fmtUpdated(data.updatedAt);
  }

  async function setLocationAndLoad(loc, { announce = true } = {}) {
    clearError();
    setSelectedNote(loc);

    if (announce) setStatus(`Loading conditions for ${loc.name}…`);

    try {
      const data = await fetchConditions(loc.lat, loc.lon);
      renderNow(data);
      const label = String(loc.name || loc.place || "Custom location").trim();
        saveLoc({
        name: label,
        place: label,
        lat: loc.lat,
        lon: loc.lon,
        mode: loc.mode || "preset"
        });
      setSelectedNote(loc);
      setStatus(`Showing conditions for ${loc.name}.`);
    } catch (e) {
      showError("Live conditions unavailable — please try again.");
      setStatus("Couldn’t load conditions.");
    }
  }

  // ---------------------------
  // Open-Meteo Geocoding search
  // ---------------------------
  let debounceTimer = null;
  let activeReq = 0;

  function hideSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
  }

  function showSuggest(results) {
    suggestBox.hidden = false;
    suggestBox.innerHTML = "";

    results.forEach((r, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");
      btn.setAttribute("data-idx", String(idx));

      const name = r.name || "Unknown";
      const admin = [r.admin1, r.admin2].filter(Boolean).join(", ");
      const country = r.country || "";
      const label = [name, admin, country].filter(Boolean).join(" • ");

      btn.textContent = label;

      btn.addEventListener("click", () => {
        const loc = {
          name,
          lat: Number(r.latitude),
          lon: Number(r.longitude),
        };
        inputEl.value = label;
        hideSuggest();
        setLocationAndLoad(loc);
      });

      suggestBox.appendChild(btn);
    });
  }

  async function geocode(name) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=en&format=json`;
    const r = await fetch(url, { cache: "no-store" });
    const data = await r.json().catch(() => null);
    return (data && Array.isArray(data.results)) ? data.results : [];
  }

  inputEl.addEventListener("input", () => {
    const q = inputEl.value.trim();
    clearError();

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
        if (reqId !== activeReq) return; // ignore stale responses

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

  inputEl.addEventListener("blur", () => {
    // Give clicks on suggestions time to register
    setTimeout(() => hideSuggest(), 150);
  });

  clearBtn?.addEventListener("click", () => {
    inputEl.value = "";
    hideSuggest();
    clearError();
    setStatus("Cleared.");
  });

  // ---------------------------
  // Presets
  // ---------------------------
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-preset");
      if (!key || !presets[key]) return;
      hideSuggest();
      inputEl.value = "";
      setLocationAndLoad(presets[key]);
    });
  });

  // ---------------------------
  // Use my location
  // ---------------------------
  useMyLocationBtn?.addEventListener("click", () => {
    clearError();
    hideSuggest();

    if (!navigator.geolocation) {
      showError("Your browser doesn’t support location.");
      return;
    }

    setStatus("Requesting your location…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lon = Number(pos.coords.longitude.toFixed(5));
        const loc = { name: "My location", lat, lon };
        inputEl.value = "";
        setLocationAndLoad(loc);
      },
      () => {
        showError("Location permission denied (or unavailable).");
        setStatus("Choose a preset or search instead.");
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60_000,
      }
    );
  });

  // ---------------------------
  // Boot: saved loc or default
  // ---------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const saved = loadSavedLoc();
    if (saved) {
      setSelectedNote(saved);
      setLocationAndLoad(saved, { announce: false });
      return;
    }

    // Default to Central
    setSelectedNote(presets.central);
    setLocationAndLoad(presets.central, { announce: false });
  });
})();
