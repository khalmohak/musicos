"""Album and artist notes: what an album is, who played what, where it was recorded, and short
facts to show while it plays.

Facts come from real sources, never from a language model's memory:
    MusicBrainz   release date, label, studio, producer/engineer, per-track personnel,
                  the artist's discography (for "before / after")
    Wikipedia     the album's / artist's article (found through MusicBrainz -> Wikidata)
    Discogs       credits and notes (optional: needs a token)
    Last.fm       album wiki / artist bio (optional: needs an API key)
An LLM (OpenAI) only condenses that text into a summary and short facts, each citing the
source it came from; facts citing anything else are dropped. Results are cached on disk for
good, so playback never waits on the network and it works offline afterwards.

Keys live in <state>/secrets/ai.json ({"openai", "discogs", "lastfm"}), never in the image.
"""
import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.error
import urllib.request

from . import config

UA = "musicos/0.3 (self-hosted music player)"
MODEL_DEFAULT = "gpt-5.4-mini"
RETRY_AFTER = 7 * 86400  # albums with no sources are looked up again after a week
_last_call = {}
_rate_lock = threading.Lock()
PENDING = set()
_queue = []
_qlock = threading.Condition()


# ---- plumbing -----------------------------------------------------------------------------
def keys():
    try:
        return json.load(open(os.path.join(config.state_dir(), "secrets", "ai.json")))
    except (OSError, ValueError):
        return {}


def set_keys(k):
    d = os.path.join(config.state_dir(), "secrets")
    os.makedirs(d, mode=0o700, exist_ok=True)
    cur = keys()
    cur.update({n: str(v).strip() for n, v in k.items() if n in ("openai", "discogs", "lastfm") and v is not None})
    path = os.path.join(d, "ai.json")
    fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(cur, fh)
    os.replace(path + ".tmp", path)
    return {n: bool(cur.get(n)) for n in ("openai", "discogs", "lastfm")}


def enabled():
    return bool(config.load().get("albumInfo", True)) and bool(keys().get("openai"))


def _get(url, host_delay=0.0, headers=None, data=None, timeout=20):
    """GET (or POST data) JSON, waiting between calls to the same host (MusicBrainz: 1/s)."""
    host = urllib.parse.urlparse(url).netloc
    with _rate_lock:
        wait = _last_call.get(host, 0) + host_delay - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.time()
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    for attempt in range(4):
        req = urllib.request.Request(url, headers=h, data=data)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # MusicBrainz / Discogs answer 503 / 429 when busy: wait and try again
            if e.code not in (429, 503) or attempt == 3:
                raise
            time.sleep(2 + attempt * 3)


def _mb(path, **params):
    params["fmt"] = "json"
    return _get("https://musicbrainz.org/ws/2/%s?%s" % (path, urllib.parse.urlencode(params)), host_delay=1.1)


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").casefold()).strip()


def _key(*parts):
    return hashlib.sha1("|".join(_norm(p) for p in parts).encode()).hexdigest()[:20]


def _cache_path(kind, key):
    d = os.path.join(config.state_dir(), "info", kind)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, key + ".json")


def _strip(text):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"Read more on Last\.fm.*$", "", text, flags=re.S)
    text = re.sub(r"User-contributed text is available.*$", "", text, flags=re.S)
    return re.sub(r"\s+", " ", text).strip()


# ---- sources ------------------------------------------------------------------------------
def _q(s):
    return '"%s"' % (s or "").replace('"', " ")


def mb_release_group(artist, album):
    """Best-matching release group (an 'album' across all its editions)."""
    res = _mb("release-group", query="releasegroup:%s AND artist:%s" % (_q(album), _q(artist)), limit=8)
    best = None
    for rg in res.get("release-groups", []):
        score = int(rg.get("score", 0))
        credit = " ".join(c.get("name", "") + c.get("joinphrase", "") for c in rg.get("artist-credit", []))
        if score < 80 or _norm(artist) not in _norm(credit) and _norm(credit) not in _norm(artist):
            continue
        rank = (score, rg.get("primary-type") == "Album", not rg.get("secondary-types"))
        if best is None or rank > best[0]:
            best = (rank, rg)
    return best[1] if best else None


