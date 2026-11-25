"""Network receivers: AirPlay (shairport-sync) and Spotify Connect (librespot).

Both report through /usr/local/lib/musicos/receiver -> POST /api/receiver. AirPlay track
details and cover art come from shairport-sync's metadata pipe. When local playback starts,
the active receiver is restarted (drops the phone's session) so the speakers belong to MPD.
"""
import base64
import os
import re
import subprocess
import threading
import time

from . import config

STATE = {"active": False, "source": "", "state": "", "title": "", "artist": "", "album": "",
         "cover": "", "duration": 0.0, "position": 0.0, "device": "", "since": 0.0}
COVER = {"data": b"", "type": "image/jpeg"}
PIPE = "/run/musicos/shairport-metadata"
UNITS = {"airplay": "shairport-sync.service", "spotify": "musicos-spotify.service"}


def status():
    if not STATE["active"]:
        return None
    s = dict(STATE)
    if s["state"] == "play" and s["duration"]:
        s["position"] = min(s["duration"], s["position"] + time.time() - s["since"])
    return s


def _fetch_cover(url):
    def run():
        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "musicos/0.2"})
            with urllib.request.urlopen(req, timeout=8) as r:
                data = r.read()
            if STATE.get("remoteCover") == url:  # still the same track
                COVER["data"] = data
                COVER["type"] = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
                STATE["cover"] = "/api/receiver/cover?t=%d" % int(time.time() * 1000)
        except Exception as e:
            print("receiver cover: %s" % e, flush=True)
    threading.Thread(target=run, daemon=True).start()


def event(b):
    """From the receiver hook script (localhost only)."""
    src, ev = b.get("source", ""), b.get("event", "")
    if src not in UNITS:
        raise ValueError("unknown receiver")
    if ev in ("stop", "stopped", "session_disconnected"):
        STATE.update(active=False, state="")
        return
    STATE.update(active=True, source=src, since=time.time())
    if ev in ("start", "playing", "track_changed", "session_connected", "loading", "preloading"):
        STATE["state"] = "play" if ev != "session_connected" else STATE["state"] or "pause"
    elif ev == "paused":
        STATE["state"] = "pause"
    for k in ("title", "artist", "album", "device"):
        if b.get(k):
            STATE[k] = b[k]
    cover = b.get("cover") or ""
    if cover.startswith("http") and cover != STATE.get("remoteCover"):
        STATE["remoteCover"] = cover
        _fetch_cover(cover)
    if b.get("duration"):
        STATE["duration"] = float(b["duration"])
    if "position" in b and ev in ("playing", "paused", "track_changed", "seeked"):
        STATE["position"] = float(b.get("position") or 0)
    if src == "spotify" and ev == "track_changed" and not cover:
        COVER["data"] = b""
        STATE["cover"] = ""


def release_for_local_playback():
    """Local play pressed while a phone is streaming: end the phone's session."""
    if not STATE["active"]:
        return
    unit = UNITS.get(STATE["source"])
    STATE.update(active=False, state="")
    if unit:
        subprocess.Popen(["systemctl", "restart", "--no-block", unit], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["mpc", "-q", "enable", "musicos"], capture_output=True, timeout=5)


def _airplay_reader():
    """Parse shairport-sync's metadata pipe: <item><type>hex</type><code>hex</code>...<data>b64</data></item>."""
    item = re.compile(r"<item><type>([0-9a-f]{8})</type><code>([0-9a-f]{8})</code><length>(\d+)</length>(?:\s*<data encoding=\"base64\">\s*([A-Za-z0-9+/=\s]*?)\s*</data>)?</item>", re.S)
    while True:
        if not os.path.exists(PIPE):
            time.sleep(10)
            continue
        try:
            buf = ""
            with open(PIPE, "r", errors="replace") as fh:  # blocks until shairport-sync opens it
                for chunk in iter(lambda: fh.read(4096), ""):
                    buf += chunk
                    while True:
                        m = item.search(buf)
                        if not m:
                            buf = buf[-200000:]  # cover art can be large; keep a bounded tail
                            break
                        buf = buf[m.end():]
                        try:
                            typ = bytes.fromhex(m.group(1)).decode("latin-1")
                            code = bytes.fromhex(m.group(2)).decode("latin-1")
                            raw = re.sub(r"\s", "", m.group(4) or "")
                            data = base64.b64decode(raw + "=" * (-len(raw) % 4)) if raw else b""
                            _airplay_item(typ, code, data)
                        except Exception as e:  # one odd item must not stop track info
                            print("airplay metadata: skipped item: %s" % e, flush=True)
        except Exception as e:
            print("airplay metadata reader: %s" % e, flush=True)
            time.sleep(3)


def _airplay_item(typ, code, data):
    text = data.decode("utf-8", "replace")
    if typ == "core":
        key = {"minm": "title", "asar": "artist", "asal": "album"}.get(code)
        if key:
            STATE[key] = text
    elif typ == "ssnc":
        if code == "PICT" and data:
            COVER["data"] = data
            COVER["type"] = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
            STATE["cover"] = "/api/receiver/cover?t=%d" % int(time.time() * 1000)
        elif code == "pbeg":
            STATE.update(active=True, source="airplay", state="play", since=time.time())
        elif code == "pend":
            STATE.update(active=False, state="", title="", artist="", album="", cover="")
            COVER["data"] = b""
        elif code == "mdst":  # a new track's metadata starts: clear the old one
            STATE.update(title="", artist="", album="")
        elif code in ("pfls", "paus"):
            STATE["state"] = "pause"
        elif code in ("prsm", "pres"):
            STATE.update(state="play", since=time.time())
        elif code == "snua":
            STATE["device"] = text
        elif code == "prgr" and text.count("/") == 2:
            # RTP timestamps (44.1 kHz): start/current/end
            try:
                start, cur, end = (int(x) for x in text.split("/"))
                STATE["duration"] = max(0.0, (end - start) / 44100.0)
                STATE["position"] = max(0.0, (cur - start) / 44100.0)
                STATE["since"] = time.time()
            except ValueError:
                pass


def start():
    threading.Thread(target=_airplay_reader, daemon=True).start()
