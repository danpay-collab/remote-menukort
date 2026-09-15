const $ = (id) => document.getElementById(id);
const REGIONS = ["Nordjylland", "Midtjylland", "Sønderjylland", "Fyn", "Sjælland", "Lolland-Falster", "Bornholm"];
const KUNDEMODE = new URLSearchParams(location.search).get("mode") === "kunde";
let db = null;
let currentId = null;
let items = [];
let sections = [];
let boardsByScreen = {};
const HOURDAYS = [
  ["man","Mandag"],["tir","Tirsdag"],["ons","Onsdag"],["tor","Torsdag"],
  ["fre","Fredag"],["lor","Lørdag"],["son","Søndag"]
];
let pendingHours = {};
function hourSummary(h) {
  h = h || {};
  const bits = HOURDAYS.map(function (d) {
    const x = h[d[0]] || {};
    if (x.closed) return d[1].slice(0,3) + " lukket";
    if (x.from || x.to) return d[1].slice(0,3) + " " + (x.from || "") + "-" + (x.to || "");
    return "";
  }).filter(Boolean);
  return bits.join(" · ") || "Ingen tider sat";
}
let activeScreen = "1";
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
  const dk = L.latLngBounds([[54.55, 8.05], [57.80, 15.25]]);
  map = L.map("map", {
    maxBounds: dk,
    minZoom: 7,
    maxZoom: 18,
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap-bidragsydere",
  }).addTo(map);
  map.fitBounds(dk);
  map.setMaxBounds(dk);
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
  const q = [address, zip, city].filter(Boolean).join(", ");
  if (!q.trim()) return null;
  try {
    const url = "https://api.dataforsyningen.dk/adgangsadresser?per_side=1&struktur=mini&srid=4326&q=" + encodeURIComponent(q);
    const res = await fetch(url);
    const arr = await res.json();
    if (arr && arr[0] && arr[0].y && arr[0].x) {
      return { lat: Number(arr[0].y), lng: Number(arr[0].x) };
    }
  } catch (e) {}
  if (String(zip) === "5485" || (city || "").toLowerCase() === "skamby") {
    return { lat: 55.5244, lng: 10.2763 };
  }
  return null;
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
  if ($("ews")) $("ews").value = c.wsUrl || "";
  $("ephone").value = c.phone || "";
  if ($("econtact")) $("econtact").value = c.contact || "";
  if ($("eemail")) $("eemail").value = c.email || "";
  $("venue").value = c.venue || "";
  $("ticker").value = c.ticker || "";
  if ($("etickon")) $("etickon").checked = !!c.showTicker;
  $("footerNote").value = c.footerNote || "";
  if ($("eallow")) $("eallow").checked = !!c.allowLogin;
  if ($("ekode")) $("ekode").value = c.kundeKode || "";
  pendingHours = c.hours || {};
  if ($("hoursum")) $("hoursum").textContent = hourSummary(pendingHours);
  if (typeof KUNDE !== "undefined" && KUNDE && !c.kundePinChosen && $("pindlg")) $("pindlg").classList.remove("hidden");
  items = c.items || [];
  drawItems();
  const prev = $("preview");
  if (prev) prev.remove();
  const base = location.origin + location.pathname.replace(/admin.html.*/, "");
  ensureCodes(c, id);
  $("tvurl").textContent = "Åbn på TV: " + base + "pair.html";
  const pc = $("paircodes");
  if (pc) {
    const list = c.screenSetup || [];
    pc.innerHTML = list.map(function(s){
      return "<div class=\"codepill\">Skærm " + s.id + " · <b>" + (s.code || "—") + "</b></div>";
    }).join("") || "<div class=\"codepill\">Ingen kode</div>";
  }
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
      row.className = "screen-row " + (ok ? "is-on" : "is-off");
      row.innerHTML = `<span class="dot ${ok ? "ok" : "bad"}"></span>Skærm ${sid} ${ok ? "kører" : "tavs"}`;
      box.appendChild(row);
    });
  }
}


if ($("hourbtn")) {
  $("hourbtn").addEventListener("click", function () {
    const box = $("hourrows");
    if (!box) return;
    box.innerHTML = "";
    HOURDAYS.forEach(function (d) {
      const x = pendingHours[d[0]] || { from: "16:00", to: "22:00", closed: false };
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:90px 90px 90px auto;gap:8px;align-items:center;margin:6px 0";
      row.innerHTML = "<span>" + d[1] + "</span>"
        + "<input type='time' data-h='" + d[0] + "' data-k='from' value='" + (x.from || "16:00") + "' />"
        + "<input type='time' data-h='" + d[0] + "' data-k='to' value='" + (x.to || "22:00") + "' />"
        + "<label class='tick'><input type='checkbox' data-h='" + d[0] + "' data-k='closed'" + (x.closed ? " checked" : "") + " /></label>";
      box.appendChild(row);
    });
    if ($("hourwiz")) $("hourwiz").classList.remove("hidden");
  });
}
if ($("hourcancel")) $("hourcancel").addEventListener("click", function () {
  if ($("hourwiz")) $("hourwiz").classList.add("hidden");
});
if ($("hoursave")) {
  $("hoursave").addEventListener("click", function () {
    pendingHours = {};
    document.querySelectorAll("#hourrows input").forEach(function (el) {
      const d = el.getAttribute("data-h");
      const k = el.getAttribute("data-k");
      if (!d) return;
      pendingHours[d] = pendingHours[d] || {};
      if (k === "closed") pendingHours[d].closed = el.checked;
      else pendingHours[d][k] = el.value;
    });
    if ($("hoursum")) $("hoursum").textContent = hourSummary(pendingHours);
    if ($("hourwiz")) $("hourwiz").classList.add("hidden");
  });
}