def mb_details(rg, track_count):
    """Release-group links, the edition closest to the library's, its per-track credits."""
    out = {"mbid": rg["id"], "date": rg.get("first-release-date", ""), "links": {}, "credits": {}, "album_credits": [],
           "label": "", "recorded": [], "artist_id": "", "tracks": []}
    full = _mb("release-group/%s" % rg["id"], inc="url-rels+artist-credits")
    for rel in full.get("relations", []):
        url = rel.get("url", {}).get("resource", "")
        if rel.get("type") in ("wikidata", "wikipedia", "discogs", "allmusic"):
            out["links"][rel["type"]] = url
    ac = full.get("artist-credit") or []
    if ac:
        out["artist_id"] = ac[0].get("artist", {}).get("id", "")
    rels = _mb("release", **{"release-group": rg["id"], "status": "official", "limit": 50, "inc": "media"}).get("releases", [])

    def rank(r):
        n = sum(m.get("track-count", 0) for m in r.get("media", []))
        return (abs(n - track_count) if track_count else 0, r.get("date") or "9999")
    if not rels:
        return out
    rel = sorted(rels, key=rank)[0]
    r = _mb("release/%s" % rel["id"], inc="recordings+artist-credits+labels+recording-level-rels+artist-rels+place-rels+release-rels")
    out["label"] = ", ".join(sorted({li.get("label", {}).get("name", "") for li in r.get("label-info", []) if li.get("label")}))
    for rel_ in r.get("relations", []):
        if rel_.get("target-type") == "artist" and rel_.get("type") not in _NOT_MUSIC:
            out["album_credits"].append({"name": rel_["artist"]["name"], "role": _role(rel_)})
    for medium in r.get("media", []):
        for t in medium.get("tracks", []):
            rec = t.get("recording", {})
            title = t.get("title") or rec.get("title", "")
            out["tracks"].append(title)
            people = []
            for rel_ in rec.get("relations", []):
                if rel_.get("target-type") == "artist" and rel_.get("type") not in _NOT_MUSIC:
                    people.append({"name": rel_["artist"]["name"], "role": _role(rel_)})
                elif rel_.get("target-type") == "place":
                    place = rel_.get("place", {}).get("name", "")
                    if place:
                        out["recorded"].append((place, rel_.get("begin") or ""))
            if people:
                out["credits"][title] = _merge_people(people)
    out["album_credits"] = _merge_people(out["album_credits"])
    out["recorded"] = _recorded(out["recorded"])[:4]
    return out


# relationship types that are legal or business, not music
_NOT_MUSIC = {"phonographic copyright", "copyright", "licensor", "marketed", "manufactured", "distributed",
              "publishing", "rights society", "misc", "legal representation", "booking", "art direction",
              "design/illustration", "graphic design", "design", "photography", "liner notes", "artists and repertoire"}


def _role(rel):
    attrs = [a for a in rel.get("attributes", []) if a not in ("additional", "guest", "solo", "lead", "background")]
    t = rel.get("type", "")
    attrs = [_PLAIN.get(a, a) for a in attrs]
    if t in ("instrument", "performer", "vocal") and attrs:
        role = ", ".join(attrs)
    elif t == "vocal":
        role = "vocals"
    else:
        role = t
    if "guest" in rel.get("attributes", []):
        role += " (guest)"
    if "solo" in rel.get("attributes", []):
        role += " solo"
    return role


_PLAIN = {"guitar family": "guitar", "drums (drum set)": "drums", "bass guitar": "bass", "electric guitar": "electric guitar",
          "keyboard": "keyboards", "lead vocals": "lead vocals", "background vocals": "backing vocals"}


