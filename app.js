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
