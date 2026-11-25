"""HTTP API + static UI server. Stdlib only so it runs on the image with no pip installs."""
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .mpd import MPDError


def _sniff(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    return "application/octet-stream"


def make_handler(client, ui_dir):
    ui_dir = os.path.realpath(ui_dir)

    class Handler(BaseHTTPRequestHandler):
        server_version = "musicos-agent/0.1"

        def log_message(self, fmt, *args):  # quieter logs: only errors
            if args and str(args[1]).startswith(("4", "5")):
                super().log_message(fmt, *args)

        # ---- helpers ----
        def _send(self, code, body, ctype="application/json", cache=False):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def _static(self, path):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = os.path.realpath(os.path.join(ui_dir, rel))
            if not full.startswith(ui_dir + os.sep) or not os.path.isfile(full):
                return self._send(404, {"error": "not found"})
            with open(full, "rb") as fh:
                self._send(200, fh.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

        # ---- routes ----
        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/api/status":
                    return self._send(200, client.status())
                if url.path == "/api/artists":
                    return self._send(200, client.artists())
                if url.path == "/api/albums":
                    return self._send(200, client.albums(q.get("artist", "")))
                if url.path == "/api/tracks":
                    return self._send(200, client.tracks(q.get("artist", ""), q.get("album", "")))
                if url.path == "/api/art":
                    data = client.albumart(q.get("file", ""))
                    return self._send(200, data, _sniff(data), cache=True) if data else self._send(404, {})
                if url.path.startswith("/api/"):
                    return self._send(404, {"error": "unknown endpoint"})
                return self._static(url.path)
            except (MPDError, OSError) as e:
                return self._send(502, {"error": str(e)})

        def do_POST(self):
            url = urlparse(self.path)
            try:
                b = self._body()
                if url.path == "/api/play":
                    client.play_album(b["artist"], b["album"], b.get("pos", 0))
                elif url.path == "/api/control":
                    client.control(b["action"])
                elif url.path == "/api/volume":
                    client.set_volume(b["volume"])
                elif url.path == "/api/update":
                    client.update()
                else:
                    return self._send(404, {"error": "unknown endpoint"})
                return self._send(200, client.status())
            except (KeyError, ValueError) as e:
                return self._send(400, {"error": "bad request: %s" % e})
            except (MPDError, OSError) as e:
                return self._send(502, {"error": str(e)})

    return Handler


def serve(client, ui_dir, host, port):
    httpd = ThreadingHTTPServer((host, port), make_handler(client, ui_dir))
    print("musicos-agent on http://%s:%d (ui: %s)" % (host, port, ui_dir), flush=True)
    httpd.serve_forever()