def _recorded(entries):
    """["Criteria Studios (1970-08-28)", ...] -> ["Criteria Studios, Aug-Sep 1970"]"""
    by_place = {}
    for place, when in entries:
        by_place.setdefault(place, []).append(when)
    out = []
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    for place, dates in by_place.items():
        ds = sorted(d for d in dates if d)
        if not ds:
            out.append(place)
            continue
        def fmt(d):
            parts = d.split("-")
            return (months[int(parts[1]) - 1] + " " if len(parts) > 1 else "") + parts[0]
        a, b = fmt(ds[0]), fmt(ds[-1])
        if a == b:
            span = a
        elif a.split()[-1] == b.split()[-1] and len(a.split()) == 2 and len(b.split()) == 2:
            span = "%s-%s %s" % (a.split()[0], b.split()[0], a.split()[-1])
        else:
            span = "%s - %s" % (a, b)
        out.append("%s, %s" % (place, span))
    return out


def _merge_people(people):
    merged = {}
    for p in people:
        merged.setdefault(p["name"], [])
        if p["role"] and p["role"] not in merged[p["name"]]:
            merged[p["name"]].append(p["role"])
    return [{"name": n, "role": ", ".join(r)} for n, r in merged.items()]


def mb_discography(artist_id):
    """The artist's studio albums in order (for "before / after")."""
    if not artist_id:
        return []
    out = []
    res = _mb("release-group", artist=artist_id, type="album", limit=100)
    for rg in res.get("release-groups", []):
        if rg.get("secondary-types"):  # live, compilation, soundtrack...
            continue
        out.append({"album": rg.get("title", ""), "year": (rg.get("first-release-date") or "")[:4], "mbid": rg["id"]})
    return sorted([a for a in out if a["year"]], key=lambda a: a["year"])


def wikipedia_text(wikidata_url=None, search=None):
    """Plain text of the English Wikipedia article, via Wikidata (exact) or a search."""
    title = None
    if wikidata_url:
        qid = wikidata_url.rstrip("/").rsplit("/", 1)[-1]
        try:
            ent = _get("https://www.wikidata.org/wiki/Special:EntityData/%s.json" % qid, 0.2)
            title = ent["entities"][qid].get("sitelinks", {}).get("enwiki", {}).get("title")
        except Exception:
            title = None
    if not title and search:
        res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "query", "list": "search", "srsearch": search, "srlimit": 3, "format": "json"}), 0.2)
        hits = res.get("query", {}).get("search", [])
        if hits:
            title = hits[0]["title"]
    if not title:
        return None, None
    res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "prop": "extracts", "explaintext": 1, "titles": title, "format": "json", "redirects": 1}), 0.2)
    pages = res.get("query", {}).get("pages", {})
    text = next(iter(pages.values()), {}).get("extract", "") if pages else ""
    # credits and track lists come from MusicBrainz; keep the prose
    text = re.split(r"\n== (Track listing|Personnel|Charts|Certifications|References|External links) ==", text)[0]
    return title, text[:9000]


def discogs_album(artist, album):
    tok = keys().get("discogs")
    if not tok:
        return None
    res = _get("https://api.discogs.com/database/search?" + urllib.parse.urlencode(
        {"type": "master", "artist": artist, "release_title": album, "token": tok}), 1.1)
    hits = res.get("results", [])
    if not hits:
        return None
    master = _get("https://api.discogs.com/masters/%s?token=%s" % (hits[0]["id"], tok), 1.1)
    rel = _get("https://api.discogs.com/releases/%s?token=%s" % (master.get("main_release"), tok), 1.1)
    credits = [{"name": re.sub(r" \(\d+\)$", "", a.get("name", "")), "role": a.get("role", "")} for a in rel.get("extraartists", [])]
    return {"notes": _strip(rel.get("notes", ""))[:2500], "styles": master.get("styles", []), "credits": credits,
            "url": master.get("uri", "")}


