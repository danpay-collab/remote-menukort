const $ = (id) => document.getElementById(id);
const REGIONS = ["Nordjylland", "Midtjylland", "Sønderjylland", "Fyn", "Sjælland", "Lolland-Falster", "Bornholm"];
let db = null;
let currentId = null;
let items = [];
let map, markers = {};
let placeMode = false;

const SEED = {
  "38765432": {
    name: "Test — Fyn", city: "Odense", address: "Albanigade 1", region: "Fyn",
    lat: 55.403, lng: 10.402, phone: "", screenCount: 1,
    venue: "Dagens kort", ticker: "Testskærm på Fyn", footerNote: "",
    items: [{ name: "Testburger", desc: "Ret mig", price: "89", visible: true }]
  },
  "11223344": {
    name: "Nordkysten Café", city: "Aalborg", address: "Boulevarden 10", region: "Nordjylland",
    lat: 57.048, lng: 9.919, phone: "", screenCount: 2,
    venue: "Dagens kort", ticker: "Velkommen til Aalborg", footerNote: "",
    items: [{ name: "Classic Burger", desc: "Cheddar", price: "129", visible: true }]
  },
  "55667788": {
    name: "Havnegrill Aarhus", city: "Aarhus", address: "Havnegade 4", region: "Midtjylland",
    lat: 56.157, lng: 10.210, phone: "", screenCount: 1,
    venue: "Grillkort", ticker: "Dagens steak", footerNote: "",
    items: [{ name: "Bøfsandwich", desc: "", price: "99", visible: true }]
  },
  "99887766": {
    name: "Vesterhavet", city: "Esbjerg", address: "Torvet 2", region: "Sønderjylland",
    lat: 55.477, lng: 8.452, phone: "", screenCount: 1,
    venue: "Fisk", ticker: "Dagens fangst", footerNote: "",
    items: [{ name: "Fiskefilet", desc: "", price: "119", visible: true }]
  },
  "44332211": {
    name: "Kødbyen Bord", city: "København", address: "Flæsketorvet 12", region: "Sjælland",
    lat: 55.676, lng: 12.568, phone: "", screenCount: 3,
    venue: "Aftenkort", ticker: "Velkommen til Kødbyen", footerNote: "",
    items: [{ name: "Smashburger", desc: "", price: "139", visible: true }]
  }
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
    const raw = screens[k] && screens[k].lastSeen;
    const t = raw && raw.toMillis ? raw.toMillis() : (raw ? new Date(raw).getTime() : 0);
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
  map.on("click", async (e) => {
    if (!placeMode || !db || !currentId) return;
    placeMode = false;
    $("placehint").textContent = "Gemmer sted…";
    await db.collection("customers").doc(currentId).set({
      lat: e.latlng.lat,
      lng: e.latlng.lng,
    }, { merge: true });
    $("placehint").textContent = "Kunden er sat på kortet.";
  });
}

function paint(docs) {
  const list = $("list");
  list.innerHTML = "";
  REGIONS.forEach((region) => {
    const group = docs.filter((c) => (c.region || "") === region);
    if (!group.length) return;
    const h = document.createElement("div");
    h.className = "region";
    h.textContent = region + " (" + group.length + ")";
    list.appendChild(h);
    group.sort((a, b) => (a.name || "").localeCompare(b.name || "", "da"));
    group.forEach(addRow);
  });
  const other = docs.filter((c) => !REGIONS.includes(c.region));
  if (other.length) {
    const h = document.createElement("div");
    h.className = "region";
    h.textContent = "Uden landsdel";
    list.appendChild(h);
    other.forEach(addRow);
  }
  docs.forEach((c) => {
    const st = statusOf(c);
    if (Number(c.lat) && Number(c.lng)) {
      if (markers[c.id]) {
        markers[c.id].setLatLng([c.lat, c.lng]);
        markers[c.id].setStyle({ color: color(st), fillColor: color(st) });
      } else {
        const m = L.circleMarker([c.lat, c.lng], {
          radius: 10, color: color(st), fillColor: color(st), fillOpacity: 0.95, weight: 2,
        }).addTo(map);
        m.bindTooltip((c.name || "") + " · CVR " + c.id);
        m.on("click", () => openCustomer(c.id));
        markers[c.id] = m;
      }
    }
  });
}

