"""HTTP API + static UI server. Stdlib only (Pillow optional, for cover thumbnails)."""
import hashlib
import io
import json
import mimetypes
import os
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import time as _time

from . import albuminfo, config, device, installer, library, netshare, receivers, scan, system, updates
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


class OnlineArt:
    """Front covers from MusicBrainz + Cover Art Archive for albums with no local art.
    One request per second (MusicBrainz rule), misses remembered for a week."""

    UA = "musicos/0.2"

    def __init__(self, cache_dir):
        import threading
        self.lock = threading.Lock()
        self.miss_file = os.path.join(cache_dir, "online-misses.json")
        try:
            with open(self.miss_file) as fh:
                self.misses = json.load(fh)
        except (OSError, ValueError):
            self.misses = {}
        self.last = 0.0

    def _get(self, url, binary=False):
        import time
        import urllib.request
        with self.lock:
            wait = 1.1 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": self.UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read()
        return data if binary else json.loads(data)

    def fetch(self, artist, album):
        import time
        import urllib.parse
        key = "%s\x00%s" % (artist.casefold(), album.casefold())
        if time.time() - self.misses.get(key, 0) < 7 * 86400 or not artist or not album:
            return None
        clean = lambda s: re.sub(r'[\\"+\-!(){}\[\]^~*?:/]|&&|\|\|', " ", re.sub(r"\(.*?\)|\[.*?\]", "", s)).strip()
        q = 'release:"%s" AND artist:"%s"' % (clean(album), clean(artist))
        try:
            res = self._get("https://musicbrainz.org/ws/2/release/?fmt=json&limit=5&query=" + urllib.parse.quote(q))
            for rel in res.get("releases", []):
                if rel.get("score", 0) < 80:
                    continue
                try:
                    return self._get("https://coverartarchive.org/release/%s/front-500" % rel["id"], binary=True)
                except Exception:
                    continue
        except Exception as e:  # offline, timeout, rate-limited: try again another day
            print("online art: %s - %s: %s" % (artist, album, e), flush=True)
        self.misses[key] = time.time()
        try:
            with open(self.miss_file, "w") as fh:
                json.dump(self.misses, fh)
        except OSError:
            pass
        return None


class Covers:
    """Finds album art (folder image first, then embedded via MPD) and caches resized copies."""

    def __init__(self, client, music_root):
        self.client, self.root = client, os.path.realpath(music_root)
        self.cache = os.path.join(config.state_dir(), "covers")
        os.makedirs(self.cache, exist_ok=True)
        self.online = OnlineArt(self.cache)
        self._dirs = (None, {})

    def _album_for(self, uri):
        """(artist, album) of the album folder holding uri, from the library index."""
        try:
            albums = self.client.all_albums()
        except Exception:
            return None
        if self._dirs[0] is not albums:
            self._dirs = (albums, {os.path.dirname(a["file"]): (a["artist"], a["album"]) for a in albums})
        return self._dirs[1].get(os.path.dirname(uri))

    def _online(self, uri):
        if not config.load().get("onlineArt", True):
            return None
        meta = self._album_for(uri)
        if not meta:
            return None
        # one cached original per album folder, shared by every track and size
        key = os.path.join(self.cache, "online-" + hashlib.sha1(os.path.dirname(uri).encode()).hexdigest())
        if os.path.exists(key):
            with open(key, "rb") as fh:
                return fh.read()
        data = self.online.fetch(*meta)
        if data:
            with open(key, "wb") as fh:
                fh.write(data)
        return data

    def _folder_image(self, uri):
        rel = os.path.normpath(os.path.dirname(uri))
        if rel.startswith("..") or os.path.isabs(rel):
            return None
        d = os.path.realpath(os.path.join(self.root, rel))
        # library folders are symlinks into the music sources: allow both trees
        allowed = (self.root + os.sep, os.path.realpath(library.MUSIC_ROOT) + os.sep)
        if not d.startswith(allowed) or not os.path.isdir(d):
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

    def get_file(self, path, size, keep_alpha=False):
        """Resize an arbitrary image file (artist photos, backdrops, logos) with the same cache."""
        size = max(0, min(int(size or 0), 2400))
        key = hashlib.sha1(("file|%s|%d|%d" % (path, size, os.path.getmtime(path))).encode()).hexdigest()
        cached = os.path.join(self.cache, key)
        if os.path.exists(cached):
            with open(cached, "rb") as fh:
                return fh.read()
        with open(path, "rb") as fh:
            data = fh.read()
        if size and Image is not None:
            try:
                im = Image.open(io.BytesIO(data))
                im = im.convert("RGBA" if keep_alpha else "RGB")
                im.thumbnail((size, size), Image.LANCZOS)
                buf = io.BytesIO()
                if keep_alpha:
                    im.save(buf, "PNG", optimize=True)
                else:
                    im.save(buf, "JPEG", quality=86, optimize=True)
                data = buf.getvalue()
            except Exception:
                pass
        with open(cached + ".tmp", "wb") as fh:
            fh.write(data)
        os.replace(cached + ".tmp", cached)
        return data

    def get(self, uri, size, blur=False):
        size = max(0, min(int(size or 0), 1600))
        if blur:
            size = 96
        key = hashlib.sha1(("%s|%d|%d" % (uri, size, int(bool(blur)))).encode()).hexdigest()
        path = os.path.join(self.cache, key)
        if os.path.exists(path):
            with open(path, "rb") as fh:
                return fh.read()
        data = self._folder_image(uri) or self.client.albumart(uri) or self._online(uri)
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


