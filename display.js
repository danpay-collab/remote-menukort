const params = new URLSearchParams(location.search);
const CUSTOMER_ID = params.get("id") || "16067504";
const SCREEN_ID = params.get("screen") || "1";

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
  document.body.classList.toggle("notick", !data.showTicker);
  const tv = (Number(data.tvScale) || 90) / 100;
  document.documentElement.style.setProperty("--tv", String(tv));
  document.body.classList.toggle("hasbg", !!data.bg);
  document.body.style.backgroundImage = data.bg ? "url(" + data.bg + ")" : "";
  document.body.style.backgroundSize = "cover";
  document.body.style.backgroundPosition = "center";
  const board = document.getElementById("board");
  const designed = Number(data.pxW) || 1920;
  const w = window.innerWidth || designed;
  const colN = (data.sections && data.sections.length) ? data.sections.length : 4;
  board.style.gridTemplateColumns = "repeat(" + colN + ", minmax(0, 1fr))";
  const tvN = (Number(data.tvScale) || 90) / 100;
  const scale = Math.max(0.6, Math.min(1, w / designed)) * tvN;
  document.documentElement.style.fontSize = (14 * scale) + "px";
  board.style.fontSize = (11 * scale) + "px";
  board.innerHTML = "";
  const bmap = data.boardsByScreen || {};
  const pack = bmap[String(SCREEN_ID)] || bmap[SCREEN_ID] || bmap["1"] || bmap[1] || {};
  function fixVid(u) {
    u = String(u || "").trim();
    if (u.indexOf("github.com/") >= 0 && u.indexOf("/blob/") >= 0) {
      const parts = u.split("/blob/");
      const repo = parts[0].replace("https://github.com/", "").replace("http://github.com/", "");
      const file = (parts[1] || "").replace(/^[^/]+\//, "");
      u = "https://" + repo.split("/")[0] + ".github.io/" + repo.split("/")[1] + "/" + file;
    }
    return u;
  }
  function grab(obj, k) { return obj && obj[k] ? obj[k] : ""; }
  const sources = [data, pack];
  Object.keys(bmap).forEach(function (k) { sources.push(bmap[k]); });
  function first(key) {
    for (let i = 0; i < sources.length; i++) {
      const v = grab(sources[i], key);
      if (v) return v;
    }
    return "";
  }
  function onTxt(k) {
    const v = first(k);
    return v === true || v === "true" || v === "1";
  }
  const rawList = [
    { u: fixVid(first("video")), s: onTxt("videoSound"), t: onTxt("videoTextOn") ? first("videoText") : "" },
    { u: fixVid(first("video2")), s: onTxt("videoSound2"), t: onTxt("videoTextOn2") ? first("videoText2") : "" },
    { u: fixVid(first("video3")), s: onTxt("videoSound3"), t: onTxt("videoTextOn3") ? first("videoText3") : "" },
  ].filter(function (x) { return x.u; });
  const videos = rawList.map(function (x) { return x.u; });
  const vidSound = rawList.map(function (x) { return x.s; });
  const vidText = rawList.map(function (x) { return x.t || ""; });
  let video = videos[0] || "";
  const videoSec = Number((pack && pack.videoSec) || data.videoSec || 20);
  const videoGap = Number((pack && pack.videoGap) || data.videoGap || 5);
  window._promo = window._promo || { url: "", timer: null, i: 0 };
  const promoKey = videos.join("|") + "|" + videoSec + "|" + videoGap;
  if (videos.length && window._promo.url !== promoKey) {
    window._promo.url = promoKey;
    window._promo.i = 0;
    clearInterval(window._promo.timer);
    clearTimeout(window._promo.wait);
    function cover(on) {
      let c = document.getElementById("tvcover");
      if (!c) {
        c = document.createElement("div");
        c.id = "tvcover";
        Object.assign(c.style, {
          position: "fixed", inset: "0", background: "#000", zIndex: "40",
          opacity: "1", transition: "opacity .5s ease", pointerEvents: "none"
        });
        document.body.appendChild(c);
      }
      c.style.opacity = on ? "1" : "0";
      if (!on) setTimeout(function () { if (c.parentNode) c.remove(); }, 550);
    }
    function showPromo() {
      let v = document.getElementById("tvvid");
      if (v) v.remove();
      cover(true);
      v = document.createElement("video");
      v.id = "tvvid";
      const ix = window._promo.i % videos.length;
      v.src = videos[ix];
      const loud = !!(vidSound && vidSound[ix]);
      window._promo.i += 1;
      v.autoplay = true;
      v.muted = !loud;
      v.defaultMuted = !loud;
      v.volume = loud ? 1 : 0;
      v.playsInline = true;
      v.controls = false;
      v.disablePictureInPicture = true;
      Object.assign(v.style, {
        position: "fixed", inset: "0", width: "100%", height: "100%", objectFit: "cover",
        zIndex: "20", background: "#000"
      });
      document.body.appendChild(v);
      let cap = document.getElementById("tvcap");
      if (cap) cap.remove();
      const line = (vidText && vidText[ix]) || "";
      if (line) {
        cap = document.createElement("div");
        cap.id = "tvcap";
        cap.textContent = line;
        Object.assign(cap.style, {
          position: "fixed", left: "0", right: "0", bottom: "6vh", zIndex: "45",
          textAlign: "center", color: "#fff", fontFamily: "Montserrat, sans-serif",
          fontWeight: "800", fontSize: "3.2vw", letterSpacing: ".04em",
          textShadow: "0 2px 12px #000", pointerEvents: "none"
        });
        document.body.appendChild(cap);
      }
      v.play().catch(function () {});
      setTimeout(function () { cover(false); }, 600);
      const hold = Math.max(3, videoSec) * 1000;
      setTimeout(function () {
        cover(true);
        setTimeout(function () {
          const x = document.getElementById("tvvid");
          if (x) x.remove();
          const c2 = document.getElementById("tvcap");
          if (c2) c2.remove();
          cover(false);
          const wait = Math.max(1, videoGap) * 60 * 1000;
          window._promo.wait = setTimeout(showPromo, wait);
        }, 500);
      }, hold);
    }
    showPromo();
  }
  let sections = (pack && pack.sections && pack.sections.length)
    ? pack.sections
    : ((data.sections && data.sections.length) ? data.sections : []);
  if (pack && pack.pxW) data.pxW = pack.pxW;
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
      if (sec.sizes && sec.sizes.length > 1) {
        const sh = document.createElement("div");
        sh.className = "sizehead";
        sh.style.display = "grid";
        sh.style.gridTemplateColumns = "18px 1fr repeat(" + sec.sizes.length + ", 42px)";
        const labs = sec.sizes.map((s) => {
          const t = String(s || "");
          if (/fam/i.test(t)) return "Fam.";
          if (/alm/i.test(t)) return "Alm.";
          return t;
        });
        sh.innerHTML = "<span></span><span></span>" + labs.map((s, i) => "<span class=\"" + (/deep/i.test(String(sec.sizes[i]||"")) ? "sz-sm" : "") + "\">" + s + (i < labs.length - 1 ? " ·" : "") + "</span>").join("");
        box.appendChild(sh);
      }
      if (sec.note) {
        const n = document.createElement("p");
        n.className = "desc";
        n.textContent = sec.note;
        box.appendChild(n);
      }
      (sec.items || []).filter((it) => it && it.visible !== false).forEach((it) => {
        const el = document.createElement("article");
        el.className = "row";
        const nS = (sec.sizes && sec.sizes.length > 1) ? sec.sizes.length : 1;
        const top = document.createElement("div");
        top.className = "rowtop";
        top.style.gridTemplateColumns = nS > 1 ? ("18px 1fr repeat(" + nS + ", 42px)") : "18px 1fr 42px";
        top.innerHTML = `<div class="num"></div><div class="line"><span class="name"></span></div>`;
        el.appendChild(top);
        el.querySelector(".num").textContent = it.num || "";
        el.querySelector(".name").textContent = it.name || "";
        const base = Number(String(it.price || "").replace(",", "."));
        const lunchOn = Number(it.lunchAdd || 0) && isNight(it.lunchFrom || "11:00", it.lunchTo || "15:00");
        const nightOn = Number(it.nightAdd || 0) && isNight(it.nightFrom || "22:00", it.nightTo || "05:00");
        const add = lunchOn ? Number(it.lunchAdd) : (nightOn ? Number(it.nightAdd) : 0);
        const shown = (Number.isFinite(base) && it.price !== "" && it.price != null)
          ? String(base + add).replace(/\.0$/, "") + ",-"
          : (it.price ? it.price + ",-" : "");
        const list = (it.prices && it.prices.length) ? it.prices : [it.price];
        const need = nS > 1 ? nS : 1;
        for (let i = 0; i < need; i++) {
          const cell = document.createElement("div");
          cell.className = "price";
          const p = list[i];
          if (p !== "" && p != null) {
            const n = Number(String(p).replace(",", "."));
            cell.textContent = (Number.isFinite(n) ? String(n + add).replace(/\.0$/, "") : p) + ",-";
          }
          top.appendChild(cell);
        }
        if (it.desc) {
          const d = document.createElement("p");
          d.className = "desc";
          d.textContent = it.desc;
          el.appendChild(d);
        }
        if (add) {
          const n = document.createElement("span");
          n.className = "badge";
          n.textContent = lunchOn ? "frokost" : "nat";
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
  ref.onSnapshot((snap) => {
    if (!snap.exists) return;
    lastMenu = snap.data();
    const b = String(lastMenu.bump || "");
    const seen = sessionStorage.getItem("skaermBump") || "";
    if (b && seen && b !== seen) {
      sessionStorage.setItem("skaermBump", b);
      const c = document.createElement("div");
      c.style.cssText = "position:fixed;inset:0;background:#000;z-index:99";
      document.body.appendChild(c);
      setTimeout(function () { location.reload(); }, 2500);
      return;
    }
    if (b && !seen) sessionStorage.setItem("skaermBump", b);
    render(lastMenu);
  });
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