def lastfm(method, **params):
    key = keys().get("lastfm")
    if not key:
        return None
    params.update(method=method, api_key=key, format="json")
    return _get("https://ws.audioscrobbler.com/2.0/?" + urllib.parse.urlencode(params), 0.25)


# ---- the writer ---------------------------------------------------------------------------
SYSTEM = """You write liner notes for a music player on a TV.
Use ONLY the numbered sources you are given. Never add anything from your own knowledge, even
if you are sure: no dates, names, places or claims that are not in the sources.
Every fact cites the id of the source it comes from. Prefer MusicBrainz for dates and credits,
Wikipedia for history and background. Write plainly and precisely, no hype, no adjectives
like "iconic" or "legendary". Short sentences. If the sources are thin, write less."""

ALBUM_TASK = """Album: {album} by {artist}{year}.
Tracks: {tracks}

Return JSON:
{{"summary": "2-4 sentences: what this album is and why it matters",
  "facts": [{{"text": "one fact, max 130 characters", "track": "exact track title or null", "source": "S1"}}],
  "recording": "one clean sentence on where and when it was recorded (and by whom, if notable), or null"}}
Facts are shown one at a time while the album plays, so make each one worth reading on its own:
how a song came about, who it was written about or for, what happened in the studio, a notable
performance (a guest, a famous solo), what happened after release. Do NOT list who played on
a track: the player shows credits separately. Never write a fact that only says who is credited
or who plays an instrument. At most 2 facts may be about people, and only if there is a story
(a guest who dropped in, a famous solo, a stand-in). Give 6-12 facts. Tie a fact to a track (exact title from
the list) only if it is about that track. Do not put source ids or brackets inside the text,
the summary or the recording sentence: cite only in "source".
"""

ARTIST_TASK = """Artist: {artist}.
Do not put source ids or brackets inside the text; cite only in "source".
Return JSON:
{{"bio": "3-5 sentences: who they are, when and where they started, what they are known for",
  "facts": [{{"text": "one fact, max 130 characters", "source": "S1"}}]}}
Give 4-8 facts."""


def _llm(task, sources):
    k = keys().get("openai")
    if not k:
        raise RuntimeError("no OpenAI key")
    src = "\n\n".join("[%s] %s\n%s" % (s["id"], s["name"], s["text"]) for s in sources)
    body = json.dumps({
        "model": config.load().get("albumInfoModel") or MODEL_DEFAULT,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "SOURCES\n\n" + src + "\n\nTASK\n" + task}],
        "response_format": {"type": "json_object"},
    }).encode()
    res = _get("https://api.openai.com/v1/chat/completions", headers={"Authorization": "Bearer " + k, "Content-Type": "application/json"},
               data=body, timeout=90)
    return json.loads(res["choices"][0]["message"]["content"])


def _plain(text):
    return re.sub(r"\s*\[S\d+(?:,\s*S\d+)*\]", "", str(text or "")).strip()


def _clean_facts(facts, source_ids, tracks=None):
    out, titles = [], {_norm(t): t for t in (tracks or [])}
    for f in facts or []:
        if not isinstance(f, dict) or f.get("source") not in source_ids or not f.get("text"):
            continue  # uncited or citing something that wasn't given: dropped
        track = titles.get(_norm(f.get("track") or "")) if tracks else None
        out.append({"text": _plain(f["text"])[:180], "track": track, "source": f["source"]})
    return out


