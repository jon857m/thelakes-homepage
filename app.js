const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const menuBtn = document.getElementById("menuBtn");
const mobileNav = document.getElementById("mobileNav");
menuBtn?.addEventListener("click", () => {
  const isHidden = mobileNav.hasAttribute("hidden");
  if (isHidden) mobileNav.removeAttribute("hidden");
  else mobileNav.setAttribute("hidden", "");
});

const SIGNUP_ENDPOINT = "https://script.google.com/macros/s/AKfycbz8IcuYG6IdA8qYab1gbSqnPL5ctuNr3NgLvD1e0_fE7RfuQyWKNw7xF6JuFVQbs8ix/exec";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signupForm");
  const note = document.getElementById("signupMsg");
  const btn  = document.getElementById("signupBtn");
  const emailInput = document.getElementById("email");

  if (!form || !note || !btn || !emailInput) {
    console.log("Signup form elements missing");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    if (!email) return;

    btn.disabled = true;
    btn.textContent = "Sending…";
    note.textContent = "Submitting…";

    try {
      const r = await fetch(SIGNUP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          source: "get-updates",
          ua: navigator.userAgent
        })
      });

      const data = await r.json();

      note.textContent = data.message || "Please check your email to verify.";
      if (data.ok) {
        form.reset();
        btn.textContent = "Sent ✓";
      } else {
        btn.disabled = false;
        btn.textContent = "Notify me";
      }

    } catch (err) {
      console.error(err);
      note.textContent = "Sorry — something went wrong. Please try again.";
      btn.disabled = false;
      btn.textContent = "Notify me";
    }
  });
});
