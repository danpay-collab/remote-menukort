const $ = (id) => document.getElementById(id);
let db = null;
let currentId = null;
let items = [];
let map, markers = {};

const SEED = {
  aalborg: { name: "Nordkysten Café", city: "Aalborg", lat: 57.048, lng: 9.919, venue: "Dagens kort", ticker: "Velkommen til Aalborg", footerNote: "", items: [{ name: "Classic Burger", desc: "Cheddar, salat", price: "129", visible: true }] },
  aarhus: { name: "Havnegrill Aarhus", city: "Aarhus", lat: 56.157, lng: 10.210, venue: "Grillkort", ticker: "Dagens steak", footerNote: "", items: [{ name: "Bøfsandwich", desc: "Bløde løg", price: "99", visible: true }] },
  esbjerg: { name: "Vesterhavet", city: "Esbjerg", lat: 55.477, lng: 8.452, venue: "Fisk", ticker: "Dagens fangst", footerNote: "", items: [{ name: "Fiskefilet", desc: "Remoulade", price: "119", visible: true }] },
  koebenhavn: { name: "Kødbyen Bord", city: "København", lat: 55.676, lng: 12.568, venue: "Aftenkort", ticker: "Velkommen til Kødbyen", footerNote: "", items: [{ name: "Smashburger", desc: "Dobbelt bøf", price: "139", visible: true }] },
  odense: { name: "Test — Fyn", city: "Odense", lat: 55.403, lng: 10.402, venue: "Dagens kort", ticker: "Testskærm på Fyn • ret prisen her", footerNote: "Åbn display.html?id=odense på TV", items: [{ name: "Testburger", desc: "Ret mig", price: "89", visible: true }, { name: "Dagens ret", desc: "", price: "129", visible: true }] }
};

function color(status) {
  if (status === "ok") return "#3dba7a";
  if (status === "warn") return "#e0a106";
  if (status === "down") return "#d4452a";
  return "#8a8176";
}

function statusOf(c) {
  const screens = c.screens || {};
  const keys = Object.keys(screens);
  if (!keys.length) return "idle";
  const now = Date.now();
  const flags = keys.map((k) => {
    const t = screens[k] && screens[k].lastSeen && screens[k].lastSeen.toMillis
      ? screens[k].lastSeen.toMillis()
      : (screens[k] && screens[k].lastSeen ? new Date(screens[k].lastSeen).getTime() : 0);
    return now - t < 45000;
  });
  if (flags.every(Boolean)) return "ok";
  if (flags.some(Boolean)) return "warn";
  return "down";
}

function ago(ts) {
  if (!ts) return "aldrig set";
  const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 20) return "lige nu";
  if (s < 120) return s + " sek. siden";
  return Math.round(s / 60) + " min. siden";
}

function initMap() {
  map = L.map("map").setView([56.1, 10.4], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap-bidragsydere",
  }).addTo(map);
}

function paint(docs) {
  const list = $("list");
  list.innerHTML = "";
  docs.forEach((c) => {
    const st = statusOf(c);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "cust";
    row.innerHTML = `<span class="dot" style="background:${color(st)}"></span><span><strong></strong><br><small></small></span>`;
    row.querySelector("strong").textContent = c.name || c.id;
    row.querySelector("small").textContent = c.city || "";
    row.addEventListener("click", () => openCustomer(c.id));
    list.appendChild(row);
    if (c.lat && c.lng) {
      if (markers[c.id]) {
        markers[c.id].setLatLng([c.lat, c.lng]);
        markers[c.id].setStyle({ color: color(st), fillColor: color(st) });
      } else {
        const m = L.circleMarker([c.lat, c.lng], {
          radius: 10, color: color(st), fillColor: color(st), fillOpacity: 0.95, weight: 2,
        }).addTo(map);
        m.bindTooltip(c.name || c.id);
        m.on("click", () => openCustomer(c.id));
        markers[c.id] = m;
      }
    }
  });
}

function drawItems() {
  const box = $("items");
  box.innerHTML = "";
  items.forEach((item, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "item-edit";
    wrap.innerHTML = `<input data-k="name" placeholder="Navn" /><input data-k="desc" placeholder="Beskrivelse" /><input data-k="price" placeholder="Pris" /><button type="button" class="tiny" data-del>Fjern</button>`;
    wrap.querySelector('[data-k="name"]').value = item.name || "";
    wrap.querySelector('[data-k="desc"]').value = item.desc || "";
    wrap.querySelector('[data-k="price"]').value = item.price || "";
    wrap.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => { items[idx][inp.dataset.k] = inp.value; });
    });
    wrap.querySelector("[data-del]").addEventListener("click", () => { items.splice(idx, 1); drawItems(); });
    box.appendChild(wrap);
  });
}

async function openCustomer(id) {
  currentId = id;
  const snap = await db.collection("customers").doc(id).get();
  if (!snap.exists) return;
  const c = snap.data();
  $("panel").classList.remove("hidden");
  $("pname").textContent = c.name || id;
  $("pcity").textContent = c.city || "";
  $("venue").value = c.venue || "";
  $("ticker").value = c.ticker || "";
  $("footerNote").value = c.footerNote || "";
  items = c.items || [];
  drawItems();
  $("tvurl").textContent = "TV: " + location.origin + location.pathname.replace(/admin\.html.*/, "") + "display.html?id=" + id;

  const box = $("pscreens");
  const screens = c.screens || {};
  const keys = Object.keys(screens);
  if (!keys.length) {
    box.textContent = "Ingen skærm online endnu. Åbn TV-adressen i TV-browseren.";
  } else {
    box.innerHTML = "";
    keys.forEach((sid) => {
      const s = screens[sid];
      const ok = s.lastSeen && (Date.now() - (s.lastSeen.toMillis ? s.lastSeen.toMillis() : new Date(s.lastSeen).getTime()) < 45000);
      const row = document.createElement("div");
      row.className = "screen-row";
      row.innerHTML = `<span><span class="dot ${ok ? "ok" : "bad"}"></span>${(s.label || sid)}</span><span>${ok ? "kører" : "tavs"} · ${ago(s.lastSeen)}</span>`;
      box.appendChild(row);
    });
  }
}

function start() {
  const cfg = window.firebaseConfig;
  if (!cfg || !cfg.apiKey || cfg.apiKey === "INDSÆT") {
    $("cfgwarn").classList.remove("hidden");
    initMap();
    return;
  }
  firebase.initializeApp(cfg);
  db = firebase.firestore();
  initMap();
  db.collection("customers").onSnapshot((snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    paint(docs);
    if (currentId) openCustomer(currentId);
  });
}

$("seed").addEventListener("click", async () => {
  if (!db) { alert("Sæt Firebase-nøgler i firebase-config.js først."); return; }
  for (const [id, data] of Object.entries(SEED)) {
    await db.collection("customers").doc(id).set({ ...data, screens: {} }, { merge: true });
  }
  alert("Testkunder ligger i Firestore nu.");
});

$("close").addEventListener("click", () => $("panel").classList.add("hidden"));
$("add").addEventListener("click", () => {
  items.push({ name: "Ny ret", desc: "", price: "0", visible: true });
  drawItems();
});
$("save").addEventListener("click", async () => {
  if (!db || !currentId) return;
  await db.collection("customers").doc(currentId).set({
    venue: $("venue").value,
    ticker: $("ticker").value,
    footerNote: $("footerNote").value,
    items,
  }, { merge: true });
  $("msg").textContent = "Sendt til skærmen.";
});

start();
