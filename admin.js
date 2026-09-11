let currentId = null;
let items = [];
let map, markers = {};

const $ = (id) => document.getElementById(id);

function color(status) {
  if (status === "ok") return "#3dba7a";
  if (status === "warn") return "#e0a106";
  if (status === "down") return "#d4452a";
  return "#8a8176";
}

function ago(iso) {
  if (!iso) return "aldrig set";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 20) return "lige nu";
  if (s < 120) return s + " sek. siden";
  return Math.round(s / 60) + " min. siden";
}

async function loadMapData() {
  const res = await fetch("/api/customers");
  const data = await res.json();
  const list = $("list");
  list.innerHTML = "";
  data.customers.forEach((c) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cust";
    row.innerHTML = `<span class="dot" style="background:${color(c.status)}"></span><span><strong></strong><br><small></small></span>`;
    row.querySelector("strong").textContent = c.name;
    row.querySelector("small").textContent = c.city;
    row.addEventListener("click", () => openCustomer(c.id));
    list.appendChild(row);

    if (markers[c.id]) {
      markers[c.id].setStyle({ color: color(c.status), fillColor: color(c.status) });
    } else if (c.lat && c.lng) {
      const m = L.circleMarker([c.lat, c.lng], {
        radius: 10,
        color: color(c.status),
        fillColor: color(c.status),
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(map);
      m.bindTooltip(c.name);
      m.on("click", () => openCustomer(c.id));
      markers[c.id] = m;
    }
  });
}

function drawItems() {
  const box = $("items");
  box.innerHTML = "";
  items.forEach((item, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "item-edit";
    wrap.innerHTML = `
      <input data-k="name" placeholder="Navn" />
      <input data-k="desc" placeholder="Beskrivelse" />
      <input data-k="price" placeholder="Pris" />
      <button type="button" class="tiny" data-del>Fjern</button>
    `;
    wrap.querySelector('[data-k="name"]').value = item.name || "";
    wrap.querySelector('[data-k="desc"]').value = item.desc || "";
    wrap.querySelector('[data-k="price"]').value = item.price || "";
    wrap.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => { items[idx][inp.dataset.k] = inp.value; });
    });
    wrap.querySelector("[data-del]").addEventListener("click", () => {
      items.splice(idx, 1);
      drawItems();
    });
    box.appendChild(wrap);
  });
}

async function openCustomer(id) {
  currentId = id;
  const res = await fetch("/api/customer?id=" + encodeURIComponent(id));
  const c = await res.json();
  $("panel").classList.remove("hidden");
  $("pname").textContent = c.name;
  $("pcity").textContent = c.city || "";
  $("venue").value = c.venue || "";
  $("ticker").value = c.ticker || "";
  $("footerNote").value = c.footerNote || "";
  items = c.items || [];
  drawItems();
  const origin = location.origin;
  $("tvurl").textContent = "TV-adresse: " + origin + "/display.html?id=" + id;

  const box = $("pscreens");
  const screens = c.screens || {};
  const keys = Object.keys(screens);
  if (!keys.length) {
    box.textContent = "Ingen skærm online endnu. Åbn TV-adressen i TV-browseren.";
  } else {
    box.innerHTML = "";
    keys.forEach((sid) => {
      const s = screens[sid];
      const age = Date.now() - new Date(s.lastSeen).getTime();
      const ok = age < 45000;
      const row = document.createElement("div");
      row.className = "screen-row";
      row.innerHTML = `<span><span class="dot ${ok ? "ok" : "bad"}"></span>${s.label || sid}</span><span>${ok ? "kører" : "tavs"} · ${ago(s.lastSeen)}</span>`;
      box.appendChild(row);
    });
  }
}

$("close").addEventListener("click", () => $("panel").classList.add("hidden"));
$("add").addEventListener("click", () => {
  items.push({ id: String(Date.now()), name: "Ny ret", desc: "", price: "0", visible: true });
  drawItems();
});
$("save").addEventListener("click", async () => {
  if (!currentId) return;
  const res = await fetch("/api/customer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: currentId,
      venue: $("venue").value,
      ticker: $("ticker").value,
      footerNote: $("footerNote").value,
      items,
    }),
  });
  $("msg").textContent = res.ok ? "Sendt. Skærmen opdaterer om få sekunder." : "Kunne ikke sende.";
});

map = L.map("map").setView([56.1, 10.4], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap-bidragsydere",
}).addTo(map);

loadMapData();
setInterval(loadMapData, 8000);
setInterval(() => { if (currentId) openCustomer(currentId); }, 8000);
