const params = new URLSearchParams(location.search);
const CUSTOMER_ID = params.get("id") || "odense";
const SCREEN_ID = params.get("screen") || "tv-1";

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("da-DK", {
    hour: "2-digit", minute: "2-digit",
  });
}

function render(data) {
  document.getElementById("venue").textContent = data.venue || data.name || "Dagens kort";
  document.getElementById("subtitle").textContent = data.subtitle || data.city || "";
  document.getElementById("note").textContent = data.footerNote || "";
  const list = document.getElementById("list");
  list.innerHTML = "";
  (data.items || []).filter((i) => i.visible !== false).forEach((i) => {
    const el = document.createElement("article");
    el.className = "item";
    el.innerHTML = `<div><h2></h2><p></p></div><div class="price"></div>`;
    el.querySelector("h2").textContent = i.name || "";
    el.querySelector("p").textContent = i.desc || "";
    el.querySelector(".price").textContent = i.price ? i.price + ",-" : "";
    list.appendChild(el);
  });
  const t = document.getElementById("ticker");
  const text = (data.ticker || " ").trim();
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text + "   •   " + text + "   •   " + text;
  t.appendChild(span);
}

const cfg = window.firebaseConfig;
if (!cfg || cfg.apiKey === "INDSÆT") {
  document.getElementById("subtitle").textContent = "Firebase-nøgler mangler i firebase-config.js";
} else {
  firebase.initializeApp(cfg);
  const db = firebase.firestore();
  const ref = db.collection("customers").doc(CUSTOMER_ID);
  ref.onSnapshot((snap) => {
    if (snap.exists) render(snap.data());
    else document.getElementById("subtitle").textContent = "Ukendt kunde: " + CUSTOMER_ID;
  });
  async function beat() {
    await ref.set({
      screens: {
        [SCREEN_ID]: {
          label: "Skærm 1",
          lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        },
      },
    }, { merge: true });
  }
  beat();
  setInterval(beat, 15000);
}

tickClock();
setInterval(tickClock, 1000);
