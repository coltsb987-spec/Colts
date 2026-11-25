"""Tiny local web app (only reachable from this computer: 127.0.0.1). Standard library only."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import db
from .classify import KIND_LABEL
from .scoring import band
from .search import ALL, estimate, run_search, too_big_message

STATIC = Path(__file__).resolve().parent / "static"


class App:
    def __init__(self, db_path, client, settings, site_checker, demo=False):
        self.db_path, self.client, self.settings, self.site_checker, self.demo = db_path, client, settings, site_checker, demo
        self.lock = threading.Lock()  # one paid search at a time
        self._local = threading.local()

    @property
    def con(self):
        """Each thread gets its own database connection (SQLite connections can't be shared)."""
        if not hasattr(self._local, "con"):
            self._local.con = db.connect(self.db_path)
        return self._local.con

    def start_search(self, place, radius, business_type):
        est = estimate(self.con, self.client, self.settings, place, radius, business_type)
        if est["too_big"]:
            raise ValueError(too_big_message(est["min_requests"], est["request_cap"]))
        sid = db.create_search(self.con, place_query=est["place"], place_label=est["label"], lat=est["lat"],
                               lng=est["lng"], radius_miles=est["radius_miles"], business_type=business_type)

        def work():
            with self.lock:
                con = self.con
                try:
                    run_search(con, self.client, self.settings, place, radius, business_type,
                               site_checker=self.site_checker, search_id=sid)
                except Exception as e:  # keep the app alive; show the error on the search
                    db.update_search(con, sid, status="failed", message=str(e), finished_at=db.now())
        threading.Thread(target=work, daemon=True).start()
        return sid


def make_handler(app):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            p = self.path.split("?")[0].rstrip("/")
            if p in ("", "/index.html"):
                return self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
            if p == "/api/config":
                s = app.settings
                return self._send(200, {"types": [ALL, *s["business_types"]], "demo": app.demo,
                                        "cost_per_request_usd": s["cost_per_text_search_usd"],
                                        "request_cap": s["max_requests_per_search"]})
            if p == "/api/searches":
                return self._send(200, db.list_searches(app.con))
            parts = p.split("/")
            if len(parts) >= 4 and parts[2] == "searches" and parts[3].isdigit():
                sid = int(parts[3])
                s = db.get_search(app.con, sid)
                if not s:
                    return self._send(404, {"error": "No such search"})
                if len(parts) == 5 and parts[4] == "leads":
                    leads = db.leads_for_search(app.con, sid)
                    for l in leads:
                        l["band"], l["website_label"] = band(l["score"]), KIND_LABEL.get(l["website_kind"], "")
                    return self._send(200, leads)
                return self._send(200, s)
            self._send(404, {"error": "Not found"})

        def do_POST(self):
            # Block other websites from triggering paid searches via the browser.
            origin = self.headers.get("Origin", "")
            host = self.headers.get("Host", "")
            if origin and origin.split("://", 1)[-1] != host:
                return self._send(403, {"error": "Blocked cross-site request"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                args = (body.get("place", ""), body.get("radius", 0), body.get("business_type", ALL))
                if self.path == "/api/estimate":
                    return self._send(200, estimate(app.con, app.client, app.settings, *args))
                if self.path == "/api/searches":
                    if body.get("confirm") is not True:
                        return self._send(400, {"error": "Confirm the cost first."})
                    return self._send(200, {"id": app.start_search(*args)})
                self._send(404, {"error": "Not found"})
            except Exception as e:
                self._send(400, {"error": str(e)})
    return H


def serve(app, port=8765):
    httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(app))
    print(f"Lead Finder running: open http://127.0.0.1:{port} in your browser. Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