let currentAdminName = sessionStorage.getItem("adminName") || "";
function adminSlug(n) {
  return String(n || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "admin";
}
function paintAdminBar() {
  if (!db || !$("adminwho")) return;
  db.collection("admins").onSnapshot(function (snap) {
    const box = $("adminwho");
    box.innerHTML = "";
    snap.docs.forEach(function (d) {
      const a = d.data();
      const raw = a.lastSeen;
      const ts = raw && raw.toMillis ? raw.toMillis() : (raw ? new Date(raw).getTime() : 0);
      const on = Date.now() - ts < 45000;
      const b = document.createElement("span");
      b.className = "ab-chip " + (on ? "on" : "off");
      b.textContent = a.name || d.id;
      box.appendChild(b);
    });
  });
}
function beatAdmin() {
  if (!db || !currentAdminName) return;
  db.collection("admins").doc(adminSlug(currentAdminName)).set({
    name: currentAdminName,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
function gateAdmin() {
  const fallback = String(window.adminPin || "4821");
  if (document.getElementById("admingate")) return;
  const box = document.createElement("div");
  box.id = "admingate";
  box.style.cssText = "position:fixed;inset:0;background:#eceae6;z-index:9999;display:flex;align-items:center;justify-content:center;font-family:sans-serif";
  box.innerHTML = "<div style='background:#fff;padding:28px;border-radius:12px;width:min(380px,92vw);box-shadow:0 12px 40px rgba(0,0,0,.12)'>"
    + "<p style='margin:0;color:#666'>MenuLive</p><h2 style='margin:6px 0 16px'>Admin</h2>"
    + "<label style='display:block;font-size:14px'>Navn</label><input id='auser' style='width:100%;padding:10px;margin:4px 0 12px;box-sizing:border-box' />"
    + "<label style='display:block;font-size:14px'>Kode</label><input id='apin' type='password' style='width:100%;padding:10px;margin:4px 0 12px;box-sizing:border-box' />"
    + "<p class='muted' style='font-size:13px'>Forste gang: 4821. Vaelg derefter din egen kode.</p>"
    + "<label style='font-size:14px'><input type='checkbox' id='ahusk' /> Husk mig paa denne computer</label>"
    + "<p><button id='apgo' style='margin-top:12px;width:100%;padding:12px;background:#1b1916;color:#fff;border:0;border-radius:8px;font-weight:700'>Log ind</button></p></div>";
  document.body.appendChild(box);
  document.getElementById("apgo").onclick = async function () {
    const name = (document.getElementById("auser").value || "").trim();
    const k = document.getElementById("apin").value || "";
    if (!name) { alert("Skriv dit navn."); return; }
    const id = adminSlug(name);
    let pinChosen = false;
    let stored = "";
    try {
      const snap = await db.collection("admins").doc(id).get();
      if (snap.exists) {
        stored = snap.data().kode || "";
        pinChosen = !!snap.data().pinChosen;
      }
    } catch (e) {}
    if (!pinChosen) {
      if (k !== fallback && k !== stored) { alert("Forste gang er koden 4821."); return; }
      const ny = prompt("Vaelg din egen admin-kode (mindst 4 tegn):") || "";
      if (ny.length < 4) { alert("For kort."); return; }
      await db.collection("admins").doc(id).set({
        name: name,
        kode: ny,
        pinChosen: true,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (k !== stored) {
      alert("Forkert kode.");
      return;
    }
    currentAdminName = name;
    sessionStorage.setItem("adminOk", "1");
    sessionStorage.setItem("adminName", name);
    if (document.getElementById("ahusk").checked) {
      localStorage.setItem("adminOk", "1");
      localStorage.setItem("adminName", name);
    }
    location.reload();
  };
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
  const kid0 = new URLSearchParams(location.search).get("id") || "";
  const isKunde = new URLSearchParams(location.search).get("mode") === "kunde" && sessionStorage.getItem("kundeId") === kid0 && kid0;
  if (localStorage.getItem("adminOk") === "1") sessionStorage.setItem("adminOk", "1");
  if (!isKunde && sessionStorage.getItem("adminOk") !== "1") {
    gateAdmin();
    return;
  }
  if (KUNDEMODE) {
    applyKundeMode();
    const kid = new URLSearchParams(location.search).get("id") || sessionStorage.getItem("kundeId");
    if (kid) {
      openCustomer(kid).then(function () {
        if (new URLSearchParams(location.search).get("studio") === "1" && $("viewmenu")) $("viewmenu").click();
      });
    } else location.href = "kunde.html";
  } else {
    initMap();
    currentAdminName = sessionStorage.getItem("adminName") || localStorage.getItem("adminName") || currentAdminName;
    paintAdminBar();
    beatAdmin();
    setInterval(beatAdmin, 20000);
    db.collection("customers").onSnapshot((snap) => {
      paint(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }
}

$("placebtn").addEventListener("click", () => {
  if (!currentId) return;
  placeMode = true;
  $("placehint").textContent = "Klik ét sted på kortet — der sættes kunden.";
});
function makePairCode() {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
function ensureCodes(c, id) {
  const n = Number(c.screenCount || (c.tvScreens && c.tvScreens.length) || 1);
  let setup = Array.isArray(c.screenSetup) ? c.screenSetup.slice() : [];
  let changed = false;
  for (let i = 1; i <= n; i++) {
    let s = setup.find((x) => Number(x.id) === i);
    if (!s) {
      setup.push({ id: i, pxW: 1920, pxH: 1080, code: makePairCode() });
      changed = true;
    } else if (!s.code) {
      s.code = makePairCode();
      changed = true;
    }
  }
  c.screenSetup = setup;
  if (changed && db && id) {
    db.collection("customers").doc(id).set({ screenSetup: setup }, { merge: true });
    setup.forEach((s) => {
      if (s.code) db.collection("pairs").doc(s.code).set({ cvr: id, screen: String(s.id), name: c.name || "" });
    });
  }
}
function guessPx(model) {
  const m = String(model || "").toUpperCase();
  if (/65|75|55.*UHD|4K/.test(m)) return { w: 3840, h: 2160 };
  return { w: 1920, h: 1080 };
}
function paintCscr() {
  const n = Number($("cscreens") && $("cscreens").value) || 1;
  const box = $("cscrrows");
  if (!box) return;
  box.innerHTML = "";
  for (let i = 1; i <= n; i++) {
    const row = document.createElement("div");
    row.className = "scrline";
    row.innerHTML = `<span>Skærm ${i}</span>
      <input class="mod" placeholder="Samsung UE48…" />
      <input class="pw" type="number" value="1920" />
      <input class="ph" type="number" value="1080" />
      <input class="note" placeholder="Ved kassen" />
      <input class="code" readonly value="${makePairCode()}" />`;
    row.querySelector(".mod").addEventListener("change", (e) => {
      const g = guessPx(e.target.value);
      row.querySelector(".pw").value = g.w;
      row.querySelector(".ph").value = g.h;
    });
    box.appendChild(row);
  }
}
if ($("copytv")) {
  $("copytv").addEventListener("click", () => {
    const url = location.origin + location.pathname.replace("admin.html", "display.html") + "?id=" + currentId + "&screen=1";
    navigator.clipboard.writeText(url).then(() => alert("Kopieret: " + url)).catch(() => prompt("Kopier", url));
  });
}
$("newbtn").addEventListener("click", () => {
  $("panel").classList.add("hidden");
  if ($("createwrap")) $("createwrap").classList.remove("hidden");
  $("create").classList.remove("hidden");
  paintCscr();
});
$("closecreate").addEventListener("click", () => {
  $("create").classList.add("hidden");
  if ($("createwrap")) $("createwrap").classList.add("hidden");
});
if ($("cscreens")) $("cscreens").addEventListener("change", paintCscr);
async function lookupCvr(num) {
  const vat = String(num || "").replace(/[^0-9]/g, "");
  if (vat.length !== 8) throw new Error("CVR skal være 8 cifre.");
  const url = "https://cvrapi.dk/api?country=dk&version=6&vat=" + vat;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || data.error || !data.name) throw new Error(data.error || "Ikke fundet i CVR.");
  const zip = String(data.zipcode || data.zip || "");
  const city = data.city || "";
  const addr = data.address || data.street || "";
  return {
    name: data.name,
    address: addr,
    zip: zip,
    city: city,
    phone: data.phone || "",
  };
}

if ($("cvrbtn")) {
  $("cvrbtn").addEventListener("click", async () => {
    try {
      $("cmsg").textContent = "Slår op i CVR…";
      const f = await lookupCvr($("cvr").value);
      $("cname").value = f.name;
      $("caddr").value = f.address;
      if ($("czip")) $("czip").value = f.zip;
      $("ccity").value = f.city;
      if ($("cphone")) $("cphone").value = f.phone;
      $("cmsg").textContent = "Hentet fra CVR.";
    } catch (err) {
      $("cmsg").textContent = err.message;
      alert(err.message);
    }
  });
}
if ($("cvrupd")) {
  $("cvrupd").addEventListener("click", async () => {
    try {
      const f = await lookupCvr(currentId);
      $("ename").value = f.name;
      $("eaddr").value = f.address;
      if ($("ezip")) $("ezip").value = f.zip;
      $("ecity").value = f.city;
      $("ephone").value = f.phone;
      alert("Adresse hentet fra CVR. Tryk Gem og send.");
    } catch (err) {
      alert(err.message);
    }
  });
}

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
      wsUrl: ($("cws") && $("cws").value) || "",
      tvScreens: Array.from({ length: Number($("cscreens").value || 1) }, (_, i) => i + 1),
      screenSetup: Array.from($("cscrrows") ? $("cscrrows").querySelectorAll(".scrline") : []).map((row, i) => ({
        id: i + 1,
        model: row.querySelector(".mod").value || "",
        pxW: Number(row.querySelector(".pw").value) || 1920,
        pxH: Number(row.querySelector(".ph").value) || 1080,
        note: row.querySelector(".note").value || "",
        code: (row.querySelector(".code") && row.querySelector(".code").value) || makePairCode(),
      })),
    }, { merge: true });
    const setups = (await db.collection("customers").doc(cvr).get()).data().screenSetup || [];
    for (const s of setups) {
      if (s.code) {
        await db.collection("pairs").doc(s.code).set({
          cvr: cvr, screen: String(s.id), name: $("cname").value || "",
        });
      }
    }
    $("cmsg").textContent = "Gemt. TV: pair.html  Kode: " + setups.map((s) => s.code).join(", ");
    if ($("createwrap")) $("createwrap").classList.add("hidden");
    $("create").classList.add("hidden");
    alert("Kunden er gemt: " + cvr);
  } catch (err) {
    $("cmsg").textContent = "Kunne ikke gemme: " + err.message;
    alert("Kunne ikke gemme: " + err.message);
  }
});

if ($("seed")) {
  $("seed").addEventListener("click", async () => {
    if (!db) { alert("Sæt Firebase-nøgler først."); return; }
    for (const [id, data] of Object.entries(SEED)) {
      await db.collection("customers").doc(id).set({ ...data, screens: {} }, { merge: true });
    }
    alert("Testkunder med CVR ligger i databasen.");
  });
}

$("delcust").addEventListener("click", async () => {
  if (!db || !currentId) return;
  if (!confirm("Er du sikker på, du vil slette kunden?")) return;
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
    col.innerHTML = `<div class="col-top"><input class="col-title" placeholder="BURGERS / PIZZA" /><button type="button" class="ghost" data-delcol>Fjern kolonne</button></div><div class="sizes"><select class="scount"><option value="1">1 pris</option><option value="3">3 størrelser</option><option value="5">5 størrelser</option></select><div class="snames"></div></div><div class="col-items"></div>`;
    col.querySelector(".col-title").value = sec.title || "";
    col.querySelector(".col-title").addEventListener("input", (e) => { sections[si].title = e.target.value; });
    col.querySelector("[data-delcol]").addEventListener("click", () => {
      sections.splice(si, 1);
      paintStudio();
    });
    const nSize = (sec.sizes && sec.sizes.length) ? sec.sizes.length : 1;
    col.querySelector(".scount").value = String(nSize === 5 ? 5 : nSize === 3 ? 3 : 1);
    const defs = { 3: ["Alm", "Deep pan", "Familie"], 5: ["Alm", "Deep pan", "Familie", "XL", "XXL"] };
    function drawNames() {
      const hold = col.querySelector(".snames");
      hold.innerHTML = "";
      const n = Number(col.querySelector(".scount").value);
      if (n === 1) { sections[si].sizes = []; return; }
      if (!sections[si].sizes || sections[si].sizes.length !== n) {
        sections[si].sizes = (defs[n] || []).slice();
      }
      sections[si].sizes.forEach((lab, li) => {
        const inp = document.createElement("input");
        inp.value = lab;
        inp.placeholder = "størrelse";
        inp.addEventListener("input", () => { sections[si].sizes[li] = inp.value; });
        hold.appendChild(inp);
      });
    }
    col.querySelector(".scount").addEventListener("change", () => { drawNames(); paintStudio(); });
    drawNames();
    const box = col.querySelector(".col-items");
    (sec.items || []).forEach((it, ii) => {
      const row = document.createElement("div");
      row.className = "prod";
      row.innerHTML = `
        <div class="prod-line">
          <input class="num" placeholder="nr" />
          <input class="pname" placeholder="Produkt" />
          <span class="pprices"></span>
        </div>
        <input class="pdesc" placeholder="Beskrivelse" />
        <div class="prod-btns">
          <button type="button" data-add>+</button>
          <button type="button" data-del>−</button>
          <button type="button" data-lunch>Frokost</button>
          <input class="plunch extra" placeholder="+ frokost" />
          <input class="plfrom extra" placeholder="11:00" />
          <input class="plto extra" placeholder="15:00" />
          <button type="button" data-night>Natpris</button>
          <input class="pnight extra" placeholder="+ nat" />
          <input class="pnfrom extra" placeholder="22:00" />
          <input class="pnto extra" placeholder="05:00" />
        </div>`;
      row.querySelector(".num").value = it.num || "";
      row.querySelector(".pname").value = it.name || "";
      const pbox = row.querySelector(".pprices");
      const count = Math.max(1, (sec.sizes && sec.sizes.length) || 1);
      if (!it.prices || !it.prices.length) it.prices = [it.price || ""];
      while (it.prices.length < count) it.prices.push("");
      it.prices.length = count;
      it.price = it.prices[0] || "";
      it.prices.forEach((pr, pi) => {
        const inp = document.createElement("input");
        inp.className = "pprice";
        inp.placeholder = (sec.sizes && sec.sizes[pi]) || "pris";
        inp.value = pr || "";
        inp.addEventListener("input", () => {
          it.prices[pi] = inp.value;
          if (pi === 0) it.price = inp.value;
        });
        pbox.appendChild(inp);
      });
      row.querySelector(".pdesc").value = it.desc || "";
      row.querySelector(".pnight").value = it.nightAdd || "";
      row.querySelector(".pnfrom").value = it.nightFrom || "22:00";
      row.querySelector(".pnto").value = it.nightTo || "05:00";
      row.querySelector(".plunch").value = it.lunchAdd || "";
      row.querySelector(".plfrom").value = it.lunchFrom || "11:00";
      row.querySelector(".plto").value = it.lunchTo || "15:00";
      row.querySelector(".num").addEventListener("input", (e) => { sections[si].items[ii].num = e.target.value; });
      row.querySelector(".pname").addEventListener("input", (e) => { sections[si].items[ii].name = e.target.value; });
      /* priser binds ovenfor */
      row.querySelector(".pdesc").addEventListener("input", (e) => { sections[si].items[ii].desc = e.target.value; });
      row.querySelector(".pnight").addEventListener("input", (e) => { sections[si].items[ii].nightAdd = e.target.value; });
      row.querySelector(".pnfrom").addEventListener("input", (e) => { sections[si].items[ii].nightFrom = e.target.value; });
      row.querySelector(".pnto").addEventListener("input", (e) => { sections[si].items[ii].nightTo = e.target.value; });
      row.querySelector(".plunch").addEventListener("input", (e) => { sections[si].items[ii].lunchAdd = e.target.value; });
      row.querySelector(".plfrom").addEventListener("input", (e) => { sections[si].items[ii].lunchFrom = e.target.value; });
      row.querySelector(".plto").addEventListener("input", (e) => { sections[si].items[ii].lunchTo = e.target.value; });
      row.querySelector("[data-night]").addEventListener("click", () => {
        row.classList.toggle("show-night");
      });
      row.querySelector("[data-lunch]").addEventListener("click", () => {
        row.classList.toggle("show-lunch");
      });
      row.querySelector("[data-add]").addEventListener("click", () => {
        sections[si].items.splice(ii + 1, 0, { num: "", name: "", desc: "", price: "" });
        paintStudio();
      });
      row.querySelector("[data-del]").addEventListener("click", () => {
        sections[si].items.splice(ii, 1);
        paintStudio();
      });
      if (it.visible === false) row.classList.add("off");
      box.appendChild(row);
    });
    const limit = Math.max(6, Math.floor(((Number($("spy") && $("spy").value) || 1080) - 220) / 78));
    if ((sec.items || []).length >= limit) {
      const cut = document.createElement("div");
      cut.className = "cut";
      cut.textContent = "Her slutter skærmen (" + ($("spy") && $("spy").value || 1080) + "). Start en ny kolonne.";
      box.appendChild(cut);
    }
    board.appendChild(col);
  });
}

function stashScreen() {
  boardsByScreen[activeScreen] = {
    sections: JSON.parse(JSON.stringify(sections || [])),
    pxW: Number($("spx") && $("spx").value) || 1920,
    pxH: Number($("spy") && $("spy").value) || 1080,
    video: ($("svid") && $("svid").value) || "",
    video2: ($("svid2") && $("svid2").value) || "",
    video3: ($("svid3") && $("svid3").value) || "",
    videoSound: ($("svidlyd") && $("svidlyd").value) === "1",
    videoSound2: ($("svidlyd2") && $("svidlyd2").value) === "1",
    videoSound3: ($("svidlyd3") && $("svidlyd3").value) === "1",
    videoText: ($("svidtxt") && $("svidtxt").value) || "",
    videoText2: ($("svidtxt2") && $("svidtxt2").value) || "",
    videoText3: ($("svidtxt3") && $("svidtxt3").value) || "",
    videoTextOn: ($("svidton") && $("svidton").value) === "1",
    videoTextOn2: ($("svidton2") && $("svidton2").value) === "1",
    videoTextOn3: ($("svidton3") && $("svidton3").value) === "1",
    videoSec: Number($("svidsec") && $("svidsec").value) || 20,
    videoGap: Number($("svidgap") && $("svidgap").value) || 5,
  };
}

function applyScreen(n) {
  activeScreen = String(n);
  const b = boardsByScreen[activeScreen] || { sections: [], pxW: 1920, pxH: 1080 };
  sections = JSON.parse(JSON.stringify(b.sections || []));
  if ($("spx")) $("spx").value = b.pxW || 1920;
  if ($("spy")) $("spy").value = b.pxH || 1080;
  if ($("svid")) $("svid").value = b.video || "";
  if ($("svid2")) $("svid2").value = b.video2 || "";
  if ($("svid3")) $("svid3").value = b.video3 || "";
  if ($("svidlyd")) $("svidlyd").value = b.videoSound ? "1" : "0";
  if ($("svidlyd2")) $("svidlyd2").value = b.videoSound2 ? "1" : "0";
  if ($("svidlyd3")) $("svidlyd3").value = b.videoSound3 ? "1" : "0";
  if ($("svidtxt")) $("svidtxt").value = b.videoText || "";
  if ($("svidtxt2")) $("svidtxt2").value = b.videoText2 || "";
  if ($("svidtxt3")) $("svidtxt3").value = b.videoText3 || "";
  if ($("svidton")) $("svidton").value = b.videoTextOn ? "1" : "0";
  if ($("svidton2")) $("svidton2").value = b.videoTextOn2 ? "1" : "0";
  if ($("svidton3")) $("svidton3").value = b.videoTextOn3 ? "1" : "0";
  if ($("svidsec")) $("svidsec").value = b.videoSec || 20;
  if ($("svidgap")) $("svidgap").value = b.videoGap || 5;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.getAttribute("data-scr") === activeScreen));
  paintStudio();
}

async function openStudio() {
  if (!currentId || !db) return;
  const snap = await db.collection("customers").doc(currentId).get();
  const c = snap.exists ? snap.data() : {};
  boardsByScreen = JSON.parse(JSON.stringify(c.boardsByScreen || {}));
  if (!boardsByScreen["1"]) {
    boardsByScreen["1"] = {
      sections: (c.sections && c.sections.length) ? c.sections : [],
      pxW: c.pxW || 1920,
      pxH: c.pxH || 1080,
    };
  }
  const maxS = Number(c.screenCount || (c.tvScreens && c.tvScreens.length) || 1);
  ["1","2","3","4","5"].forEach((n) => {
    const on = Number(n) <= maxS;
    const el = $("has" + n);
    if (el) {
      el.checked = on;
      el.disabled = !on;
      const lab = el.closest("label");
      if (lab) lab.style.display = on ? "" : "none";
    }
  });
  document.querySelectorAll(".tab").forEach((t) => {
    const on = Number(t.getAttribute("data-scr")) <= maxS;
    t.style.display = on ? "" : "none";
    t.disabled = !on;
  });
  if (c.screenSetup && c.screenSetup[0]) {
    if (!boardsByScreen["1"]) boardsByScreen["1"] = { sections: [], pxW: 1920, pxH: 1080 };
    c.screenSetup.forEach((s) => {
      const id = String(s.id || "");
      if (!id) return;
      boardsByScreen[id] = boardsByScreen[id] || { sections: [], pxW: s.pxW, pxH: s.pxH };
      boardsByScreen[id].pxW = s.pxW || boardsByScreen[id].pxW;
      boardsByScreen[id].pxH = s.pxH || boardsByScreen[id].pxH;
    });
  }
  $("studio").classList.remove("hidden");
  const rail = document.querySelector(".studio-rail");
  if (rail) { rail.style.background = "#1b1916"; rail.style.color = "#f4efe6"; }
  $("stitle").textContent = c.name || currentId;
  if ($("scvr")) $("scvr").textContent = "CVR " + currentId;
  if ($("sticker")) $("sticker").checked = !!c.showTicker;
  if ($("sscale")) $("sscale").value = String(c.tvScale || 90);
  applyScreen("1");
}

$("add").addEventListener("click", openStudio);
if ($("viewmenu")) $("viewmenu").addEventListener("click", openStudio);
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    stashScreen();
    applyScreen(t.getAttribute("data-scr"));
  });
});
if ($("scopy")) {
  $("scopy").addEventListener("click", () => {
    stashScreen();
    const n = String(Math.min(5, Number(activeScreen) + 1));
    boardsByScreen[n] = JSON.parse(JSON.stringify(boardsByScreen[activeScreen] || { sections: [] }));
    const has = $("has" + n);
    if (has) has.checked = true;
    applyScreen(n);
    if ($("sstatus")) $("sstatus").textContent = "Kladde — ikke sendt";
    alert("Kopieret til skærm " + n + ". Ret og send.");
  });
}
$("saddcol").addEventListener("click", () => {
  sections.push({ title: "", items: [{ num: "", name: "", desc: "", price: "" }] });
  paintStudio();
});
let pendingBg = null;
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.55));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
if ($("sbg")) {
  $("sbg").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    $("stitle").textContent = "Klemmer billede…";
    pendingBg = await shrinkImage(f);
    $("stitle").textContent = "Baggrund klar — send til TV";
  });
}
let pendingXl = null;
function normHead(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function colIndex(heads, names) {
  for (let i = 0; i < heads.length; i++) {
    const h = normHead(heads[i]);
    if (names.some((n) => h === n || h.indexOf(n) >= 0)) return i;
  }
  return -1;
}
function guessPriceCount(rows, heads) {
  const iAlm = colIndex(heads, ["alm"]);
  const iDeep = colIndex(heads, ["deep"]);
  const iFam = colIndex(heads, ["familie", "fam"]);
  const iXl = colIndex(heads, ["xl"]);
  const iXxl = colIndex(heads, ["xxl"]);
  let three = 0, five = 0;
  rows.slice(1).forEach((r) => {
    if (iAlm >= 0 && r[iAlm] && iDeep >= 0 && r[iDeep] && iFam >= 0 && r[iFam]) three++;
    if (iXl >= 0 && r[iXl] && iXxl >= 0 && r[iXxl]) five++;
  });
  if (five > 0) return 5;
  if (three > 0) return 3;
  return 1;
}
function openExcelWizard(rows) {
  pendingXl = rows || [];
  const heads = (rows[0] || []).map((h) => String(h || ""));
  const g = guessPriceCount(rows, heads);
  if ($("xlcount")) $("xlcount").value = String(g);
  if ($("xllabs")) $("xllabs").value = g === 5 ? "Alm, Deep pan, Familie, XL, XXL" : (g === 3 ? "Alm, Deep pan, Familie" : "Pris");
  const sel = $("xlcol");
  if (sel) {
    sel.innerHTML = '<option value="ny">Ny kolonne</option>';
    sections.forEach((s, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = "Kolonne " + (i + 1) + (s.title ? " (" + s.title + ")" : "");
      sel.appendChild(o);
    });
  }
  let maxn = 0;
  sections.forEach((s) => (s.items || []).forEach((it) => {
    const v = Number(it.num);
    if (v > maxn) maxn = v;
  }));
  if ($("xlstart")) $("xlstart").value = maxn ? String(maxn + 1) : "";
  if ($("xlhint")) $("xlhint").textContent = "Fandt " + Math.max(0, rows.length - 1) + " linjer." + (maxn ? " Sidste nr. nu er " + maxn + "." : "");
  if ($("xlwiz")) $("xlwiz").classList.remove("hidden");
}
function applyExcelWizard() {
  const rows = pendingXl || [];
  if (!rows.length) return;
  const heads = (rows[0] || []).map((h) => String(h || ""));
  const n = Number($("xlcount") && $("xlcount").value) || 3;
  const labels = (($("xllabs") && $("xllabs").value) || "Alm, Deep pan, Familie").split(",").map((s) => s.trim()).filter(Boolean);
  const iCol = colIndex(heads, ["kolonne", "gruppe", "kategori"]);
  const iNr = colIndex(heads, ["nr", "nummer", "no"]);
  const iName = colIndex(heads, ["navn", "produkt", "ret"]);
  const iDesc = colIndex(heads, ["beskrivelse", "tilbehør", "desc"]);
  const iPris = colIndex(heads, ["pris"]);
  const iAlm = colIndex(heads, ["alm"]);
  const iDeep = colIndex(heads, ["deep"]);
  const iFam = colIndex(heads, ["familie", "fam"]);
  const iXl = colIndex(heads, ["xl"]);
  const iXxl = colIndex(heads, ["xxl"]);
  const groups = {};
  const startAt = Number($("xlstart") && $("xlstart").value);
  let body = rows.slice(1).filter((r) => (r || []).some((c) => String(c == null ? "" : c).trim()));
  if (Number.isFinite(startAt) && startAt > 0) body = body.slice(startAt - 1);
  body.forEach((r) => {
    const cells = (r || []).map((c) => (c == null ? "" : c));
    if (!cells.some((c) => String(c).trim())) return;
    const title = iCol >= 0 ? String(cells[iCol] || "MENU") : "MENU";
    const num = iNr >= 0 ? String(cells[iNr] || "") : "";
    const name = iName >= 0 ? String(cells[iName] || "") : String(cells[2] || cells[1] || "");
    const desc = iDesc >= 0 ? String(cells[iDesc] || "") : "";
    let prices = [];
    if (n === 1) {
      const p = iPris >= 0 ? cells[iPris] : (iAlm >= 0 ? cells[iAlm] : "");
      prices = [String(p == null ? "" : p)];
    } else if (n === 3) {
      prices = [cells[iAlm], cells[iDeep], cells[iFam]].map((p) => String(p == null ? "" : p));
    } else {
      prices = [cells[iAlm], cells[iDeep], cells[iFam], cells[iXl], cells[iXxl]].map((p) => String(p == null ? "" : p));
    }
    if (!groups[title]) groups[title] = [];
    groups[title].push({
      num, name, desc,
      price: prices[0] || "",
      prices,
      nightAdd: "", lunchAdd: "",
    });
  });
  const dest = $("xlcol") && $("xlcol").value;
  Object.keys(groups).forEach((title) => {
    const items = groups[title];
    if (dest && dest !== "ny" && sections[Number(dest)]) {
      const col = sections[Number(dest)];
      col.items = (col.items || []).concat(items);
      if (n > 1) col.sizes = labels.slice(0, n);
    } else {
      sections.push({ title, sizes: n === 1 ? [] : labels.slice(0, n), items });
    }
  });
  paintStudio();
  if ($("sstatus")) $("sstatus").textContent = "Kladde — ikke sendt";
  if ($("xlwiz")) $("xlwiz").classList.add("hidden");
  pendingXl = null;
}
if ($("xlcancel")) $("xlcancel").addEventListener("click", () => { if ($("xlwiz")) $("xlwiz").classList.add("hidden"); pendingXl = null; });
if ($("xldo")) $("xldo").addEventListener("click", applyExcelWizard);
if ($("xlcount")) $("xlcount").addEventListener("change", () => {
  const n = $("xlcount").value;
  if ($("xllabs")) $("xllabs").value = n === "5" ? "Alm, Deep pan, Familie, XL, XXL" : (n === "3" ? "Alm, Deep pan, Familie" : "Pris");
});
function addScanned(title, found) {
  if (!found || !found.length) {
    alert("Ingen linjer i filen.");
    return;
  }
  sections.push({ title: title || "MENU", items: found });
  paintStudio();
  if ($("sstatus")) $("sstatus").textContent = "Kladde — ikke sendt";
  alert(found.length + " linjer ind. Tjek og send til TV.");
}
function rowsToItems(rows) {
  const found = [];
  (rows || []).forEach((r) => {
    const cells = (Array.isArray(r) ? r : [r]).map((c) => String(c == null ? "" : c).trim());
    if (!cells.some(Boolean)) return;
    const joined = cells.join(" ");
    if (/overskrift|kolonne|^navn$|^pris$/i.test(joined) && !found.length) return;
    let num = "", name = "", desc = "", price = "";
    if (cells.length >= 4) {
      num = cells[0]; name = cells[1]; desc = cells[2]; price = String(cells[3]).replace(/[^\d.,]/g, "");
    } else if (cells.length === 3) {
      if (/^\d+$/.test(cells[0])) { num = cells[0]; name = cells[1]; price = String(cells[2]).replace(/[^\d.,]/g, ""); }
      else { name = cells[0]; desc = cells[1]; price = String(cells[2]).replace(/[^\d.,]/g, ""); }
    } else if (cells.length === 2) {
      name = cells[0]; price = String(cells[1]).replace(/[^\d.,]/g, "");
    } else {
      name = joined;
    }
    if (name || price) found.push({ num, name, desc, price, nightAdd: "", lunchAdd: "" });
  });
  return found;
}
async function readDocx(file) {
  const zip = await JSZip.loadAsync(file);
  const xml = await zip.file("word/document.xml").async("string");
  return xml.replace(/<w:p[^>]*>/g, "\n").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
}
async function readPdf(file) {
  if (!window.pdfjsLib) throw new Error("PDF-læser mangler. Genindlæs siden.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}
if ($("sfilebtn") && $("sfile")) $("sfilebtn").addEventListener("click", () => $("sfile").click());
if ($("sfile")) {
  $("sfile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const nm = (f.name || "").toLowerCase();
    $("stitle").textContent = "Læser fil…";
    try {
      if (/\.(xlsx|xls|csv)$/.test(nm)) {
        if (!window.XLSX) throw new Error("Excel-læser mangler. Genindlæs siden.");
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        openExcelWizard(rows);
      } else if (nm.endsWith(".docx")) {
        const p = linesToItems(await readDocx(f));
        addScanned(p.title, p.found);
      } else if (nm.endsWith(".pdf")) {
        const p = linesToItems(await readPdf(f));
        addScanned(p.title, p.found);
      } else {
        const p = linesToItems(await f.text());
        addScanned(p.title, p.found);
      }
    } catch (err) {
      alert("Filen kunne ikke læses: " + err.message);
    }
    $("stitle").textContent = currentId || "";
    e.target.value = "";
  });
}
if ($("sscanbtn") && $("sscan")) $("sscanbtn").addEventListener("click", () => $("sscan").click());
if ($("sbgbtn") && $("sbg")) $("sbgbtn").addEventListener("click", () => $("sbg").click());
if ($("svidbtn")) {
  $("svidbtn").addEventListener("click", () => {
    if ($("vw1")) $("vw1").value = ($("svid") && $("svid").value) || "";
    if ($("vw2")) $("vw2").value = ($("svid2") && $("svid2").value) || "";
    if ($("vw3")) $("vw3").value = ($("svid3") && $("svid3").value) || "";
    if ($("vw1l")) $("vw1l").checked = ($("svidlyd") && $("svidlyd").value) === "1";
    if ($("vw2l")) $("vw2l").checked = ($("svidlyd2") && $("svidlyd2").value) === "1";
    if ($("vw3l")) $("vw3l").checked = ($("svidlyd3") && $("svidlyd3").value) === "1";
    if ($("vw1t")) $("vw1t").checked = ($("svidton") && $("svidton").value) === "1";
    if ($("vw2t")) $("vw2t").checked = ($("svidton2") && $("svidton2").value) === "1";
    if ($("vw3t")) $("vw3t").checked = ($("svidton3") && $("svidton3").value) === "1";
    if ($("vw1txt")) $("vw1txt").value = ($("svidtxt") && $("svidtxt").value) || "";
    if ($("vw2txt")) $("vw2txt").value = ($("svidtxt2") && $("svidtxt2").value) || "";
    if ($("vw3txt")) $("vw3txt").value = ($("svidtxt3") && $("svidtxt3").value) || "";
    if ($("vwsec")) $("vwsec").value = ($("svidsec") && $("svidsec").value) || 20;
    if ($("vwgap")) $("vwgap").value = ($("svidgap") && $("svidgap").value) || 5;
    if ($("vidwiz")) $("vidwiz").classList.remove("hidden");
  });
}
if ($("vwcancel")) $("vwcancel").addEventListener("click", () => { if ($("vidwiz")) $("vidwiz").classList.add("hidden"); });
if ($("vwsave")) {
  $("vwsave").addEventListener("click", () => {
    if ($("svid")) $("svid").value = ($("vw1") && $("vw1").value) || "";
    if ($("svid2")) $("svid2").value = ($("vw2") && $("vw2").value) || "";
    if ($("svid3")) $("svid3").value = ($("vw3") && $("vw3").value) || "";
    if ($("svidlyd")) $("svidlyd").value = ($("vw1l") && $("vw1l").checked) ? "1" : "0";
    if ($("svidlyd2")) $("svidlyd2").value = ($("vw2l") && $("vw2l").checked) ? "1" : "0";
    if ($("svidlyd3")) $("svidlyd3").value = ($("vw3l") && $("vw3l").checked) ? "1" : "0";
    if ($("svidton")) $("svidton").value = ($("vw1t") && $("vw1t").checked) ? "1" : "0";
    if ($("svidton2")) $("svidton2").value = ($("vw2t") && $("vw2t").checked) ? "1" : "0";
    if ($("svidton3")) $("svidton3").value = ($("vw3t") && $("vw3t").checked) ? "1" : "0";
    if ($("svidtxt")) $("svidtxt").value = ($("vw1txt") && $("vw1txt").value) || "";
    if ($("svidtxt2")) $("svidtxt2").value = ($("vw2txt") && $("vw2txt").value) || "";
    if ($("svidtxt3")) $("svidtxt3").value = ($("vw3txt") && $("vw3txt").value) || "";
    if ($("svidsec")) $("svidsec").value = ($("vwsec") && $("vwsec").value) || 20;
    if ($("svidgap")) $("svidgap").value = ($("vwgap") && $("vwgap").value) || 5;
    if ($("vidwiz")) $("vidwiz").classList.add("hidden");
    if (typeof stashScreen === "function") stashScreen();
  });
}
async function uploadSlot(slot, file) {
  if (!file || !currentId) return;
  if (!firebase.storage) { alert("Slå Firebase Storage til."); return; }
  const path = "videos/" + currentId + "/" + activeScreen + "-" + slot + ".mp4";
  await firebase.storage().ref(path).put(file);
  return firebase.storage().ref(path).getDownloadURL();
}
[["vw1f","vw1file","vw1"],["vw2f","vw2file","vw2"],["vw3f","vw3file","vw3"]].forEach((ids) => {
  if ($(ids[0]) && $(ids[1])) $(ids[0]).addEventListener("click", () => $(ids[1]).click());
  if ($(ids[1])) $(ids[1]).addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const url = await uploadSlot(ids[2], f);
      if ($(ids[2])) $(ids[2]).value = url;
    } catch (err) { alert("Upload fejlede: " + err.message); }
  });
});
[["vw1v","vw1"],["vw2v","vw2"],["vw3v","vw3"]].forEach((ids) => {
  if ($(ids[0])) $(ids[0]).addEventListener("click", () => {
    const u = $(ids[1]) && $(ids[1]).value;
    if (!u) return;
    const p = $("vwprev");
    if (!p) return;
    p.style.display = "block";
    p.src = u;
    p.play().catch(() => {});
  });
});
function prepScan(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const scale = Math.max(2, 1600 / Math.max(img.width, 1));
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const pix = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < pix.data.length; i += 4) {
        const g = pix.data[i] * 0.3 + pix.data[i + 1] * 0.59 + pix.data[i + 2] * 0.11;
        const v = g < 150 ? 0 : 255;
        pix.data[i] = pix.data[i + 1] = pix.data[i + 2] = v;
      }
      ctx.putImageData(pix, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function linesToItems(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1);
  const found = [];
  let title = "SCAN";
  lines.forEach((line) => {
    let m = line.match(/^(?:(\d{1,3})[.)\s]+)?(.+?)\s+[-–]?\s*(\d{2,4})\s*[,.-]?\s*-?\s*$/);
    if (!m) m = line.match(/(\d{2,4})\s*[,.-]?\s*-?\s*$/);
    if (m && m[3]) {
      found.push({ num: m[1] || "", name: (m[2] || "").trim(), desc: "", price: m[3], nightAdd: "", lunchAdd: "" });
    } else if (m && m[1] && !m[3]) {
      const price = m[1];
      const name = line.replace(price, "").replace(/[,.\-]+$/, "").trim();
      found.push({ num: "", name: name || line, desc: "", price: price, nightAdd: "", lunchAdd: "" });
    } else if (/^[A-ZÆØÅ0-9 .&/]{3,28}$/.test(line)) {
      if (!found.length) title = line;
      else found.push({ num: "", name: line, desc: "", price: "", nightAdd: "", lunchAdd: "" });
    } else if (found.length) {
      found[found.length - 1].desc = (found[found.length - 1].desc + " " + line).trim();
    } else {
      found.push({ num: "", name: line, desc: "", price: "", nightAdd: "", lunchAdd: "" });
    }
  });
  return { title, found };
}

