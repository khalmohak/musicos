"""Development backend that reads an `Artist/YYYY - Album/NN - Title.ext` tree directly.

Lets the UI be designed against a real library (covers and all) on a machine without
MPD. Playback is simulated.
"""
import os
import re
import struct
import time

from .mpd import codec_of

AUDIO = (".flac", ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".alac", ".aiff")
YEAR_RE = re.compile(r"^(\d{4})\s*-\s*(.+)$")
TRACK_RE = re.compile(r"^(\d+)(?:-\d+)?\s*[-.]?\s*(.+)$")


def flac_format(path):
    """Sample rate / bit depth / channels from a FLAC file's STREAMINFO block (first 42 bytes)."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(42)
    except OSError:
        return None
    if len(head) < 42 or head[:4] != b"fLaC":
        return None
    info = head[8:]  # after "fLaC" + 4-byte block header
    packed = struct.unpack(">Q", info[10:18])[0]
    rate = packed >> 44
    channels = ((packed >> 41) & 0x7) + 1
    bits = ((packed >> 36) & 0x1F) + 1
    total = packed & 0xFFFFFFFFF
    return {"rate": rate, "bits": bits, "channels": channels, "float": False,
            "seconds": (total / rate) if rate else 0}


class FolderClient:
    def __init__(self, root):
        self.root = os.path.realpath(root)
        self._albums = None
        self.queue, self.pos, self.state, self.volume = [], 0, "stop", 60
        self.started, self.offset = 0.0, 0.0

    # ---- library ----
    def _scan(self):
        albums = []
        for artist in sorted(os.listdir(self.root), key=str.casefold):
            ap = os.path.join(self.root, artist)
            if artist.startswith(".") or not os.path.isdir(ap):
                continue
            for folder in sorted(os.listdir(ap)):
                bp = os.path.join(ap, folder)
                if folder.startswith(".") or not os.path.isdir(bp):
                    continue
                files = sorted(f for f in os.listdir(bp) if f.lower().endswith(AUDIO) and not f.startswith("."))
                if not files:
                    continue
                m = YEAR_RE.match(folder)
                year, title = (m.group(1), m.group(2)) if m else ("", folder)
                if year == "0":
                    year = ""
                first = os.path.join(bp, files[0])
                fmt = flac_format(first) if first.lower().endswith(".flac") else None
                if fmt:
                    fmt.pop("seconds", None)
                albums.append({"album": title.strip(), "artist": artist, "year": year,
                               "file": "%s/%s/%s" % (artist, folder, files[0]), "tracks": len(files),
                               "codec": codec_of(files[0]), "format": fmt,
                               "_dir": "%s/%s" % (artist, folder), "_files": files})
        return albums

    def _all(self):
        if self._albums is None:
            self._albums = self._scan()
        return self._albums

    @staticmethod
    def _public(a):
        return {k: v for k, v in a.items() if not k.startswith("_")}

    def all_albums(self):
        return [self._public(a) for a in self._all()]

    def artists(self):
        return sorted({a["artist"] for a in self._all()}, key=str.casefold)

    def albums(self, artist):
        return [self._public(a) for a in self._all() if a["artist"] == artist]

    def tracks(self, artist, album):
        for a in self._all():
            if a["artist"] == artist and a["album"] == album:
                out = []
                for i, f in enumerate(a["_files"]):
                    base = os.path.splitext(f)[0]
                    m = TRACK_RE.match(base)
                    num, title = (m.group(1), m.group(2)) if m else (str(i + 1), base)
                    fmt = flac_format(os.path.join(self.root, a["_dir"], f)) if f.lower().endswith(".flac") else None
                    secs = fmt.pop("seconds", 0) if fmt else 0
                    out.append({"file": "%s/%s" % (a["_dir"], f), "title": title, "track": num,
                                "duration": round(secs, 1), "codec": codec_of(f), "format": fmt,
                                "_artist": artist, "_album": album})
                return out
        return []

    def albumart(self, uri):
        return None  # server reads cover.jpg/folder.jpg from disk itself

    def stats(self):
        al = self._all()
        return {"artists": len({a["artist"] for a in al}), "albums": len(al),
                "songs": sum(a["tracks"] for a in al), "updating": False}

    def update(self):
        self._albums = None

    # ---- simulated playback ----
    def _elapsed(self):
        e = self.offset + (time.time() - self.started if self.state == "play" else 0)
        if e >= self._dur() and self.queue:
            self.pos = (self.pos + 1) % len(self.queue)
            self.started, self.offset, e = time.time(), 0.0, 0.0
        return e

    def _dur(self):
        song = self.queue[self.pos] if self.queue else None
        return (song or {}).get("duration") or 240.0

    def status(self):
        song = self.queue[self.pos] if self.queue and self.state != "stop" else None
        fmt = song.get("format") if song else None
        return {"state": self.state, "volume": self.volume, "elapsed": self._elapsed() if song else 0,
                "duration": self._dur() if song else 0,
                "audio": fmt if self.state == "play" else None,
                "bitrate": 0,
                "song": None if not song else {"file": song["file"], "title": song["title"],
                                               "artist": song["_artist"], "album": song["_album"],
                                               "format": fmt, "codec": song.get("codec", "")}}

    def play_album(self, artist, album, pos=0):
        self.queue, self.pos = self.tracks(artist, album), int(pos)
        self.state, self.started, self.offset = "play", time.time(), 0.0

    def control(self, action):
        if not self.queue:
            return
        if action in ("toggle", "pause", "play"):
            if self.state == "play" and action != "play":
                self.offset, self.state = self._elapsed(), "pause"
            elif action != "pause":
                self.state, self.started = "play", time.time()
        elif action in ("next", "previous"):
            self.pos = (self.pos + (1 if action == "next" else -1)) % len(self.queue)
            self.started, self.offset, self.state = time.time(), 0.0, "play"
        elif action == "stop":
            self.state, self.offset = "stop", 0.0

    def set_volume(self, volume):
        self.volume = max(0, min(100, int(volume)))
