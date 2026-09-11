const params = new URLSearchParams(location.search);
const CUSTOMER_ID = params.get("id") || "odense";
const SCREEN_ID = params.get("screen") || "tv-1";

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
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
  const text = (data.ticker || "").trim() || " ";
  t.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text + "   •   " + text + "   •   " + text;
  t.appendChild(span);
}

async function load() {
  try {
    const res = await fetch("/api/customer?id=" + encodeURIComponent(CUSTOMER_ID), { cache: "no-store" });
    if (!res.ok) return;
    render(await res.json());
  } catch (e) {
    console.warn(e);
  }
}

async function beat() {
  try {
    await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: CUSTOMER_ID,
        screenId: SCREEN_ID,
        label: "Skærm 1",
      }),
    });
  } catch (e) {}
}

tickClock();
setInterval(tickClock, 1000);
load();
beat();
setInterval(load, 4000);
setInterval(beat, 15000);
