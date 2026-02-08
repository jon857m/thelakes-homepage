// 1) Footer year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// 2) Inject shared header + footer
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

  // After injection, wire up menu + forms
  wireMenuToggle();
  wireSignupForms();
  wireYear();
}

// 3) Burger menu (works for injected header or normal page header)
function wireMenuToggle() {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mobileNav");
  if (!btn || !nav) return;

  btn.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(isOpen));
  });
}

// 4) Ensure year works even if footer is injected after initial script run
function wireYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
}

// 5) Signup handler (supports multiple forms: homepage + footer)
function wireSignupForms() {
  // Finds ALL signup forms (footer + pages) and wires them once.
  // Requirements:
  // - form has class: js-signup-form
  // - has an email input (type="email" OR name="email")
  // - optional: [data-subscribe-status] element to show messages

  const forms = document.querySelectorAll("form.js-signup-form");
  if (!forms.length) return;

  // Local dev (Live Server) can’t hit /api/*, so send to production.
  const API_BASE =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "https://www.thelakesincumbria.co.uk"
      : "";

  forms.forEach((form) => {
    // Avoid double-wiring if partials load more than once
    if (form.dataset.wired === "1") return;
    form.dataset.wired = "1";

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const emailEl =
        form.querySelector('input[type="email"]') ||
        form.querySelector('input[name="email"]');

      const consentEl =
        form.querySelector('input[type="checkbox"][name="consent"]') ||
        form.querySelector('input[type="checkbox"]');

      const buttonEl =
        form.querySelector('button[type="submit"]') ||
        form.querySelector('input[type="submit"]');

      const statusEl =
        form.querySelector("[data-subscribe-status]") ||
        form.querySelector(".formNote") ||
        form.querySelector(".signup__status");

      const email = (emailEl?.value || "").trim();

      // Read tracking + consent from data-* (per your plan)
      const source = form.getAttribute("data-source") || "unknown";
      const offerId = form.getAttribute("data-offer-id") || "";
      const consentText = form.getAttribute("data-consent-text") || "";
      const consentVersion = form.getAttribute("data-consent-version") || "v1";

      // Basic validation (keep it friendly)
      if (!email || !email.includes("@")) {
        if (statusEl) statusEl.textContent = "Please enter a valid email address.";
        emailEl?.focus?.();
        return;
      }

      if (consentEl && !consentEl.checked) {
        if (statusEl) statusEl.textContent = "Please tick the consent box to continue.";
        consentEl?.focus?.();
        return;
      }

      if (!consentText) {
        if (statusEl) statusEl.textContent = "Consent text missing (site config).";
        return;
      }

      // Button state to prevent double clicks
      const oldBtnText = buttonEl ? (buttonEl.textContent || buttonEl.value || "") : "";
      if (buttonEl) {
        buttonEl.disabled = true;
        if ("textContent" in buttonEl) buttonEl.textContent = "Submitting…";
        else buttonEl.value = "Submitting…";
      }
      if (statusEl) statusEl.textContent = "Working…";

      try {
        const res = await fetch(API_BASE + "/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            source,
            offer_id: offerId,
            page_url: location.pathname,
            user_agent: navigator.userAgent,
            consent_text: consentText,
            consent_version: consentVersion
          })
        });

        // If something upstream returns HTML (bad route), this will throw.
        const data = await res.json();

        if (data.ok) {
          // Match your Apps Script statuses
          if (data.status === "pending") {
            if (statusEl) statusEl.textContent = "Check your email to confirm (including spam/junk).";
          } else if (data.status === "already_active" || data.status === "already_active_offer_requested") {
            if (data.offer_status === "sent") {
              if (statusEl) statusEl.textContent = "You’re already subscribed — we’ve sent your guide.";
            } else {
              if (statusEl) statusEl.textContent = "You’re already subscribed — all set.";
            }
          } else {
            if (statusEl) statusEl.textContent = data.message || "Done.";
          }
        } else {
          if (statusEl) statusEl.textContent = data.message || "Something went wrong — please try again.";
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = "Network error — please try again.";
        // Optional: console for debugging without bothering users
        console.error("Signup submit failed:", err);
      } finally {
        if (buttonEl) {
          buttonEl.disabled = false;
          if ("textContent" in buttonEl) buttonEl.textContent = oldBtnText;
          else buttonEl.value = oldBtnText;
        }
      }
    });
  });
}


document.addEventListener("DOMContentLoaded", () => {
  injectPartials().catch((err) => {
    console.error("Partial injection failed:", err);
  });

  // Also wire up forms/menu in case the page still has non-injected versions (your V1 duplicate phase)
  wireMenuToggle();
  wireSignupForms();
});

document.querySelectorAll('.stayThumb').forEach(btn => {
  btn.addEventListener('click', () => {
    const src = btn.getAttribute('data-img');
    const main = document.getElementById('stayMainImg');
    if (!main || !src) return;

    main.src = src;

    document.querySelectorAll('.stayThumb').forEach(b => b.classList.remove('isActive'));
    btn.classList.add('isActive');
  });
});

const firstThumb = document.querySelector('.stayThumb');
if (firstThumb) firstThumb.classList.add('isActive');

async function ldSubscribe(formEl, opts = {}) {
  const emailEl = formEl.querySelector('input[type="email"]');
  const buttonEl = formEl.querySelector('button[type="submit"], input[type="submit"]');
  const statusEl = formEl.querySelector('[data-subscribe-status]');

  const email = (emailEl?.value || "").trim();

  const payload = {
    email,
    source: opts.source || formEl.getAttribute("data-source") || "unknown",
    offer_id: opts.offerId || formEl.getAttribute("data-offer-id") || "",
    page_url: location.pathname,
    user_agent: navigator.userAgent,
    consent_text: opts.consentText || formEl.getAttribute("data-consent-text") || "",
    consent_version: opts.consentVersion || formEl.getAttribute("data-consent-version") || "v1"
  };

const API_BASE =
    (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      ? "https://www.thelakesincumbria.co.uk"
      : "";

  // Basic validation
  if (!email || !email.includes("@")) {
    if (statusEl) statusEl.textContent = "Please enter a valid email.";
    return;
  }
  if (!payload.consent_text) {
    if (statusEl) statusEl.textContent = "Consent text missing (site config).";
    return;
  }

  // Button state to prevent double clicks
  const oldBtnText = buttonEl ? (buttonEl.textContent || buttonEl.value) : "";
  if (buttonEl) {
    buttonEl.disabled = true;
    if ("textContent" in buttonEl) buttonEl.textContent = "Submitting…";
    else buttonEl.value = "Submitting…";
  }
  if (statusEl) statusEl.textContent = "Working…";

  try {
    const res = await fetch(API_BASE + "/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    // Interpret responses from your Apps Script
    if (data.ok) {
      if (data.status === "pending") {
        if (statusEl) statusEl.textContent = "Check your email to confirm (including spam/junk).";
      } else if (data.status === "already_active") {
        if (data.offer_status === "sent") {
          if (statusEl) statusEl.textContent = "You’re already subscribed — we’ve sent your guide.";
        } else {
          if (statusEl) statusEl.textContent = "You’re already subscribed — all set.";
        }
      } else {
        if (statusEl) statusEl.textContent = data.message || "Done.";
      }
    } else {
      if (statusEl) statusEl.textContent = data.message || "Something went wrong.";
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = "Network error. Please try again.";
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      if ("textContent" in buttonEl) buttonEl.textContent = oldBtnText;
      else buttonEl.value = oldBtnText;
    }
  }
}
