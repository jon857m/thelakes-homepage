const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const menuBtn = document.getElementById("menuBtn");
const mobileNav = document.getElementById("mobileNav");
menuBtn?.addEventListener("click", () => {
  const isHidden = mobileNav.hasAttribute("hidden");
  if (isHidden) mobileNav.removeAttribute("hidden");
  else mobileNav.setAttribute("hidden", "");
});

const form = document.getElementById("signupForm");
const note = document.getElementById("formNote");
const btn = document.getElementById("signupBtn");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

const email = (document.getElementById("email").value || "").trim();
const consent = !!document.getElementById("consent")?.checked;

if (!email) {
  note.textContent = "Please enter an email address.";
  return;
}

if (!consent) {
  note.textContent = "Please tick the box to agree to receive emails.";
  return;
}

try {
  btn.disabled = true;
  btn.textContent = "Sending…";

  const r = await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, consent: true, source: "homepage" })
  });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data.ok) {
      note.textContent = "Sorry — something went wrong. Please try again in a minute.";
      btn.disabled = false;
      btn.textContent = "Notify me";
      return;
    }

    note.textContent = "Thanks — you’re on the list ✅";
    form.reset();
    btn.textContent = "Added";
  } catch (err) {
    note.textContent = "Sorry — something went wrong. Please try again in a minute.";
    btn.disabled = false;
    btn.textContent = "Notify me";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("menuToggle");
  const nav = document.getElementById("mobileNav");

  if (!btn || !nav) return;

  btn.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(isOpen));
  });
});