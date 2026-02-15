// ==============================
// app.js — site-wide behaviours
// ==============================

// 1) Footer year (works whether footer is inline or injected)
function wireYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
}

// 2) Burger menu (works for injected header or normal page header)
// Safe to call multiple times (will only bind once)
function wireMenuToggle() {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mobileNav");
  if (!btn || !nav) return;

  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(isOpen));
  });
}

// Use same-origin on production, but call the live Worker when running locally
const API_BASE = (
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
)
  ? "https://www.thelakesincumbria.co.uk"
  : "";

function apiUrl(path) {
  return API_BASE + path;
}

// 3) Signup handler (supports multiple forms: footer + page forms)
function wireSignupForms() {
  // Support your current markup + older variants
  const forms = document.querySelectorAll(
    "form.signupForm, form.js-signup-form, form.signup__form"
  );

  forms.forEach((form) => {
    // Avoid double-binding (important because we wire before + after injection)
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const input = form.querySelector('input[name="email"]');
      const btn = form.querySelector('button[type="submit"]');

      // Where we show messages
      const note =
        form.querySelector(".formNote") ||
        form.querySelector("[data-form-note]") ||
        form.parentElement?.querySelector(".formNote");

      const email = (input?.value || "").trim();
      if (!email) return;

      // Consent checkbox must be checked
      const consentChecked = !!form.querySelector('input[name="consent"]')?.checked;
      if (!consentChecked) {
        if (note) note.textContent = "Please tick the consent box to continue.";
        return;
      }

      // Exact consent text (prefer hidden input; fallback to data attributes)
      const consentText =
        (form.querySelector('input[name="consent_text"]')?.value || "").trim() ||
        (form.getAttribute("data-consent-text") || "").trim();

      const consentVersion =
        (form.querySelector('input[name="consent_version"]')?.value || "").trim() ||
        (form.getAttribute("data-consent-version") || "v1").trim();

      if (!consentText) {
        if (note) note.textContent = "Missing consent text on this form (site config issue).";
        return;
      }

      // Unique form id / source for your Google Sheet
      const source =
        (form.getAttribute("data-form-id") || "").trim() ||
        (form.getAttribute("data-source") || "").trim() ||
        "unknown_form";

      // Offer/campaign id:
      // - URL param ?offer_id=... overrides everything (campaign tracking)
      // - otherwise default from hidden input on the form
      // - fallback to "general_signup"
      const offerId =
        (new URLSearchParams(window.location.search).get("offer_id") || "").trim() ||
        (form.querySelector('input[name="offer_id"]')?.value || "").trim() ||
        "general_signup";

      const payload = {
        email,
        source,
        offer_id: offerId,
        page_url: window.location.href,
        user_agent: navigator.userAgent,
        consent_text: consentText,
        consent_version: consentVersion
      };


      try {
        if (btn) {
          btn.disabled = true;
          btn.dataset.originalText = btn.textContent;
          btn.textContent = "Sending…";
        }

        const r = await fetch(apiUrl("/api/subscribe"), {

          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await r.json().catch(() => ({}));

        if (!r.ok || !data.ok) {
          if (note) note.textContent = data.message || "Something went wrong — please try again.";
          if (btn) {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || "Notify me";
          }
          return;
        }

        // Match your Apps Script statuses

        if (data.status === "pending") {
          if (note) {
            note.textContent = "Check your email to confirm (including spam/junk).";
            note.classList.remove("formNote--reassure");
            note.classList.add("formNote--verify");
          }
          if (input) { input.value = ""; input.blur(); }
          if (btn) btn.textContent = "Sent";
        return;
        }


        if (note) note.textContent = data.message || "Done.";
        form.reset();
        if (btn) btn.textContent = "Done";
      } catch (err) {
        if (note) note.textContent = "Network error — please try again.";
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.dataset.originalText || "Notify me";
        }
      }
    });
  });
}

