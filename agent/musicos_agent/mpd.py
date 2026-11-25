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
                 "track": s.get("Track", ""), "duration": float(s.get("duration") or 0)} for s in songs]

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
            "song": None if not song else {
                "file": song["file"], "title": song.get("Title", ""), "artist": song.get("Artist", ""),
                "album": song.get("Album", ""),
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