LRC_TIME = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
LRC_OFFSET = re.compile(r"\[offset:\s*([+-]?\d+)\]", re.I)
PHOTO_NAMES = ("folder", "artist", "photo", "poster")
BACKDROP_NAMES = ("backdrop", "backdrop1", "fanart", "background")


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", s.casefold())


def lyrics_for(root, uri):
    """Synced (.lrc) or plain (.txt) lyrics stored next to the audio file."""
    base = os.path.realpath(os.path.join(root, os.path.splitext(uri)[0]))
    if not base.startswith(root + os.sep):
        return None
    for ext, synced in ((".lrc", True), (".txt", False)):
        try:
            with open(base + ext, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        if not synced:
            lines = [l.strip() for l in text.splitlines()]
            return {"synced": False, "lines": [{"t": None, "text": l} for l in lines]}
        m = LRC_OFFSET.search(text)
        offset = int(m.group(1)) / 1000.0 if m else 0.0
        out = []
        for line in text.splitlines():
            stamps = LRC_TIME.findall(line)
            if not stamps:
                continue
            words = LRC_TIME.sub("", line).strip()
            for mm, ss in stamps:
                out.append({"t": max(0.0, int(mm) * 60 + float(ss) - offset), "text": words})
        out.sort(key=lambda l: l["t"])
        if out:
            return {"synced": True, "lines": out}
    return None


def artist_dir(root, uri, artist):
    """The artist folder above an album (Artist/Album/track), if it really is that artist's."""
    d = os.path.realpath(os.path.join(root, os.path.dirname(os.path.dirname(uri))))
    if not d.startswith(root + os.sep) or not os.path.isdir(d):
        return None
    a, n = _norm(artist), _norm(os.path.basename(d))
    if not a or not n or (a not in n and n not in a):
        return None
    return d


def artist_image(root, uri, artist, kind):
    d = artist_dir(root, uri, artist)
    if not d:
        return None
    try:
        names = {n.lower(): n for n in os.listdir(d) if not n.startswith(".")}
    except OSError:
        return None
    if kind == "logo":
        cands = ["logo.png", "clearlogo.png"]
    else:
        cands = [b + e for b in (PHOTO_NAMES if kind == "photo" else BACKDROP_NAMES) for e in (".jpg", ".jpeg", ".png", ".webp")]
    for c in cands:
        if c in names:
            return os.path.join(d, names[c])
    return None


def cec_wake():
    """Turn the TV on and switch to us (HDMI-CEC), fire and forget."""
    helper = "/usr/local/lib/musicos/cec"
    if os.path.exists(helper):
        try:
            subprocess.Popen([helper, "wake"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass


ACTIVITY = {"at": _time.time(), "slept": False}


def auto_sleep(client):
    """After `autoSleep` idle minutes with nothing playing: TV off (CEC), optionally suspend."""
    import threading

    def loop():
        while True:
            _time.sleep(30)
            try:
                cfg = config.load()
                mins = int(cfg.get("autoSleep") or 0)
                if not mins or ACTIVITY["slept"]:
                    continue
                if client.status().get("state") == "play":
                    ACTIVITY["at"] = _time.time()
                    continue
                if _time.time() - ACTIVITY["at"] > mins * 60:
                    ACTIVITY["slept"] = True
                    print("auto-sleep after %d idle minutes" % mins, flush=True)
                    device.power("sleep" if cfg.get("sleepSystem") else "tv-off")
            except Exception as e:
                print("auto-sleep: %s" % e, flush=True)

    threading.Thread(target=loop, daemon=True).start()


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
                    st = client.status()
                    st["receiver"] = receivers.status()
                    sc = scan.STATE
                    st["scan"] = {"active": sc["active"], "pct": sc["pct"], "phase": sc["phase"]} if sc["active"] else None
                    return self._send(200, st)
                if p == "/api/scan":
                    return self._send(200, scan.status())
                if p == "/api/receiver/cover":
                    data = receivers.COVER["data"]
                    if not data:
                        return self._send(404, {})
                    if q.get("blur") == "1" and Image is not None:
                        try:  # same pre-blurred backdrop as albums: no CSS blur on the TV
                            from PIL import ImageFilter
                            im = Image.open(io.BytesIO(data)).convert("RGB").resize((24, 24), Image.BILINEAR)
                            im = im.resize((96, 96), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))
                            buf = io.BytesIO()
                            im.save(buf, "JPEG", quality=85)
                            return self._send(200, buf.getvalue(), "image/jpeg")
                        except Exception:
                            pass
                    return self._send(200, data, receivers.COVER["type"])
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
                    albums = client.all_albums()
                    if LIBRARY_MODE:
                        hidden, offline = library.hidden_folders(), library.offline_folders()
                        albums = [dict(a, offline=True) if library.folder_of(a["file"]) in offline else a
                                  for a in albums if library.folder_of(a["file"]) not in hidden]
                    return self._send(200, albums)
                if p == "/api/library":
                    return self._send(200, library.overview(client if LIBRARY_MODE else None))
                if p in ("/api/info/album", "/api/info/track"):
                    artist_, album_ = q.get("artist", ""), q.get("album", "")
                    tracks = [t.get("title", "") for t in client.tracks(artist_, album_)] if artist_ and album_ else []
                    all_ = client.all_albums()
                    year = next((a.get("year", "") for a in all_ if a["artist"] == artist_ and a["album"] == album_), "")
                    albuminfo.LIBRARY_ARTISTS = sorted({a["artist"] for a in all_})
                    if p == "/api/info/track":
                        return self._send(200, albuminfo.track(artist_, album_, q.get("title", ""), year, tracks))
                    d = albuminfo.album(artist_, album_, year, tracks)
                    if d.get("discography"):  # mark what's already in the library
                        have = {(a["artist"].casefold(), albuminfo._norm(a["album"])) for a in client.all_albums()}
                        d = dict(d, discography=[dict(x, have=(artist_.casefold(), albuminfo._norm(x["album"])) in have) for x in d["discography"]])
                    return self._send(200, d)
                if p == "/api/info/artist":
                    return self._send(200, albuminfo.artist(q.get("name", "")))
                if p == "/api/info/keys":
                    k = albuminfo.keys()
                    return self._send(200, {n: bool(k.get(n)) for n in ("openai", "discogs", "lastfm")})
                if p == "/api/net/discover":
                    return self._send(200, netshare.discover())
                if p == "/api/library/browse":
                    return self._send(200, library.browse(q.get("source", ""), q.get("path", "")))
                if p == "/api/tracks":
                    return self._send(200, client.tracks(q.get("artist", ""), q.get("album", "")))
                if p == "/api/art":
                    data = covers.get(q.get("file", ""), q.get("size", 0), q.get("blur") == "1")
                    if not data:
                        return self._send(404, {}, cache="max-age=300")
                    return self._send(200, data, _sniff(data), "public, max-age=604800")
                if p == "/api/queue":
                    return self._send(200, client.queue())
                if p == "/api/search":
                    return self._send(200, client.search(q.get("q", "")))
                if p == "/api/lyrics":
                    return self._send(200, lyrics_for(covers.root, q.get("file", "")) or {"synced": False, "lines": []})
                if p == "/api/artist-index":
                    albums = client.all_albums()
                    # one photo lookup per artist means a file system walk per artist (slow on a
                    # network share): reuse the result until the album list itself changes
                    if ARTIST_INDEX.get("albums") is not albums:
                        groups = {}
                        for a in albums:
                            g = groups.setdefault(a["artist"], {"artist": a["artist"], "albums": 0, "file": a["file"]})
                            g["albums"] += 1
                        out = []
                        for g in sorted(groups.values(), key=lambda g: g["artist"].casefold()):
                            g["photo"] = bool(artist_image(covers.root, g["file"], g["artist"], "photo"))
                            out.append(g)
                        ARTIST_INDEX.update(albums=albums, out=out)
                    return self._send(200, ARTIST_INDEX["out"])
                if p == "/api/artist":
                    name = q.get("name", "")
                    albums = [a for a in client.all_albums() if a["artist"] == name]
                    f = albums[0]["file"] if albums else ""
                    has = {k: bool(f and artist_image(covers.root, f, name, k)) for k in ("photo", "backdrop", "logo")}
                    return self._send(200, dict(artist=name, albums=albums, file=f, **has))
                if p == "/api/artist-art":
                    path = artist_image(covers.root, q.get("file", ""), q.get("artist", ""), q.get("kind", "photo"))
                    if not path:
                        return self._send(404, {}, cache="max-age=300")
                    data = covers.get_file(path, q.get("size", 0), keep_alpha=q.get("kind") == "logo")
                    return self._send(200, data, _sniff(data), "public, max-age=604800")
                if p == "/api/audio/outputs":
                    return self._send(200, system.audio_outputs())
                if p == "/api/sources":
                    return self._send(200, system.music_sources(covers.root))
                if p == "/api/report":
                    path = os.path.join(config.state_dir(), "report.txt")
                    try:
                        st = os.stat(path)
                        with open(path, errors="replace") as fh:
                            return self._send(200, {"text": fh.read(), "at": st.st_mtime})
                    except OSError:
                        return self._send(200, {"text": "", "at": 0})
                if p == "/api/receivers":
                    cfg = config.load()
                    return self._send(200, {"name": cfg.get("receiverName", "musicos"),
                                            "airplay": {"on": cfg.get("airplay", True), "installed": os.path.exists("/usr/bin/shairport-sync")},
                                            "spotify": {"on": cfg.get("spotify", True), "installed": os.path.exists("/usr/bin/librespot")}})
                if p == "/api/update":
                    return self._send(200, updates.status())
                if p == "/api/install":
                    return self._send(200, installer.disks())
                if p == "/api/timezones":
                    return self._send(200, device.timezones())
                if p == "/api/display":
                    return self._send(200, device.display_modes())
                if p == "/api/bluetooth":
                    return self._send(200, device.bt_devices())
                if p == "/api/wifi/saved":
                    return self._send(200, device.wifi_saved())
                if p == "/api/connections":
                    return self._send(200, device.active_connections())
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
                ACTIVITY["at"], ACTIVITY["slept"] = _time.time(), False
                safe = {k: ("***" if k in ("password", "openai", "discogs", "lastfm") else v) for k, v in b.items()} if isinstance(b, dict) else b
                print("POST %s %s" % (p, json.dumps(safe)), flush=True)
                if p == "/api/receiver":
                    if self.client_address[0] not in ("127.0.0.1", "::1"):
                        return self._send(403, {"error": "local only"})
                    receivers.event(b)
                    return self._send(200, {"ok": True})
                if p == "/api/play":
                    receivers.release_for_local_playback()
                    client.play_album(b["artist"], b["album"], b.get("pos", 0))
                    cec_wake()
                elif p == "/api/queue/play":
                    receivers.release_for_local_playback()
                    client.play_pos(b["pos"])
                elif p == "/api/queue/add":
                    client.enqueue_album(b["artist"], b["album"], b.get("mode", "end"))
                elif p == "/api/queue/clear":
                    client.clear_queue()
                elif p == "/api/shuffle":
                    receivers.release_for_local_playback()
                    client.shuffle_play(b.get("artist"), b.get("album"))
                    cec_wake()
                elif p == "/api/control":
                    client.control(b["action"])
                elif p == "/api/seek":
                    client.seek(b["to"])
                elif p == "/api/volume":
                    client.set_volume(b["volume"])
                elif p == "/api/update":
                    full = bool(b.get("full"))  # re-read every file's tags, not just new/changed
                    if LIBRARY_MODE:
                        library.scan_all(client, full)  # connected folders only
                    elif full:
                        client.rescan()
                    else:
                        client.update()
                    return self._send(200, client.stats())
                elif p == "/api/info/keys":
                    return self._send(200, albuminfo.set_keys(b))
                elif p == "/api/net/shares":
                    return self._send(200, netshare.shares(b.get("protocol", "smb"), b["server"], b.get("username", ""), b.get("password", "")))
                elif p == "/api/net/test":
                    return self._send(200, netshare.test(b.get("protocol", "smb"), b["server"], b.get("share", ""), b.get("path", ""),
                                                         b.get("username", ""), b.get("password", "")))
                elif p == "/api/sources/nfs":
                    return self._send(200, {"id": config.add_nfs(b.get("name", ""), b["server"], b["share"], b.get("path", ""))})
                elif p == "/api/library/add":
                    return self._send(200, library.add_folder(b["source"], b.get("path", ""), client if LIBRARY_MODE else None))
                elif p == "/api/library/remove":
                    return self._send(200, library.remove_folder(b["id"], client if LIBRARY_MODE else None))
                elif p == "/api/library/enable":
                    return self._send(200, library.set_enabled(b["id"], b.get("on", True)))
                elif p == "/api/library/ignore":
                    return self._send(200, library.ignore_drive(b["source"]))
                elif p == "/api/library/scan":
                    fid = b["id"]
                    if not any(f["id"] == fid for f in library.folders() or []):
                        raise ValueError("no such folder")
                    (client.rescan if b.get("full") else client.update)(fid)
                    return self._send(200, {"ok": True})
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
                elif p == "/api/receivers":
                    changes = {k: b[k] for k in ("airplay", "spotify") if k in b}
                    if "name" in b:
                        changes["receiverName"] = str(b["name"])[:40]
                    cfg = config.update(changes)
                    config.request_apply()
                    return self._send(200, {"ok": True, "name": cfg.get("receiverName")})
                elif p == "/api/update/check":
                    url = b.get("url") or config.load().get("updateUrl", "")
                    if b.get("url"):
                        config.update({"updateUrl": b["url"]})
                    return self._send(200, updates.download(url))
                elif p == "/api/update/usb":
                    return self._send(200, updates.from_usb(b["path"]))
                elif p == "/api/update/install":
                    return self._send(200, updates.install())
                elif p == "/api/reset":
                    mode = b.get("mode")
                    if mode not in ("settings", "everything"):
                        raise ValueError("mode must be settings or everything")
                    with open(os.path.join(config.state_dir(), "reset-request"), "w") as fh:
                        fh.write(mode)
                    return self._send(200, {"ok": True})
                elif p == "/api/install":
                    return self._send(200, installer.request(b["path"], b.get("serial", ""), b["size"]))
                elif p == "/api/update/discard":
                    updates.discard()
                    return self._send(200, {"ok": True})
                elif p == "/api/perf":  # frame-time summary from the UI (logged with the request)
                    return self._send(200, {"ok": True})
                elif p == "/api/activity":
                    ACTIVITY["at"], ACTIVITY["slept"] = _time.time(), False
                    return self._send(200, {"ok": True})
                elif p == "/api/power":
                    device.power(b["action"])
                    return self._send(200, {"ok": True})
                elif p == "/api/timezone":
                    device.set_timezone(b["zone"])
                    return self._send(200, {"ok": True})
                elif p == "/api/display":
                    device.set_display_mode(b["output"], b["mode"])
                    return self._send(200, config.update({"displayMode": b["mode"]}))
                elif p == "/api/bluetooth/scan":
                    device.bt_scan()
                    return self._send(200, {"ok": True})
                elif p == "/api/bluetooth/pair":
                    device.bt_pair(b["mac"])
                    return self._send(200, {"ok": True})
                elif p == "/api/bluetooth/forget":
                    device.bt_forget(b["mac"])
                    return self._send(200, {"ok": True})
                elif p == "/api/wifi/forget":
                    device.wifi_forget(b["name"])
                    return self._send(200, {"ok": True})
                elif p == "/api/wifi/hidden":
                    device.wifi_hidden(b["ssid"], b.get("password", ""))
                    return self._send(200, {"ok": True})
                elif p == "/api/ipv4":
                    device.set_ipv4(b["connection"], b["method"], b.get("address", ""), b.get("prefix", 24),
                                    b.get("gateway", ""), b.get("dns", ""))
                    return self._send(200, {"ok": True})
                elif p == "/api/report":
                    with open(os.path.join(config.state_dir(), "report-request"), "w") as fh:
                        fh.write(str(os.getpid()))
                    return self._send(200, {"ok": True})
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


def watch_sources(client, root):
    """Rescan the library when a drive or share appears under the music root (MPD's inotify
    doesn't see automounts). Touching each entry also triggers its automount."""
    import threading
    import time

    def loop():
        seen = None
        while True:
            try:
                now = set()
                for name in os.listdir(root):
                    p = os.path.join(root, name)
                    if os.path.isdir(p) and not name.startswith("."):
                        try:
                            if os.listdir(p):
                                now.add(name)
                        except OSError:
                            pass
                if seen is not None and now - seen:
                    print("new music source(s): %s, rescanning" % ", ".join(sorted(now - seen)), flush=True)
                    client.update()
                seen = now
            except Exception as e:  # never let the watcher die
                print("source watcher: %s" % e, flush=True)
            time.sleep(10)

    threading.Thread(target=loop, daemon=True).start()


ARTIST_INDEX = {}  # {"albums": the album list it was built from, "out": the index}
LIBRARY_MODE = False  # MPD backend: the library is a set of chosen folders (library.py)


def serve(client, ui_dir, host, port, music_root):
    global LIBRARY_MODE
    if type(client).__name__ == "MPDClient":
        LIBRARY_MODE = True
        music_root = library.lib_dir()  # MPD's music_directory
        library.migrate(client)
        library.monitor(client)
    covers = Covers(client, music_root)
    auto_sleep(client)
    receivers.start()
    if type(client).__name__ == "MPDClient":
        threading.Thread(target=updates.auto_check, daemon=True).start()
        scan.start(client, os.path.realpath(music_root))
        albuminfo.start(client)
    httpd = ThreadingHTTPServer((host, port), make_handler(client, ui_dir, covers, port))
    print("musicos-agent on http://%s:%d (ui: %s, music: %s, backend: %s)"
          % (host, port, ui_dir, music_root, type(client).__name__), flush=True)
    httpd.serve_forever()
