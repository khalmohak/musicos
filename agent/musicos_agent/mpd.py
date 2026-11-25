"""Minimal MPD protocol client (stdlib only).

One short-lived TCP connection per call: MPD is local, so connect cost is negligible
and we never have to handle idle-timeout reconnects.
"""
import socket
from collections import OrderedDict


class MPDError(Exception):
    pass


def quote(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


CODECS = {".flac": "FLAC", ".mp3": "MP3", ".m4a": "AAC/ALAC", ".alac": "ALAC", ".ogg": "Vorbis", ".opus": "Opus",
          ".wav": "WAV", ".aiff": "AIFF", ".aif": "AIFF", ".dsf": "DSD", ".dff": "DSD", ".wv": "WavPack", ".ape": "APE"}


def codec_of(uri):
    dot = uri.rfind(".")
    return CODECS.get(uri[dot:].lower(), uri[dot + 1:].upper() if dot > 0 else "")


def parse_format(fmt):
    """MPD audio format "rate:bits:channels" (bits may be f, dsd: "dsd64:2") -> dict or None."""
    if not fmt:
        return None
    parts = fmt.split(":")
    if parts[0].startswith("dsd"):
        return {"rate": 0, "bits": 1, "channels": int(parts[-1]) if parts[-1].isdigit() else 2,
                "dsd": parts[0].upper()}
    if len(parts) != 3:
        return None
    rate = int(parts[0]) if parts[0].isdigit() else 0
    bits = 32 if parts[1] == "f" else (int(parts[1]) if parts[1].isdigit() else 0)
    return {"rate": rate, "bits": bits, "channels": int(parts[2]) if parts[2].isdigit() else 2,
            "float": parts[1] == "f"}


def _filter(**tags):
    """MPD 0.21+ filter expression, e.g. ((AlbumArtist == "X") AND (Album == "Y"))."""
    parts = ["(%s == %s)" % (k, quote(v)) for k, v in tags.items()]
    return parts[0] if len(parts) == 1 else "(" + " AND ".join(parts) + ")"


class MPDClient:
    def __init__(self, host="127.0.0.1", port=6600, timeout=10):
        self.host, self.port, self.timeout = host, port, timeout

    # ---- protocol ----
    def _run(self, *commands):
        """Send one or more commands; return list of (key, value) pairs and binary payload."""
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as sock:
            f = sock.makefile("rb")
            hello = f.readline().decode()
            if not hello.startswith("OK MPD"):
                raise MPDError("unexpected greeting: %r" % hello)
            if len(commands) == 1:
                payload = commands[0] + "\n"
            else:
                payload = "command_list_begin\n" + "\n".join(commands) + "\ncommand_list_end\n"
            sock.sendall(payload.encode())
            pairs, binary = [], b""
            while True:
                line = f.readline()
                if not line:
                    raise MPDError("connection closed")
                line = line.decode("utf-8", "replace").rstrip("\n")
                if line == "OK":
                    return pairs, binary
                if line.startswith("ACK"):
                    raise MPDError(line)
                key, _, value = line.partition(": ")
                if key == "binary":
                    binary = f.read(int(value))
                    f.readline()  # trailing newline after binary chunk
                else:
                    pairs.append((key, value))

    def _cmd(self, command):
        return self._run(command)[0]

    @staticmethod
    def _songs(pairs):
        songs, cur = [], None
        for k, v in pairs:
            if k == "file":
                cur = OrderedDict(file=v)
                songs.append(cur)
            elif cur is not None:
                cur[k] = v
        return songs

    # ---- library ----
    def artists(self):
        return sorted({v for k, v in self._cmd("list albumartist") if k == "AlbumArtist" and v},
                      key=str.casefold)

    def albums(self, artist):
        """Albums for an artist, with a representative file (for cover art) and year."""
        songs = self._songs(self._cmd("find " + quote(_filter(AlbumArtist=artist))))
        out = OrderedDict()
        for s in songs:
            name = s.get("Album", "")
            if name not in out:
                out[name] = {"album": name, "year": (s.get("Date") or "")[:4], "file": s["file"], "tracks": 0}
            out[name]["tracks"] += 1
        return sorted(out.values(), key=lambda a: (a["year"] or "9999", a["album"].casefold()))

    def tracks(self, artist, album):
        songs = self._songs(self._cmd("find " + quote(_filter(AlbumArtist=artist, Album=album))))

        def tnum(s):
            disc = int((s.get("Disc") or "1").split("/")[0] or 1)
            track = int((s.get("Track") or "0").split("/")[0] or 0)
            return disc, track

        songs.sort(key=tnum)
        return [{"file": s["file"], "title": s.get("Title") or s["file"].rsplit("/", 1)[-1],
                 "track": s.get("Track", ""), "duration": float(s.get("duration") or 0),
                 "codec": codec_of(s["file"]), "format": parse_format(s.get("Format", ""))} for s in songs]

    def albumart(self, uri):
        """Return cover bytes (embedded picture first, then cover.jpg/folder.jpg) or None."""
        for command in ("readpicture", "albumart"):
            data, offset = b"", 0
            try:
                while True:
                    pairs, chunk = self._run("%s %s %d" % (command, quote(uri), offset))
                    size = int(dict(pairs).get("size", 0))
                    if not chunk:
                        break
                    data += chunk
                    offset += len(chunk)
                    if offset >= size:
                        break
            except MPDError:
                data = b""
            if data:
                return data
        return None

    def stats(self):
        st = dict(self._cmd("stats"))
        updating = "updating_db" in dict(self._cmd("status"))
        return {"artists": int(st.get("artists", 0)), "albums": int(st.get("albums", 0)),
                "songs": int(st.get("songs", 0)), "updating": updating, "dbUpdate": st.get("db_update", "")}

    def all_albums(self):
        """Every album in the library (one listallinfo, cached until the MPD db changes)."""
        stamp = dict(self._cmd("stats")).get("db_update", "")
        cached = getattr(self, "_album_cache", None)
        if cached and cached[0] == stamp:
            return cached[1]
        out = OrderedDict()
        for s in self._songs(self._cmd("listallinfo")):
            artist = s.get("AlbumArtist") or s.get("Artist") or ""
            album = s.get("Album", "")
            if not album:
                continue
            key = (artist.casefold(), album.casefold())
            if key not in out:
                out[key] = {"album": album, "artist": artist, "year": (s.get("Date") or "")[:4],
                            "file": s["file"], "tracks": 0, "codec": codec_of(s["file"]),
                            "format": parse_format(s.get("Format", ""))}
            out[key]["tracks"] += 1
        albums = sorted(out.values(), key=lambda a: (a["artist"].casefold(), a["year"] or "9999",
                                                     a["album"].casefold()))
        self._album_cache = (stamp, albums)
        return albums

    def update(self):
        self._cmd("update")

    # ---- playback ----
    def status(self):
        st = dict(self._cmd("status"))
        song = self._songs(self._cmd("currentsong"))
        song = song[0] if song else None
        return {
            "state": st.get("state", "stop"),
            "volume": int(st.get("volume", -1)),
            "elapsed": float(st.get("elapsed", 0)),
            "duration": float(st.get("duration", 0)),
            # what the output is actually being fed right now, e.g. "96000:24:2"
            "audio": parse_format(st.get("audio", "")),
            "bitrate": int(st.get("bitrate", 0) or 0),
            "song": None if not song else {
                "file": song["file"], "title": song.get("Title", ""), "artist": song.get("Artist", ""),
                "album": song.get("Album", ""), "format": parse_format(song.get("Format", "")),
                "codec": codec_of(song["file"]),
            },
        }

    def play_album(self, artist, album, pos=0):
        self._run("clear", "findadd " + quote(_filter(AlbumArtist=artist, Album=album)), "play %d" % int(pos))

    def control(self, action):
        commands = {"play": "play", "pause": "pause 1", "toggle": "pause", "next": "next",
                    "previous": "previous", "stop": "stop"}
        if action not in commands:
            raise MPDError("unknown action %r" % action)
        if action == "toggle" and self.status()["state"] == "stop":
            self._cmd("play")
        else:
            self._cmd(commands[action])

    def set_volume(self, volume):
        self._cmd("setvol %d" % max(0, min(100, int(volume))))