if ($("sscan")) {
  $("sscan").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!window.Tesseract) { alert("Scanner-biblioteket blev ikke hentet. Tjek nettet og genindlæs."); return; }
    $("stitle").textContent = "Scanner menukort…";
    try {
      const canvas = await prepScan(f);
      let out = await Tesseract.recognize(canvas, "eng", { logger: () => {} });
      let parsed = linesToItems(out.data && out.data.text);
      if (parsed.found.length < 2) {
        out = await Tesseract.recognize(f, "eng");
        const again = linesToItems(out.data && out.data.text);
        if (again.found.length > parsed.found.length) parsed = again;
      }
      if (!parsed.found.length) {
        parsed.found.push({ num: "", name: "Læst — ret navnet", desc: (out.data && out.data.text) || "", price: "", nightAdd: "", lunchAdd: "" });
      }
      sections.push({ title: parsed.title || "SCAN", items: parsed.found });
      paintStudio();
      alert("Sat " + parsed.found.length + " linjer ind. Ret navne og priser, så send.");
    } catch (err) {
      alert("Scan fejlede: " + err.message);
    }
    $("stitle").textContent = currentId || "";
    e.target.value = "";
  });
}
if ($("sview")) {
  $("sview").addEventListener("click", () => {
    if (!currentId) return;
    window.open("display.html?id=" + currentId + "&screen=" + activeScreen, "_blank");
  });
}
$("sclose").addEventListener("click", () => {
  $("studio").classList.add("hidden");
  const id = new URLSearchParams(location.search).get("id") || sessionStorage.getItem("kundeId") || "";
  if (new URLSearchParams(location.search).get("mode") === "kunde") {
    location.href = "kunde.html?id=" + encodeURIComponent(id);
  }
});
$("ssave").addEventListener("click", async () => {
  if (!db || !currentId) return;
  items = [];
  sections.forEach((s) => (s.items || []).forEach((it) => items.push({ ...it, visible: true })));
  try {
    stashScreen();
    const tvs = [];
    ["1","2","3","4","5"].forEach((n) => { if ($("has"+n) && $("has"+n).checked) tvs.push(Number(n)); });
    const payload = {
      sections: (boardsByScreen["1"] && boardsByScreen["1"].sections) || sections,
      items,
      venue: "Menukort",
      pxW: Number($("spx") && $("spx").value) || 1920,
      pxH: Number($("spy") && $("spy").value) || 1080,
      tvScreens: tvs.length ? tvs : [1],
      boardsByScreen,
      video: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].video) || "",
      video2: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].video2) || "",
      video3: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].video3) || "",
      videoText: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoText) || "",
      videoText2: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoText2) || "",
      videoText3: (boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoText3) || "",
      videoTextOn: !!(boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoTextOn),
      videoTextOn2: !!(boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoTextOn2),
      videoTextOn3: !!(boardsByScreen[activeScreen] && boardsByScreen[activeScreen].videoTextOn3),
      showTicker: !!( $("sticker") && $("sticker").checked ),
      tvScale: Number($("sscale") && $("sscale").value) || 90,
      bump: Date.now(),
    };
    if (pendingBg) payload.bg = pendingBg;
    await db.collection("customers").doc(currentId).set(payload, { merge: true });
    if ($("sstatus")) { $("sstatus").textContent = "Live"; $("sstatus").className = "live"; }
    $("studio").classList.add("hidden");
    alert("Sendt til infoskærm. Skærmen opdaterer selv.");
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
      wsUrl: ($("ews") && $("ews").value) || "",
      phone: $("ephone").value,
      contact: ($("econtact") && $("econtact").value) || "",
      email: ($("eemail") && $("eemail").value) || "",
      venue: venue,
      ticker: $("ticker").value,
      showTicker: !!( $("etickon") && $("etickon").checked ),
      footerNote: $("footerNote").value,
      hours: pendingHours || {},
      allowLogin: !!( $("eallow") && $("eallow").checked ),
      kundeKode: ($("ekode") && $("ekode").value) || "",
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


