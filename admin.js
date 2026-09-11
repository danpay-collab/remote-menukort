const $ = (id) => document.getElementById(id);
const REGIONS = ["Nordjylland", "Midtjylland", "Sønderjylland", "Fyn", "Sjælland", "Lolland-Falster", "Bornholm"];
let db = null;
let currentId = null;
let items = [];
let sections = [];
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

async function geocode(zip, city, address) {
  const q = [address, zip, city, "Danmark"].filter(Boolean).join(", ");
  if (!q.replace("Danmark", "").trim()) return null;
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=dk&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  const arr = await res.json();
  if (!arr || !arr[0]) return null;
  return { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
}

function drawItems() {
  const box = $("items");
  if (!box) return;
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
  $("ezip").value = c.zip || "";
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
      zip: $("czip") ? $("czip").value : "",
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
function paintStudio() {
  const board = $("scols");
  board.innerHTML = "";
  sections.forEach((sec, si) => {
    const col = document.createElement("div");
    col.className = "col-card";
    col.innerHTML = `<input class="col-title" placeholder="BURGERS / PIZZA" /><div class="col-items"></div><button type="button" class="ghost" data-delcol>Fjern kolonne</button>`;
    col.querySelector(".col-title").value = sec.title || "";
    col.querySelector(".col-title").addEventListener("input", (e) => { sections[si].title = e.target.value; });
    col.querySelector("[data-delcol]").addEventListener("click", () => {
      sections.splice(si, 1);
      paintStudio();
    });
    const box = col.querySelector(".col-items");
    (sec.items || []).forEach((it, ii) => {
      const row = document.createElement("div");
      row.className = "prod";
      row.innerHTML = `
        <div class="prod-line">
          <input class="num" placeholder="nr" />
          <input class="pname" placeholder="Produkt" />
          <input class="pprice" placeholder="pris" />
        </div>
        <input class="pdesc" placeholder="Beskrivelse" />
        <div class="prod-btns">
          <button type="button" data-add>+</button>
          <button type="button" data-del>−</button>
        </div>`;
      row.querySelector(".num").value = it.num || "";
      row.querySelector(".pname").value = it.name || "";
      row.querySelector(".pprice").value = it.price || "";
      row.querySelector(".pdesc").value = it.desc || "";
      row.querySelector(".num").addEventListener("input", (e) => { sections[si].items[ii].num = e.target.value; });
      row.querySelector(".pname").addEventListener("input", (e) => { sections[si].items[ii].name = e.target.value; });
      row.querySelector(".pprice").addEventListener("input", (e) => { sections[si].items[ii].price = e.target.value; });
      row.querySelector(".pdesc").addEventListener("input", (e) => { sections[si].items[ii].desc = e.target.value; });
      row.querySelector("[data-add]").addEventListener("click", () => {
        sections[si].items.splice(ii + 1, 0, { num: "", name: "", desc: "", price: "" });
        paintStudio();
      });
      row.querySelector("[data-del]").addEventListener("click", () => {
        sections[si].items.splice(ii, 1);
        paintStudio();
      });
      box.appendChild(row);
    });
    board.appendChild(col);
  });
}

async function openStudio() {
  if (!currentId || !db) return;
  const snap = await db.collection("customers").doc(currentId).get();
  const c = snap.exists ? snap.data() : {};
  if (c.sections && c.sections.length) {
    sections = JSON.parse(JSON.stringify(c.sections));
  } else {
    sections = [{ title: "BURGERS", items: [{ num: "1", name: "", desc: "", price: "" }] }];
  }
  $("studio").classList.remove("hidden");
  $("stitle").textContent = c.name || currentId;
  paintStudio();
}

$("add").addEventListener("click", openStudio);
$("saddcol").addEventListener("click", () => {
  sections.push({ title: "", items: [{ num: "", name: "", desc: "", price: "" }] });
  paintStudio();
});
$("sclose").addEventListener("click", () => $("studio").classList.add("hidden"));
$("ssave").addEventListener("click", async () => {
  if (!db || !currentId) return;
  items = [];
  sections.forEach((s) => (s.items || []).forEach((it) => items.push({ ...it, visible: true })));
  try {
    await db.collection("customers").doc(currentId).set({
      sections,
      items,
      venue: $("venue").value || $("ename").value || "Menukort",
    }, { merge: true });
    $("studio").classList.add("hidden");
    alert("Sendt til TV. Genindlæs skærmen.");
  } catch (err) {
    alert("Kunne ikke sende: " + err.message);
  }
});
$("save").addEventListener("click", async () => {
  if (!db || !currentId) {
    alert("Ingen kunde er valgt.");
    return;
  }
  $("msg").textContent = "Gemmer…";
  try {
    const venue = $("venue").value || $("ename").value || "Menukort";
    const zip = $("ezip") ? $("ezip").value : "";
    const city = $("ecity").value;
    const address = $("eaddr").value;
    const pos = await geocode(zip, city, address);
    const payload = {
      name: $("ename").value,
      address,
      zip,
      city,
      region: $("eregion").value,
      screenCount: Number($("escreens").value || 1),
      phone: $("ephone").value,
      venue: venue,
      ticker: $("ticker").value,
      footerNote: $("footerNote").value,
      items: items || [],
    };
    if (pos) {
      payload.lat = pos.lat;
      payload.lng = pos.lng;
    }
    await db.collection("customers").doc(currentId).set(payload, { merge: true });
    $("msg").textContent = "Gemt og sendt.";
    alert("Gemt. Genindlæs TV-siden hvis den ikke skifter med det samme.");
  } catch (err) {
    $("msg").textContent = "Fejl: " + err.message;
    alert("Kunne ikke gemme: " + err.message);
  }
});

start();
