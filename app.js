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
  const forms = document.querySelectorAll("form.js-signup-form");
  forms.forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const input = form.querySelector('input[name="email"]');
      const note =
        form.querySelector(".formNote") ||
        form.parentElement?.querySelector(".formNote");
      const btn = form.querySelector('button[type="submit"]');
      const consent = !!form.querySelector('input[name="consent"]')?.checked;

      const email = (input?.value || "").trim();
      if (!email) return;

      const source = form.getAttribute("data-source") || "unknown";

      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Sending…";
        }

        const r = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, source, consent })
        });

        const data = await r.json().catch(() => ({}));

        if (!r.ok || !data.ok) {
          if (note) note.textContent = "Sorry — something went wrong. Please try again in a minute.";
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Notify me";
          }
          return;
        }

        if (note) note.textContent = "Thanks — you’re on the list ✅";
        form.reset();
        if (btn) btn.textContent = "Added";
      } catch {
        if (note) note.textContent = "Sorry — something went wrong. Please try again in a minute.";
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Notify me";
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