function addRow(c) {
  const st = statusOf(c);
  const row = document.createElement("button");
  row.type = "button";
  row.className = "cust";
  row.innerHTML = `<span class="dot" style="background:${color(st)}"></span><span><strong></strong><br><small></small></span>`;
  row.querySelector("strong").textContent = c.name || c.id;
  row.querySelector("small").textContent = "CVR " + c.id + " · " + (c.city || "") + " · " + (c.screenCount || 1) + " skærm(e)";
  row.addEventListener("click", () => openCustomer(c.id));
  $("list").appendChild(row);
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
  $("create").classList.add("hidden");
  const snap = await db.collection("customers").doc(id).get();
  if (!snap.exists) return;
  const c = snap.data();
  $("panel").classList.remove("hidden");
  $("pname").textContent = c.name || id;
  $("pcity").textContent = "CVR " + id;
  $("ename").value = c.name || "";
  $("eaddr").value = c.address || "";
  $("ecity").value = c.city || "";
  $("eregion").value = REGIONS.includes(c.region) ? c.region : "Fyn";
  $("escreens").value = c.screenCount || 1;
  $("ephone").value = c.phone || "";
  $("venue").value = c.venue || "";
  $("ticker").value = c.ticker || "";
  $("footerNote").value = c.footerNote || "";
  items = c.items || [];
  drawItems();
  const prev = $("preview");
  if (prev) {
    const rows = (items || []).map((i) => (i.name || "") + "  " + (i.price ? i.price + ",-" : "")).join("<br>");
    prev.innerHTML = "<strong>På TV nu</strong><br>" + (c.venue || "") + "<br>" + (c.ticker || "") + "<br>" + (rows || "(ingen retter endnu)");
  }
  const base = location.origin + location.pathname.replace(/admin.html.*/, "");
  $("tvurl").textContent = "TV: " + base + "display.html?id=" + id;
  const box = $("pscreens");
  const screens = c.screens || {};
  const keys = Object.keys(screens);
  if (!keys.length) {
    box.textContent = "Ingen skærm online. Åbn TV-adressen med CVR som id.";
  } else {
    box.innerHTML = "";
    keys.forEach((sid) => {
      const s = screens[sid];
      const raw = s.lastSeen;
      const t = raw && raw.toMillis ? raw.toMillis() : (raw ? new Date(raw).getTime() : 0);
      const ok = Date.now() - t < 45000;
      const row = document.createElement("div");
      row.className = "screen-row";
      row.innerHTML = `<span><span class="dot ${ok ? "ok" : "bad"}"></span>${s.label || sid}</span><span>${ok ? "kører" : "tavs"} · ${ago(s.lastSeen)}</span>`;
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
    paint(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    if (currentId) openCustomer(currentId);
  });
}

$("placebtn").addEventListener("click", () => {
  if (!currentId) return;
  placeMode = true;
  $("placehint").textContent = "Klik ét sted på kortet — der sættes kunden.";
});
$("newbtn").addEventListener("click", () => {
  $("panel").classList.add("hidden");
  $("create").classList.remove("hidden");
});
$("closecreate").addEventListener("click", () => $("create").classList.add("hidden"));
$("createbtn").addEventListener("click", async () => {
  if (!db) {
    $("cmsg").textContent = "Ikke koblet på databasen.";
    return;
  }
  let cvr = ($("cvr").value || "").trim();
  if (!cvr) cvr = "kunde-" + Date.now();
  $("cmsg").textContent = "Gemmer…";
  try {
    await db.collection("customers").doc(cvr).set({
      name: $("cname").value || "Ny kunde",
      address: $("caddr").value || "",
      city: $("ccity").value || "",
      region: $("cregion").value,
      screenCount: Number($("cscreens").value || 1),
      phone: $("cphone").value || "",
      lat: null,
      lng: null,
      venue: $("cname").value || "Dagens kort",
      ticker: "",
      footerNote: "",
      items: [],
      screens: {},
    }, { merge: true });
    $("cmsg").textContent = "Gemt. TV: display.html?id=" + cvr;
    alert("Kunden er gemt: " + cvr);
  } catch (err) {
    $("cmsg").textContent = "Kunne ikke gemme: " + err.message;
    alert("Kunne ikke gemme: " + err.message);
  }
});

$("seed").addEventListener("click", async () => {
  if (!db) { alert("Sæt Firebase-nøgler først."); return; }
  for (const [id, data] of Object.entries(SEED)) {
    await db.collection("customers").doc(id).set({ ...data, screens: {} }, { merge: true });
  }
  alert("Testkunder med CVR ligger i databasen.");
});

$("delcust").addEventListener("click", async () => {
  if (!db || !currentId) return;
  if (!confirm("Slet kunden " + currentId + "?")) return;
  await db.collection("customers").doc(currentId).delete();
  if (markers[currentId]) {
    map.removeLayer(markers[currentId]);
    delete markers[currentId];
  }
  currentId = null;
  $("panel").classList.add("hidden");
});
$("close").addEventListener("click", () => $("panel").classList.add("hidden"));
$("add").addEventListener("click", () => {
  items.push({ name: "Ny ret", desc: "", price: "0", visible: true });
  drawItems();
});
$("save").addEventListener("click", async () => {
  if (!db || !currentId) return;
  await db.collection("customers").doc(currentId).set({
    name: $("ename").value,
    address: $("eaddr").value,
    city: $("ecity").value,
    region: $("eregion").value,
    screenCount: Number($("escreens").value || 1),
    phone: $("ephone").value,
    venue: $("venue").value,
    ticker: $("ticker").value,
    footerNote: $("footerNote").value,
    items,
  }, { merge: true });
  $("msg").textContent = "Sendt til skærmen.";
});

start();