# ---- album / artist -------------------------------------------------------------------------
def build_album(artist, album, year="", tracks=()):
    mb = None
    rg = mb_release_group(artist, album)
    if rg:
        mb = mb_details(rg, len(tracks))
    sources, links = [], []

    def add(name, text, url=""):
        if text and len(text) > 40:
            sid = "S%d" % (len(sources) + 1)
            sources.append({"id": sid, "name": name, "text": text})
            links.append({"id": sid, "name": name, "url": url})

    if mb:
        lines = ["First released: %s" % mb["date"]] if mb["date"] else []
        if mb["label"]:
            lines.append("Label: %s" % mb["label"])
        if mb["recorded"]:
            lines.append("Recorded at: %s" % "; ".join(mb["recorded"]))
        if mb["album_credits"]:
            lines.append("Album credits: %s" % "; ".join("%s (%s)" % (p["name"], p["role"]) for p in mb["album_credits"]))
        for t, people in mb["credits"].items():
            lines.append("Track \"%s\": %s" % (t, "; ".join("%s (%s)" % (p["name"], p["role"]) for p in people)))
        add("MusicBrainz", "\n".join(lines), "https://musicbrainz.org/release-group/" + mb["mbid"])
    title, wiki = wikipedia_text(mb["links"].get("wikidata") if mb else None, search="%s %s album" % (album, artist))
    if wiki:
        add("Wikipedia: " + title, wiki, "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")))
    try:
        dg = discogs_album(artist, album)
    except Exception:
        dg = None
    if dg:
        add("Discogs", (dg["notes"] + ("\nCredits: " + "; ".join("%s (%s)" % (c["name"], c["role"]) for c in dg["credits"][:40]) if dg["credits"] else "")).strip(),
            "https://www.discogs.com" + dg["url"] if dg["url"].startswith("/") else dg["url"])
    try:
        lf = lastfm("album.getinfo", artist=artist, album=album)
        wiki_lf = _strip(((lf or {}).get("album") or {}).get("wiki", {}).get("content", ""))
    except Exception:
        wiki_lf = ""
    add("Last.fm", wiki_lf[:3000], "https://www.last.fm/music/%s/%s" % (urllib.parse.quote(artist), urllib.parse.quote(album)))

    out = {"status": "none", "artist": artist, "album": album, "at": time.time(), "sources": links}
    if mb:
        out.update(date=mb["date"], label=mb["label"], recorded=mb["recorded"], credits=mb["credits"],
                   albumCredits=mb["album_credits"], mbid=mb["mbid"], artistId=mb["artist_id"])
        try:
            out["discography"] = mb_discography(mb["artist_id"])
        except Exception:
            out["discography"] = []
    if not sources:
        return out
    track_list = list(tracks) or (mb["tracks"] if mb else [])
    res = _llm(ALBUM_TASK.format(album=album, artist=artist, year=(" (%s)" % year) if year else "",
                                 tracks="; ".join(track_list) or "unknown"), sources)
    ids = {s["id"] for s in sources}
    out.update(status="ready", summary=_plain(res.get("summary")), recording=_plain(res.get("recording")) or None,
               facts=_clean_facts(res.get("facts"), ids, track_list),
               model=config.load().get("albumInfoModel") or MODEL_DEFAULT)
    return out


def build_artist(name):
    sources, links = [], []

    def add(n, text, url=""):
        if text and len(text) > 40:
            sid = "S%d" % (len(sources) + 1)
            sources.append({"id": sid, "name": n, "text": text})
            links.append({"id": sid, "name": n, "url": url})

    members, wd = [], None
    try:
        res = _mb("artist", query="artist:%s" % _q(name), limit=3)
        hit = next((a for a in res.get("artists", []) if int(a.get("score", 0)) >= 90), None)
        if hit:
            full = _mb("artist/%s" % hit["id"], inc="url-rels+artist-rels")
            for rel in full.get("relations", []):
                if rel.get("type") == "wikidata":
                    wd = rel["url"]["resource"]
                if rel.get("type") == "member of band" and rel.get("direction") == "backward":
                    start, end = (rel.get("begin") or "")[:4], (rel.get("end") or "")[:4]
                    span = ("%s-%s" % (start, end) if end else "%s-present" % start if not rel.get("ended") else start) if start else ""
                    members.append({"name": rel["artist"]["name"], "years": span,
                                    "role": ", ".join(rel.get("attributes", []))})
            if members:
                add("MusicBrainz", "Members: " + "; ".join("%s (%s%s)" % (m["name"], m["role"] + " " if m["role"] else "", m["years"]) for m in members),
                    "https://musicbrainz.org/artist/" + hit["id"])
    except Exception:
        pass
    title, wiki = wikipedia_text(wd, search="%s band musician" % name)
    if wiki:
        add("Wikipedia: " + title, wiki, "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")))
    try:
        lf = lastfm("artist.getinfo", artist=name)
        add("Last.fm", _strip(((lf or {}).get("artist") or {}).get("bio", {}).get("content", ""))[:3000],
            "https://www.last.fm/music/" + urllib.parse.quote(name))
    except Exception:
        pass
    out = {"status": "none", "artist": name, "members": members, "at": time.time(), "sources": links}
    if not sources:
        return out
    res = _llm(ARTIST_TASK.format(artist=name), sources)
    out.update(status="ready", bio=_plain(res.get("bio")),
               facts=_clean_facts(res.get("facts"), {s["id"] for s in sources}))
    return out


