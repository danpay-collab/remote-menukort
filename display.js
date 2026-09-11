const params = new URLSearchParams(location.search);
const CUSTOMER_ID = params.get("id") || "16067504";
const SCREEN_ID = params.get("screen") || "tv-1";

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("da-DK", {
    hour: "2-digit", minute: "2-digit",
  });
}

function render(data) {
  document.getElementById("venue").textContent = data.venue || data.name || "Menukort";
  const board = document.getElementById("board");
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
        el.querySelector(".price").textContent = it.price ? it.price + ",-" : "";
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

const cfg = window.firebaseConfig;
if (cfg && cfg.apiKey !== "INDSÆT") {
  firebase.initializeApp(cfg);
  const db = firebase.firestore();
  const ref = db.collection("customers").doc(CUSTOMER_ID);
  ref.onSnapshot((snap) => { if (snap.exists) render(snap.data()); });
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