const KUNDE = (typeof KUNDEMODE !== "undefined") ? KUNDEMODE : (new URLSearchParams(location.search).get("mode") === "kunde");
function applyKundeMode() {
  if (!KUNDEMODE && !KUNDE) return;
  document.body.classList.add("kunde-mode");
  ["delcust","eallow","ekode","sendlink","footerNote"].forEach(function (id) {
    const el = $(id);
    if (!el) return;
    const wrap = el.closest("label") || el.closest("div") || el;
    wrap.style.display = "none";
  });
  const side = document.querySelector(".side");
  const map = $("map");
  if (side) side.style.display = "none";
  if (map) map.style.display = "none";
  if ($("pcity")) $("pcity").textContent = ($("pcity").textContent || "") + " (låst)";
  if ($("panel")) $("panel").classList.remove("hidden");
}
if ($("sendlink")) {
  $("sendlink").addEventListener("click", function () {
    if (!currentId) { alert("Abn kunden forst."); return; }
    var kode = ($("ekode") && $("ekode").value) || "";
    if (!kode) {
      kode = makePairCode();
      if ($("ekode")) $("ekode").value = kode;
    }
    if ($("eallow")) $("eallow").checked = true;
    var mail = ($("eemail") && $("eemail").value) || "";
    var url = "https://danpay-collab.github.io/remote-menukort/kunde.html?id=" + currentId;
    var body = "Log ind her: " + url + "\nCVR: " + currentId + "\nKode: " + kode;
    alert(body);
    try { navigator.clipboard.writeText(body); } catch (e) {}
    if (db) {
      db.collection("customers").doc(currentId).set({
        allowLogin: true,
        kundeKode: kode,
        kundePinChosen: false
      }, { merge: true }).catch(function (err) { alert("Gem fejlede: " + err.message); });
    }
    if (mail) {
      fetch("https://formsubmit.co/ajax/" + encodeURIComponent(mail), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ _subject: "MenuLive login", message: body, cvr: currentId, link: url })
      }).catch(function () {});
    }
  });
}