// 4) Inject shared header + footer, then wire things again (now that injected DOM exists)
async function injectPartials() {
  const headerMount = document.getElementById("siteHeader");
  const footerMount = document.getElementById("siteFooter");

  // If a page doesn't have the mounts, just skip.
  if (headerMount) {
    const r = await fetch("/partials/header.html");
    headerMount.innerHTML = await r.text();
  }

  if (footerMount) {
    const r = await fetch("/partials/footer.html");
    footerMount.innerHTML = await r.text();
  }

  // After injection, wire up menu + forms + year
  wireMenuToggle();
  wireSignupForms();
  wireYear();
}

// 5) Stay thumbnails (safe on pages without them)
function wireStayThumbs() {
  const thumbs = document.querySelectorAll(".stayThumb");
  if (!thumbs.length) return;

  thumbs.forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", () => {
      const src = btn.getAttribute("data-img");
      const main = document.getElementById("stayMainImg");
      if (!main || !src) return;

      main.src = src;

      thumbs.forEach((b) => b.classList.remove("isActive"));
      btn.classList.add("isActive");
    });
  });

  const firstThumb = document.querySelector(".stayThumb");
  if (firstThumb) firstThumb.classList.add("isActive");
}

// ==============================
// Boot
// ==============================
document.addEventListener("DOMContentLoaded", async () => {
  // Wire whatever is already in the page (helps during your duplicate/non-injected phase)
  wireMenuToggle();
  wireSignupForms();
  wireYear();
  wireStayThumbs();

  // Then inject and wire again (now includes injected header/footer)
  try {
    await injectPartials();
  } catch (err) {
    console.error("Partial injection failed:", err);
  }

  // If partial injection introduced stayThumbs on that page, this is harmless (guards stop double-bind)
  wireStayThumbs();
});

