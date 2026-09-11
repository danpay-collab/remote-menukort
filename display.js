const params = new URLSearchParams(location.search);
const CUSTOMER_ID = params.get("id") || "16067504";
const SCREEN_ID = params.get("screen") || "tv-1";

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("da-DK", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit", minute: "2-digit",
  });
}

function parseHm(s) {
  const p = String(s || "22:00").split(":");
  return Number(p[0]) * 60 + Number(p[1] || 0);
}

function isNight(from, to) {
  const now = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Copenhagen", hour12: false });
  const parts = now.split(":");
  const cur = Number(parts[0]) * 60 + Number(parts[1]);
  const a = parseHm(from);
  const b = parseHm(to);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;
  return cur >= a || cur < b;
}

function render(data) {
  document.getElementById("venue").textContent = "Menukort";
  document.body.style.backgroundImage = data.bg ? "url(" + data.bg + ")" : "";
  document.body.style.backgroundSize = "cover";
  document.body.style.backgroundPosition = "center";
  const board = document.getElementById("board");
  const designed = Number(data.pxW) || 1920;
  const w = window.innerWidth || designed;
  const colN = (data.sections && data.sections.length) ? data.sections.length : 4;
  board.style.gridTemplateColumns = "repeat(" + colN + ", minmax(0, 1fr))";
  const scale = Math.max(0.65, Math.min(1.1, w / designed));
  document.documentElement.style.fontSize = (15 * scale) + "px";
  board.style.fontSize = (12 * scale) + "px";
  board.innerHTML = "";
  let sections = (data.sections && data.sections.length) ? data.sections : [];
  const hasSecItems = sections.some((s) => s && s.items && s.items.length);
  const flat = (data.items || []).filter((i) => i && (i.name || i.desc || i.price));
  if (!hasSecItems && flat.length) {
    sections = [{ title: "", items: flat.map((i, n) => ({
      num: i.num || String(n + 1),
      name: i.name || "",
      desc: i.desc || "",
      price: i.price || "",
    })) }];
  }
  const cols = sections.map((s) => [s]);
  cols.forEach((col) => {
    const wrap = document.createElement("div");
    col.forEach((sec) => {
      const box = document.createElement("section");
      box.className = "sec" + (sec.box ? " box" : "");
      const h = document.createElement("h2");
      h.textContent = sec.title || "";
      box.appendChild(h);
      if (sec.note) {
        const n = document.createElement("p");
        n.className = "desc";
        n.textContent = sec.note;
        box.appendChild(n);
      }
      (sec.items || []).forEach((it) => {
        const el = document.createElement("article");
        el.className = "row";
        el.innerHTML = `<div class="num"></div><div><div class="line"><span class="name"></span></div><p class="desc"></p></div><div class="price"></div>`;
        el.querySelector(".num").textContent = it.num || "";
        el.querySelector(".name").textContent = it.name || "";
        el.querySelector(".desc").textContent = it.desc || "";
        const base = Number(String(it.price || "").replace(",", "."));
        const add = (isNight(data.nightFrom || "22:00", data.nightTo || "05:00") ? Number(data.nightAdd || 0) : 0);
        const shown = (Number.isFinite(base) && it.price !== "" && it.price != null)
          ? String(base + add).replace(/\.0$/, "") + ",-"
          : (it.price ? it.price + ",-" : "");
        el.querySelector(".price").textContent = shown;
        if (add) {
          const n = document.createElement("span");
          n.className = "badge";
          n.textContent = "nat";
          el.querySelector(".line").appendChild(n);
        }
        if (it.badge) {
          const b = document.createElement("span");
          b.className = "badge";
          b.textContent = it.badge;
          el.querySelector(".line").appendChild(b);
        }
        box.appendChild(el);
      });
      wrap.appendChild(box);
    });
    board.appendChild(wrap);
  });
  const t = document.getElementById("ticker");
  const text = (data.ticker || "").trim() || " ";
  t.textContent = text + "   •   " + text + "   •   " + text;
}

let lastMenu = null;
const cfg = window.firebaseConfig;
if (cfg && cfg.apiKey !== "INDSÆT") {
  firebase.initializeApp(cfg);
  const db = firebase.firestore();
  const ref = db.collection("customers").doc(CUSTOMER_ID);
  ref.onSnapshot((snap) => { if (snap.exists) { lastMenu = snap.data(); render(lastMenu); } });
  async function beat() {
    await ref.set({
      screens: { [SCREEN_ID]: { label: "Skærm 1", lastSeen: firebase.firestore.FieldValue.serverTimestamp() } },
    }, { merge: true });
  }
  beat();
  setInterval(beat, 15000);
}
tickClock();
setInterval(tickClock, 1000);
setInterval(() => { if (lastMenu) render(lastMenu); }, 30000);
document.body.addEventListener("click", () => {
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});