if ($("pinkeep")) $("pinkeep").addEventListener("click", async function () {
  if (!currentId || !db) return;
  await db.collection("customers").doc(currentId).set({ kundePinChosen: true }, { merge: true });
  sessionStorage.setItem("kundeNeedPin", "0");
  if ($("pindlg")) $("pindlg").classList.add("hidden");
});
if ($("pinset")) $("pinset").addEventListener("click", async function () {
  const a = ($("pinnew") && $("pinnew").value) || "";
  const b = ($("pinrep") && $("pinrep").value) || "";
  if (a.length < 4 || a !== b) { alert("Koden skal være ens og mindst 4 tegn."); return; }
  await db.collection("customers").doc(currentId).set({ kundeKode: a, kundePinChosen: true }, { merge: true });
  sessionStorage.setItem("kundeNeedPin", "0");
  if ($("pindlg")) $("pindlg").classList.add("hidden");
});

if ($("adminpinsave")) {
  $("adminpinsave").addEventListener("click", async function () {
    const a = ($("adminpin1") && $("adminpin1").value) || "";
    const b = ($("adminpin2") && $("adminpin2").value) || "";
    if (a.length < 4 || a !== b) { alert("Koden skal være ens og mindst 4 tegn."); return; }
    try {
      await db.collection("settings").doc("app").set({ adminPin: a }, { merge: true });
      alert("Ny admin-kode er gemt. Brug den næste gang.");
    } catch (err) {
      alert("Kunne ikke gemme koden: " + err.message + "\nSæt settings/{id} i Firestore Rules.");
    }
    $("adminpin1").value = "";
    $("adminpin2").value = "";
  });
}

if ($("admininvbtn")) $("admininvbtn").addEventListener("click", function () {
  if ($("invbox")) $("invbox").classList.toggle("hidden");
});
if ($("invsend")) $("invsend").addEventListener("click", async function () {
  const name = ($("invname") && $("invname").value || "").trim();
  const mail = ($("invmail") && $("invmail").value || "").trim();
  if (!name || !mail) { alert("Navn og e-mail."); return; }
  await db.collection("admins").doc(adminSlug(name)).set({
    name: name,
    email: mail,
    pinChosen: false,
    kode: ""
  }, { merge: true });
  const url = "https://danpay-collab.github.io/remote-menukort/admin.html";
  const body = "MenuLive admin\n" + url + "\nNavn: " + name + "\nForste kode: 4821\nVaelg selv kode ved forste login.";
  try {
    await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(mail), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ _subject: "MenuLive admin", message: body })
    });
  } catch (e) {}
  alert("Invitation sendt (eller kopier selv):\n" + body);
});