# ---- cache + background worker ----------------------------------------------------------------
def _load(kind, key):
    try:
        d = json.load(open(_cache_path(kind, key)))
        if d.get("status") == "none" and time.time() - d.get("at", 0) > RETRY_AFTER:
            return None
        return d
    except (OSError, ValueError):
        return None


def album(artist, album_name, year="", tracks=(), client=None):
    """Cached notes, or {"status": "pending"} after queueing them (front of the queue)."""
    if not enabled():
        return {"status": "off"}
    key = _key(artist, album_name)
    d = _load("albums", key)
    if d:
        return d
    _enqueue(("albums", key, artist, album_name, year, tuple(tracks)), front=True)
    return {"status": "pending"}


def artist(name):
    if not enabled():
        return {"status": "off"}
    key = _key(name)
    d = _load("artists", key)
    if d:
        return d
    _enqueue(("artists", key, name), front=True)
    return {"status": "pending"}


def _enqueue(job, front=False):
    with _qlock:
        if job[1] in PENDING:
            if front and job in _queue:  # asked for again: move it to the front
                _queue.remove(job)
                _queue.insert(0, job)
            return
        PENDING.add(job[1])
        _queue.insert(0, job) if front else _queue.append(job)
        _qlock.notify()


def _worker():
    while True:
        with _qlock:
            while not _queue:
                _qlock.wait()
            job = _queue.pop(0)
        kind, key = job[0], job[1]
        try:
            d = build_album(*job[2:]) if kind == "albums" else build_artist(job[2])
            with open(_cache_path(kind, key) + ".tmp", "w") as fh:
                json.dump(d, fh)
            os.replace(_cache_path(kind, key) + ".tmp", _cache_path(kind, key))
            print("album info: %s %s -> %s (%d facts)" % (kind, job[2:4], d.get("status"), len(d.get("facts", []))), flush=True)
        except Exception as e:
            print("album info: %s %s failed: %s" % (kind, job[2:4], e), flush=True)
        finally:
            with _qlock:
                PENDING.discard(key)
        time.sleep(1)


def backfill(client):
    """Slowly prepare notes for the whole library (the playing album always jumps ahead)."""
    time.sleep(120)
    while True:
        if enabled():
            try:
                for a in client.all_albums():
                    if not _load("albums", _key(a["artist"], a["album"])):
                        tracks = [t.get("title", "") for t in client.tracks(a["artist"], a["album"])]
                        _enqueue(("albums", _key(a["artist"], a["album"]), a["artist"], a["album"], a.get("year", ""), tuple(tracks)))
                        with _qlock:
                            while len(_queue) > 3:
                                _qlock.wait(5)
            except Exception as e:
                print("album info backfill: %s" % e, flush=True)
        time.sleep(3600)


def start(client):
    threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=backfill, args=(client,), daemon=True).start()
