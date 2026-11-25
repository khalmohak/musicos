"""In-memory stand-in for MPDClient so the UI can be built on any machine."""
import time

LIBRARY = {
    "Gary Moore": {"Still Got the Blues (1990)": ["Moving On", "Oh Pretty Woman", "Walking by Myself",
                                                  "Still Got the Blues", "Texas Strut"],
                   "Wild Frontier (1987)": ["Over the Hills and Far Away", "Wild Frontier", "Take a Little Time"]},
    "Free": {"Fire and Water (1970)": ["Fire and Water", "Oh I Wept", "Remember", "Heavy Load", "All Right Now"]},
    "Nusrat Fateh Ali Khan": {"Mustt Mustt (1990)": ["Mustt Mustt", "Nothing Without You", "Tracery"]},
    "Seedhe Maut": {"Nayaab (2022)": ["Naksha", "Kaanch Ke Ghar", "Maina"]},
    "Johnny Winter": {"Second Winter (1969)": ["Memory Pain", "I'm Not Sure", "Johnny B. Goode", "Highway 61 Revisited"]},
}


def _split(name):
    title, _, year = name.rpartition(" (")
    return title, year.rstrip(")")


class MockClient:
    def __init__(self):
        self.queue, self.pos, self.state, self.volume = [], 0, "stop", 60
        self.started, self.offset = 0.0, 0.0

    def artists(self):
        return sorted(LIBRARY, key=str.casefold)

    def albums(self, artist):
        out = []
        for name, tracks in LIBRARY.get(artist, {}).items():
            title, year = _split(name)
            out.append({"album": title, "year": year, "file": "%s/%s/01" % (artist, title), "tracks": len(tracks)})
        return out

    def tracks(self, artist, album):
        for name, tracks in LIBRARY.get(artist, {}).items():
            if _split(name)[0] == album:
                return [{"file": "%s/%s/%02d" % (artist, album, i + 1), "title": t, "track": str(i + 1),
                         "duration": 240.0, "_artist": artist, "_album": album} for i, t in enumerate(tracks)]
        return []

    def all_albums(self):
        out = []
        for artist in self.artists():
            for a in self.albums(artist):
                out.append(dict(a, artist=artist))
        return out

    def stats(self):
        al = self.all_albums()
        return {"artists": len(LIBRARY), "albums": len(al), "songs": sum(a["tracks"] for a in al),
                "updating": False}

    def albumart(self, uri):
        return None

    def update(self):
        pass

    def _elapsed(self):
        e = self.offset + (time.time() - self.started if self.state == "play" else 0)
        if e >= 240 and self.queue:  # auto-advance
            self.pos = (self.pos + 1) % len(self.queue)
            self.started, self.offset = time.time(), 0.0
            e = 0.0
        return e

    def status(self):
        song = self.queue[self.pos] if self.queue and self.state != "stop" else None
        return {"state": self.state, "volume": self.volume, "elapsed": self._elapsed() if song else 0,
                "duration": 240.0 if song else 0,
                "song": None if not song else {"file": song["file"], "title": song["title"],
                                               "artist": song["_artist"], "album": song["_album"]}}

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
