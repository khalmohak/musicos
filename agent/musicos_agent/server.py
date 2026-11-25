"""HTTP API + static UI server. Stdlib only (Pillow optional, for cover thumbnails)."""
import hashlib
import io
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import config, system
from .mpd import MPDError

try:
    from PIL import Image
except ImportError:  # dev machines without Pillow serve originals
    Image = None

COVER_NAMES = ("cover", "folder", "front", "album", "albumart")
COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _sniff(data):
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


class Covers:
    """Finds album art (folder image first, then embedded via MPD) and caches resized copies."""

    def __init__(self, client, music_root):
        self.client, self.root = client, os.path.realpath(music_root)
        self.cache = os.path.join(config.state_dir(), "covers")
        os.makedirs(self.cache, exist_ok=True)

    def _folder_image(self, uri):
        d = os.path.realpath(os.path.join(self.root, os.path.dirname(uri)))
        if not d.startswith(self.root + os.sep) or not os.path.isdir(d):
            return None
        try:
            names = os.listdir(d)
        except OSError:
            return None
        by_lower = {n.lower(): n for n in names if not n.startswith(".")}
        for base in COVER_NAMES:
            for ext in COVER_EXTS:
                if base + ext in by_lower:
                    with open(os.path.join(d, by_lower[base + ext]), "rb") as fh:
                        return fh.read()
        return None

    def get(self, uri, size, blur=False):
        size = max(0, min(int(size or 0), 1600))
        if blur:
            size = 96
        key = hashlib.sha1(("%s|%d|%d" % (uri, size, int(bool(blur)))).encode()).hexdigest()
        path = os.path.join(self.cache, key)
        if os.path.exists(path):
            with open(path, "rb") as fh:
                return fh.read()
        data = self._folder_image(uri) or self.client.albumart(uri)
        if not data:
            return None
        if size and Image is not None:
            try:
                im = Image.open(io.BytesIO(data)).convert("RGB")
                if blur:
                    # backdrop: blurred once here so the TV never runs a CSS blur filter;
                    # the browser's smooth upscaling of a tiny image does the rest
                    from PIL import ImageFilter
                    im = im.resize((24, 24), Image.BILINEAR).resize((size, size), Image.BICUBIC)
                    im = im.filter(ImageFilter.GaussianBlur(6))
                im.thumbnail((size, size), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=86, optimize=True)
                data = buf.getvalue()
            except Exception:  # corrupt image: serve as-is
                pass
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
        return data


def make_handler(client, ui_dir, covers, port):
    ui_dir = os.path.realpath(ui_dir)

    class Handler(BaseHTTPRequestHandler):
        server_version = "musicos-agent/0.2"

        def log_message(self, fmt, *args):
            if len(args) > 1 and str(args[1]).startswith(("4", "5")):
                super().log_message(fmt, *args)

        def _send(self, code, body, ctype="application/json", cache=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache or "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}") if n else {}

        def _static(self, path):
            rel = path.lstrip("/") or "index.html"
            full = os.path.realpath(os.path.join(ui_dir, rel))
            if not full.startswith(ui_dir + os.sep):
                return self._send(404, {"error": "not found"})
            if not os.path.isfile(full):
                if "." in os.path.basename(rel):
                    return self._send(404, {"error": "not found"})
                full = os.path.join(ui_dir, "index.html")  # SPA routes, e.g. /phone
            cache = "public, max-age=31536000, immutable" if "/assets/" in full else "no-cache"
            with open(full, "rb") as fh:
                self._send(200, fh.read(), mimetypes.guess_type(full)[0] or "application/octet-stream", cache)

        def do_GET(self):
            url = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            p = url.path
            try:
                if p == "/api/status":
                    return self._send(200, client.status())
                if p == "/api/info":
                    return self._send(200, dict(system.device_info(port), backend=type(client).__name__))
                if p == "/api/config":
                    return self._send(200, config.load())
                if p == "/api/stats":
                    return self._send(200, client.stats())
                if p == "/api/artists":
                    return self._send(200, client.artists())
                if p == "/api/albums":
                    if "artist" in q:
                        return self._send(200, client.albums(q["artist"]))
                    return self._send(200, client.all_albums())
                if p == "/api/tracks":
                    return self._send(200, client.tracks(q.get("artist", ""), q.get("album", "")))
                if p == "/api/art":
                    data = covers.get(q.get("file", ""), q.get("size", 0), q.get("blur") == "1")
                    if not data:
                        return self._send(404, {}, cache="max-age=300")
                    return self._send(200, data, _sniff(data), "public, max-age=604800")
                if p == "/api/audio/outputs":
                    return self._send(200, system.audio_outputs())
                if p == "/api/sources":
                    return self._send(200, system.music_sources(covers.root))
                if p == "/api/network":
                    return self._send(200, system.network_status())
                if p == "/api/network/wifi":
                    return self._send(200, system.wifi_scan())
                if p == "/api/access":
                    return self._send(200, system.access_info(port))
                if p.startswith("/api/"):
                    return self._send(404, {"error": "unknown endpoint"})
                return self._static(p)
            except (MPDError, OSError) as e:
                return self._send(502, {"error": str(e)})

        def do_POST(self):
            p = urlparse(self.path).path
            try:
                b = self._body()
                safe = {k: ("***" if k == "password" else v) for k, v in b.items()} if isinstance(b, dict) else b
                print("POST %s %s" % (p, json.dumps(safe)), flush=True)
                if p == "/api/play":
                    client.play_album(b["artist"], b["album"], b.get("pos", 0))
                elif p == "/api/control":
                    client.control(b["action"])
                elif p == "/api/volume":
                    client.set_volume(b["volume"])
                elif p == "/api/update":
                    client.update()
                    return self._send(200, client.stats())
                elif p == "/api/config":
                    return self._send(200, config.update(b))
                elif p == "/api/audio/output":
                    cfg = config.update({"audioDevice": b["id"]})
                    config.request_apply()
                    return self._send(200, cfg)
                elif p == "/api/audio/bitperfect":
                    cfg = config.update({"bitPerfect": bool(b["on"])})
                    config.request_apply()
                    return self._send(200, cfg)
                elif p == "/api/network/wifi":
                    return self._send(200, system.wifi_connect(b["ssid"], b.get("password", "")))
                elif p == "/api/audio/test":
                    system.play_test_sound(b.get("id", "default"))
                    return self._send(200, {"ok": True})
                elif p == "/api/sources/smb":
                    sid = config.add_smb(b.get("name", ""), b["server"], b["share"], b.get("path", ""),
                                         b.get("username", ""), b.get("password", ""))
                    return self._send(200, {"id": sid})
                elif p == "/api/sources/remove":
                    config.remove_source(b["id"])
                    return self._send(200, {"ok": True})
                else:
                    return self._send(404, {"error": "unknown endpoint"})
                return self._send(200, client.status())
            except (KeyError, ValueError) as e:
                return self._send(400, {"error": "bad request: %s" % e})
            except (MPDError, OSError, RuntimeError) as e:
                return self._send(502, {"error": str(e)})

    return Handler


def serve(client, ui_dir, host, port, music_root):
    covers = Covers(client, music_root)
    httpd = ThreadingHTTPServer((host, port), make_handler(client, ui_dir, covers, port))
    print("musicos-agent on http://%s:%d (ui: %s, music: %s, backend: %s)"
          % (host, port, ui_dir, music_root, type(client).__name__), flush=True)
    httpd.serve_forever()
