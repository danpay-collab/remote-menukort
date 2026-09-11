#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import os
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data.json")
HEART = os.path.join(ROOT, "heartbeats.json")
PORT = int(os.environ.get("PORT", "8080"))


def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        db = read_json(DATA, {"customers": {}})
        hearts = read_json(HEART, {})

        if path == "/api/customers":
            out = []
            for cid, c in db.get("customers", {}).items():
                screens = hearts.get(cid, {})
                now = datetime.now(timezone.utc)
                colors = []
                for sid, s in screens.items():
                    try:
                        age = (now - datetime.fromisoformat(s["lastSeen"])).total_seconds()
                    except Exception:
                        age = 9999
                    colors.append("ok" if age < 45 else "down")
                if not colors:
                    status = "idle"
                elif all(x == "ok" for x in colors):
                    status = "ok"
                elif all(x == "down" for x in colors):
                    status = "down"
                else:
                    status = "warn"
                out.append({
                    "id": cid,
                    "name": c.get("name"),
                    "city": c.get("city"),
                    "lat": c.get("lat"),
                    "lng": c.get("lng"),
                    "status": status,
                    "screenCount": max(len(screens), 1),
                })
            return self._json(200, {"customers": out})

        if path == "/api/customer":
            cid = (qs.get("id") or [""])[0]
            c = db.get("customers", {}).get(cid)
            if not c:
                return self._json(404, {"error": "Ukendt kunde"})
            return self._json(200, {"id": cid, **c, "screens": hearts.get(cid, {})})

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "Ugyldig JSON"})

        if path == "/api/customer":
            cid = payload.get("id")
            if not cid:
                return self._json(400, {"error": "Mangler id"})
            db = read_json(DATA, {"customers": {}})
            db.setdefault("customers", {})
            prev = db["customers"].get(cid, {})
            keep = {
                "name", "city", "phone", "lat", "lng",
                "venue", "subtitle", "ticker", "footerNote", "items",
            }
            nxt = {**prev}
            for k in keep:
                if k in payload:
                    nxt[k] = payload[k]
            nxt["updatedAt"] = datetime.now(timezone.utc).isoformat()
            db["customers"][cid] = nxt
            write_json(DATA, db)
            return self._json(200, {"id": cid, **nxt})

        if path == "/api/heartbeat":
            cid = str(payload.get("customerId") or "")
            sid = str(payload.get("screenId") or "tv-1")
            if not cid:
                return self._json(400, {"error": "Mangler customerId"})
            hearts = read_json(HEART, {})
            hearts.setdefault(cid, {})
            hearts[cid][sid] = {
                "label": payload.get("label") or sid,
                "lastSeen": datetime.now(timezone.utc).isoformat(),
            }
            write_json(HEART, hearts)
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "Ukendt endpoint"})


if __name__ == "__main__":
    os.chdir(ROOT)
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("Skærmkort")
    print("  Admin:   http://127.0.0.1:%s/admin.html" % PORT)
    print("  TV Fyn:  http://127.0.0.1:%s/display.html?id=odense" % PORT)
    httpd.serve_forever()
