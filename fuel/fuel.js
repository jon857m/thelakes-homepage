(() => {
  const btnMyLoc = document.getElementById("btnMyLoc");
  const btnSearch = document.getElementById("btnSearch");
  const fuelTypeEl = document.getElementById("fuelType");
  const radiusEl = document.getElementById("radiusKm");
  const statusEl = document.getElementById("status");
  const listPrice = document.getElementById("listPrice");
  const listDist = document.getElementById("listDist");

  let userLat = null;
  let userLon = null;

  function setStatus(msg) { statusEl.textContent = msg; }

  btnMyLoc.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Geolocation not supported on this device.");
      return;
    }
    setStatus("Requesting location permission…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLon = pos.coords.longitude;
        btnSearch.disabled = false;
        setStatus(`Location set: ${userLat.toFixed(5)}, ${userLon.toFixed(5)} — now tap Search.`);
      },
      (err) => {
        setStatus(`Location failed: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });

  btnSearch.addEventListener("click", async () => {
    if (userLat == null || userLon == null) return;

    const fuel_type = fuelTypeEl.value;
    const radius_km = radiusEl.value;

    setStatus("Fetching stations…");
    listPrice.innerHTML = "";
    listDist.innerHTML = "";

    try {
      const url = `/api/fuel/search?lat=${encodeURIComponent(userLat)}&lon=${encodeURIComponent(userLon)}&radius_km=${encodeURIComponent(radius_km)}&fuel_type=${encodeURIComponent(fuel_type)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        setStatus(`Error: ${data.error || "Unknown error"}`);
        if (data.upstream_body_snippet) {
          listPrice.innerHTML = `<pre class="codeBlock">${escapeHtml(data.upstream_body_snippet)}</pre>`;
        }
        return;
      }

      setStatus(`Found ${data.count} stations within ${data.radius_km} km.`);

      renderList(listPrice, data.byPrice, { mode: "price" });
      renderList(listDist, data.byDistance, { mode: "dist" });

    } catch (e) {
      setStatus(`Fetch failed: ${e.message}`);
    }
  });

  function renderList(root, arr, { mode }) {
    if (!arr || !arr.length) {
      root.innerHTML = `<p class="formNote">No results.</p>`;
      return;
    }

    root.innerHTML = arr.slice(0, 20).map(s => {
      const p = (s.price == null) ? "—" : `${Number(s.price).toFixed(3)}`
      const d = `${Number(s.distance_km).toFixed(2)} km`;

      const dest = `${s.lat},${s.lon}`;
      const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${(userLat && userLon) ? `&origin=${encodeURIComponent(userLat + "," + userLon)}` : ""}`;

      return `
        <div class="resultRow">
          <div class="resultMain">
            <div class="resultTitle">${escapeHtml(s.name || "Station")}</div>
            <div class="resultMeta">
              ${mode === "price" ? `Price: <strong>${p}</strong> · Distance: ${d}` : `Distance: <strong>${d}</strong> · Price: ${p}`}
              ${s.postcode ? ` · ${escapeHtml(s.postcode)}` : ""}
            </div>
          </div>
          <a class="btn btn--small" href="${gmaps}" target="_blank" rel="noopener">Directions</a>
        </div>
      `;
    }).join("");
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[s]));
  }
})();