// ---- Live Conditions Strip (Met Office via your /api/conditions Worker) ----
// Expecting your Worker to return: { ok, place, lat, lon, tempC, summary, windMph, badgeText, badge }
(async function initConditionsStrip(){
  const el = document.getElementById("conditionsStrip");
    // Make the pill act like a CTA
  el.style.cursor = "pointer";
  el.addEventListener("click", () => {
    window.location.href = "/conditions/";
  });
  if (!el) return;

  // Don’t bother if user is offline
  if (navigator.onLine === false) {
    el.textContent = "Offline — conditions unavailable.";
    return;
  }

  try {
      const API_BASE =
    location.hostname === "127.0.0.1" ||
    location.hostname === "localhost"
      ? "https://www.thelakesincumbria.co.uk"
      : "";

      // ---- Read saved location (set on /conditions) ----
      const STORAGE_KEY = "ld_conditions_location_v1";

      function getSavedLocation() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return null;
          const obj = JSON.parse(raw);
          if (!obj) return null;
          const lat = Number(obj.lat);
          const lon = Number(obj.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            place: String(obj.place || "").trim(),
            lat,
            lon
          };
        } catch (_) {
          return null;
        }
      }

      const saved = getSavedLocation();

      // Build API URL (use saved lat/lon if present)
      const url = new URL(`${API_BASE}/api/conditions`, location.origin);
      if (saved) {
        url.searchParams.set("lat", String(saved.lat));
        url.searchParams.set("lon", String(saved.lon));
        if (saved.place) url.searchParams.set("place", saved.place);
      }

      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();

    if (!data || !data.ok) throw new Error("Bad conditions response");

    // Sunrise/Sunset from lat/lon (computed locally)
    const { sunrise, sunset } = calcSunTimes(data.lat, data.lon);

    // Compose the strip text
    const temp = (data.tempC ?? "–") + "°C";
    const summary = data.summary || "—";
    const wind = (data.windMph ?? "–") + "mph";

    // Example: 🌤 6°C · Broken cloud · Wind 9mph · Sunrise 7:28 · Sunset 17:10 🟡 Breezy on ridges
    const badgeEmoji = badgeToEmoji(data.badge);
    const badgeText = data.badgeText ? ` ${badgeEmoji} ${data.badgeText}` : "";

    const nbsp = "\u00A0"; // non-breaking space

    const windChunk = `Wind${nbsp}${wind}`;
    const sunriseChunk = `Sunrise${nbsp}${sunrise}`;
    const sunsetChunk = `Sunset${nbsp}${sunset}`;

    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    let updatedText = "";
    if (updatedAt) {
      const mins = Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 60000));
      updatedText = ` · Updated ${mins}m ago`;
    }

    el.innerHTML = `
      <span class="live-badge">
        <span class="live-dot"></span>
        LIVE
      </span>
      🌤 ${temp} · ${summary} · ${windChunk} · ${sunriseChunk} · ${sunsetChunk}
      ${badgeText}
      <span class="updated-text">${updatedText}</span>
    `;


  } catch (e) {
    el.textContent = "Live conditions unavailable (tap to retry).";
    el.style.cursor = "pointer";
    el.addEventListener("click", () => location.reload(), { once: true });
  }

  function badgeToEmoji(badge){
    // badge can be "green"|"yellow"|"red" or similar
    const b = String(badge || "").toLowerCase();
    if (b.includes("green")) return "🟢";
    if (b.includes("red")) return "🔴";
    return "🟡";
  }

  function calcSunTimes(lat, lon){
    // Lightweight sunrise/sunset calculation (no external library).
    // Accuracy is good enough for “golden hour awareness”.
    // If you want absolute best accuracy later, we can swap to SunCalc.

    const now = new Date();
    const times = solarTimes(now, lat, lon);
    return {
      sunrise: formatLocalTime(times.sunrise),
      sunset: formatLocalTime(times.sunset),
    };
  }

  function formatLocalTime(d){
    // local device time (user’s iPhone)
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // --- Minimal sunrise/sunset (NOAA-ish) ---
  // Source-free implementation; compact + avoids pulling a lib.
  function solarTimes(date, lat, lon){
    // returns Date objects in local time
    const rad = Math.PI / 180;
    const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000);

    const lngHour = lon / 15;

    function calc(isSunrise){
      const t = day + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = (0.9856 * t) - 3.289;
      let L = M + (1.916 * Math.sin(rad * M)) + (0.020 * Math.sin(rad * 2 * M)) + 282.634;
      L = (L + 360) % 360;

      let RA = (180 / Math.PI) * Math.atan(0.91764 * Math.tan(rad * L));
      RA = (RA + 360) % 360;

      const Lquadrant  = Math.floor(L / 90) * 90;
      const RAquadrant = Math.floor(RA / 90) * 90;
      RA = RA + (Lquadrant - RAquadrant);
      RA = RA / 15;

      const sinDec = 0.39782 * Math.sin(rad * L);
      const cosDec = Math.cos(Math.asin(sinDec));

      // civil sunrise/sunset ≈ 90.833°
      const cosH = (Math.cos(rad * 90.833) - (sinDec * Math.sin(rad * lat))) / (cosDec * Math.cos(rad * lat));

      // Guard polar edge cases (not an issue for Lakes, but safe)
      if (cosH > 1) return null;  // sun never rises
      if (cosH < -1) return null; // sun never sets

      let H = isSunrise ? (360 - (180 / Math.PI) * Math.acos(cosH)) : (180 / Math.PI) * Math.acos(cosH);
      H = H / 15;

      const T = H + RA - (0.06571 * t) - 6.622;
      let UT = (T - lngHour) % 24;
      if (UT < 0) UT += 24;

      // Convert UT to local Date
      const d = new Date(date);
      const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0));
      utc.setUTCHours(Math.floor(UT), Math.floor((UT % 1) * 60), 0, 0);
      return new Date(utc.getTime()); // will display in local time
    }

    const sunrise = calc(true) || new Date(date);
    const sunset  = calc(false) || new Date(date);
    return { sunrise, sunset };
  }
})();
