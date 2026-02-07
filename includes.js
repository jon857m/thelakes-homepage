async function loadPartial(mountId, url) {
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);

  mount.innerHTML = await res.text();
}

(async function initPartials() {
  try {
    await loadPartial("siteHeader", "/partials/header.html");
    await loadPartial("siteFooter", "/partials/footer.html");

    // Let app.js know the DOM now contains the header/footer
    window.dispatchEvent(new Event("partials:loaded"));
  } catch (err) {
    console.error(err);
  }
})();
