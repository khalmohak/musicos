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
MODEL_DEFAULT = "gpt-5.4"  # follows "leave it empty" reliably; the mini model padded
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
            retry = e.headers.get("Retry-After") if e.headers else None
            time.sleep(float(retry) if retry and retry.isdigit() else 3 + attempt * 6)


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
           "label": "", "recorded": [], "artist_id": "", "tracks": [], "works": {}}
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
    r = _mb("release/%s" % rel["id"], inc="recordings+artist-credits+labels+recording-level-rels+artist-rels+place-rels+release-rels+work-rels")
    out["label"] = ", ".join(sorted({li.get("label", {}).get("name", "") for li in r.get("label-info", []) if li.get("label")}))
    for rel_ in r.get("relations", []):
        if rel_.get("target-type") == "artist" and rel_.get("type") not in _NOT_MUSIC:
            out["album_credits"].append({"name": rel_["artist"]["name"], "role": _role(rel_), "id": rel_["artist"].get("id", "")})
    for medium in r.get("media", []):
        for t in medium.get("tracks", []):
            rec = t.get("recording", {})
            title = t.get("title") or rec.get("title", "")
            out["tracks"].append(title)
            people = []
            for rel_ in rec.get("relations", []):
                if rel_.get("target-type") == "artist" and rel_.get("type") not in _NOT_MUSIC:
                    people.append({"name": rel_["artist"]["name"], "role": _role(rel_), "id": rel_["artist"].get("id", "")})
                elif rel_.get("target-type") == "work" and rel_.get("type") == "performance":
                    out["works"].setdefault(title, rel_.get("work", {}).get("id", ""))
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
    merged, ids = {}, {}
    for p in people:
        merged.setdefault(p["name"], [])
        ids.setdefault(p["name"], p.get("id", ""))
        if p["role"] and p["role"] not in merged[p["name"]]:
            merged[p["name"]].append(p["role"])
    return [{"name": n, "role": ", ".join(r), "id": ids[n]} for n, r in merged.items()]


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
            ent = _get("https://www.wikidata.org/wiki/Special:EntityData/%s.json" % qid, 1.0)
            title = ent["entities"][qid].get("sitelinks", {}).get("enwiki", {}).get("title")
        except Exception:
            title = None
    if not title and search:
        res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "query", "list": "search", "srsearch": search, "srlimit": 3, "format": "json"}), 1.0)
        hits = res.get("query", {}).get("search", [])
        if hits:
            title = hits[0]["title"]
    if not title:
        return None, None
    res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "prop": "extracts", "explaintext": 1, "titles": title, "format": "json", "redirects": 1}), 1.0)
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


# ---- articles -----------------------------------------------------------------------------
def wiki_article(title):
    """Full plain text of an English Wikipedia article (redirects followed)."""
    res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "prop": "extracts", "explaintext": 1, "titles": title, "format": "json", "redirects": 1}), 1.0)
    page = next(iter(res.get("query", {}).get("pages", {}).values()), {})
    if "missing" in page:
        return None, ""
    return page.get("title", title), page.get("extract", "")


def wiki_title_from_wikidata(url):
    if not url:
        return None
    qid = url.rstrip("/").rsplit("/", 1)[-1]
    try:
        ent = _get("https://www.wikidata.org/wiki/Special:EntityData/%s.json" % qid, 1.0)
        return ent["entities"][qid].get("sitelinks", {}).get("enwiki", {}).get("title")
    except Exception:
        return None


def wiki_search_title(query, must=()):
    res = _get("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {"action": "query", "list": "search", "srsearch": query, "srlimit": 3, "format": "json"}), 1.0)
    for h in res.get("query", {}).get("search", []):
        if all(_norm(m) in _norm(h["title"]) for m in must):
            return h["title"]
    return None


def mb_wiki(kind, mbid):
    """Wikipedia title for a MusicBrainz artist / work / release group, via its Wikidata link."""
    if not mbid:
        return None
    try:
        d = _mb("%s/%s" % (kind, mbid), inc="url-rels")
    except Exception:
        return None
    for rel in d.get("relations", []):
        if rel.get("type") == "wikidata":
            return wiki_title_from_wikidata(rel["url"]["resource"])
    return None


def around_year(text, year, span=1):
    """Paragraphs of a long biography that mention the recording year or one either side."""
    if not year or not year.isdigit():
        return ""
    years = {str(int(year) + d) for d in range(-span, span + 1)}
    paras = [p for p in text.split("\n") if len(p) > 120 and any(y in p for y in years)]
    return "\n".join(paras)[:9000]


def lyrics_text(artist, title, album=""):
    try:
        d = _get("https://lrclib.net/api/get?" + urllib.parse.urlencode({"artist_name": artist, "track_name": title, "album_name": album}), 0.5)
        return (d.get("plainLyrics") or "")[:3500]
    except Exception:
        try:
            d = _get("https://lrclib.net/api/get?" + urllib.parse.urlencode({"artist_name": artist, "track_name": title}), 0.5)
            return (d.get("plainLyrics") or "")[:3500]
        except Exception:
            return ""


MUSICIAN = re.compile(r"guitar|bass|drum|vocal|keyboard|piano|organ|harmonica|percussion|slide|sax|trumpet|violin|mandolin|sitar|tabla")


# ---- album context (no AI: shared by every track of the album) --------------------------------
def build_context(artist, album, year="", tracks=()):
    ctx = {"artist": artist, "album": album, "year": (year or "")[:4], "mb": None, "albumWiki": "", "albumWikiTitle": "",
           "bandWiki": "", "bandWikiTitle": "", "people": {}, "at": time.time()}
    rg = mb_release_group(artist, album)
    if rg:
        ctx["mb"] = mb_details(rg, len(tracks))
        ctx["year"] = (ctx["mb"]["date"] or ctx["year"])[:4]
    mb = ctx["mb"] or {}
    t = wiki_title_from_wikidata(mb.get("links", {}).get("wikidata")) or wiki_search_title("%s %s album" % (album, artist), must=[album])
    if t:
        ctx["albumWikiTitle"], text = wiki_article(t)
        ctx["albumWiki"] = re.split(r"\n== (References|External links|Notes|Charts|Certifications) ==", text or "")[0][:30000]
    t = mb_wiki("artist", mb.get("artist_id")) or wiki_search_title("%s band musician" % artist, must=[artist.split()[-1]])
    if t:
        ctx["bandWikiTitle"], text = wiki_article(t)
        ctx["bandWiki"] = re.split(r"\n== (References|External links|Notes|Discography) ==", text or "")[0][:40000]
    # the musicians: their biography around the time this was recorded
    people = {}
    for p in [x for ps in mb.get("credits", {}).values() for x in ps] + mb.get("album_credits", []):
        if MUSICIAN.search(p["role"]) and p["name"] != artist:
            people.setdefault(p["name"], p.get("id", ""))
    for name, pid in list(people.items())[:6]:
        try:
            t = mb_wiki("artist", pid) or wiki_search_title("%s musician" % name, must=[name.split()[-1]])
            if t:
                real, text = wiki_article(t)
                ctx["people"][name] = {"title": real, "text": around_year(text, ctx["year"])}
        except Exception as e:
            print("album info: %s: %s" % (name, e), flush=True)
    return ctx


# ---- the writer -------------------------------------------------------------------------------
SYSTEM = """You write for a music player on a TV, for a listener deep into 60s/70s rock, blues and
psychedelia. Warm, specific, never generic. Use ONLY the sources given: every statement must be
backed by them, nothing from your own memory. If a section has no backing, leave it empty.
No chart positions, sales figures, awards or praise words ("iconic", "legendary", "masterpiece").
Do not put source ids or brackets in the text."""

TRACK_TASK = """Now playing: "{title}" by {artist}, from "{album}" ({year}).
Return JSON:
{{"song": "2-3 sentences: what the song is about (from its lyrics and sources) and how it came to be",
  "listen_for": ["1-4 things to listen for in THIS track, each naming a part, a player, an instrument or a technique (e.g. who plays the slide, a drum pattern, an overdub, a tuning). No vague items like 'the vocal' or 'the groove'."],
  "players": [{{"name": "...", "plays": "what they play on this track"}}],
  "moment": "1-2 sentences: what was happening in these musicians' lives around when this was recorded",
  "sources": ["S1"]}}
If the lyrics are the only source about the song itself, say plainly what the words are about,
without interpreting beyond them. "song" is about this song only: no release dates, chart
history or album background there.
"listen_for" only lists details the sources actually describe for THIS track (a specific part,
technique, overdub, instrument or moment). Never pad with generic lines like "X's bass supports
the song" or "Y's drums drive the track": if the sources describe nothing specific, return an
empty list. Fewer, real items beat more, vague ones."""

ALBUM_TASK = """Album: "{album}" by {artist} ({year}).
Return JSON:
{{"summary": "2-3 sentences: what this album is and the story around it",
  "stories": [{{"text": "max 170 characters", "about": "a track title, a musician or the band"}}],
  "sources": ["S1"]}}
Stories are what a hardcore fan would lean in for: wild or strange episodes, band drama,
breakdowns, excess, myths, gear (who owned which guitar), how a song or riff came about,
legendary gigs, accidents, who was in which band before, playing technique. Give the 8 best,
best first. Skip tours or dates listed without a story."""

ARTIST_TASK = """Artist: {artist}.
Return JSON {{"bio": "3-5 sentences: who they are, where they came from, what they are known for",
  "stories": [{{"text": "max 170 characters", "about": "a musician or the band"}}]}}
Give 6 stories, the kind a hardcore fan would lean in for."""


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
               data=body, timeout=180)
    return json.loads(res["choices"][0]["message"]["content"])


def _plain(text):
    return re.sub(r"\s*\[S\d+(?:,\s*S\d+)*\]", "", str(text or "")).strip()


class _Sources:
    def __init__(self):
        self.items = []

    def add(self, name, text, url=""):
        if text and len(text.strip()) > 60:
            self.items.append({"id": "S%d" % (len(self.items) + 1), "name": name, "text": text.strip(), "url": url})

    def links(self):
        return [{"id": s["id"], "name": s["name"], "url": s["url"]} for s in self.items]


def _wurl(title):
    return "https://en.wikipedia.org/wiki/" + urllib.parse.quote((title or "").replace(" ", "_"))


def build_track(ctx, title):
    mb = ctx.get("mb") or {}
    src = _Sources()
    src.add("Lyrics", lyrics_text(ctx["artist"], title, ctx["album"]))
    # the song's own article: MusicBrainz work -> Wikidata -> Wikipedia (exact), else a careful search
    work = next((w for t, w in mb.get("works", {}).items() if _norm(t) == _norm(title)), "")
    song_title = mb_wiki("work", work)
    if not song_title:
        cand = wiki_search_title('"%s" %s song' % (title, ctx["artist"]), must=[title])
        song_title = cand if cand and cand != ctx.get("albumWikiTitle") else None
    if song_title:
        real, text = wiki_article(song_title)
        src.add("Wikipedia: " + (real or song_title), re.split(r"\n== (References|External links|Charts|Certifications) ==", text or "")[0][:15000], _wurl(real or song_title))
    if ctx.get("albumWiki"):
        src.add("Wikipedia: " + ctx["albumWikiTitle"], ctx["albumWiki"][:15000], _wurl(ctx["albumWikiTitle"]))
    credits = next((v for t, v in mb.get("credits", {}).items() if _norm(t) == _norm(title)), [])
    if credits:
        src.add("MusicBrainz credits", "; ".join("%s (%s)" % (p["name"], p["role"]) for p in credits),
                "https://musicbrainz.org/release-group/" + mb.get("mbid", ""))
    names = [p["name"] for p in credits] or list(ctx.get("people", {}))
    for n in names:
        p = ctx.get("people", {}).get(n)
        if p and p.get("text"):
            src.add("Wikipedia: %s (around %s)" % (p["title"], ctx["year"]), p["text"], _wurl(p["title"]))
    if ctx.get("bandWiki"):
        src.add("Wikipedia: %s (around %s)" % (ctx["bandWikiTitle"], ctx["year"]), around_year(ctx["bandWiki"], ctx["year"]), _wurl(ctx["bandWikiTitle"]))
    out = {"status": "none", "title": title, "artist": ctx["artist"], "album": ctx["album"], "at": time.time(), "sources": src.links()}
    if len(src.items) < 1:
        return out
    res = _llm(TRACK_TASK.format(title=title, artist=ctx["artist"], album=ctx["album"], year=ctx["year"] or "?"), src.items)
    listen = [_plain(x) for x in (res.get("listen_for") or []) if isinstance(x, str) and _plain(x)]
    players = [{"name": _plain(p.get("name")), "plays": _plain(p.get("plays"))} for p in (res.get("players") or []) if isinstance(p, dict) and p.get("name")]
    used = set(res.get("sources") or [])
    out.update(status="ready", song=_plain(res.get("song")), listenFor=listen[:4], players=players,
               moment=_plain(res.get("moment")), sources=[s for s in src.links() if not used or s["id"] in used] or src.links())
    return out


def connections(ctx, library_artists):
    """Other bands of the musicians on this album (MusicBrainz), marking the ones in the library."""
    mb = ctx.get("mb") or {}
    people = {}
    for p in [x for ps in mb.get("credits", {}).values() for x in ps] + mb.get("album_credits", []):
        if MUSICIAN.search(p["role"]) and p.get("id"):
            people.setdefault(p["name"], {"id": p["id"], "role": p["role"]})
    lib = {_norm(a): a for a in library_artists}
    out = []
    for name, p in list(people.items())[:10]:
        try:
            d = _mb("artist/%s" % p["id"], inc="artist-rels")
        except Exception:
            continue
        bands = []
        for rel in d.get("relations", []):
            if rel.get("type") == "member of band" and rel.get("direction") == "forward":
                b = rel["artist"]["name"]
                if _norm(b) == _norm(ctx["artist"]) or any(_norm(x["name"]) == _norm(b) for x in bands):
                    continue
                start, end = (rel.get("begin") or "")[:4], (rel.get("end") or "")[:4]
                bands.append({"name": b, "years": ("%s-%s" % (start, end)).strip("-") if start or end else "",
                              "have": _norm(b) in lib, "libraryName": lib.get(_norm(b), "")})
        if bands:
            bands.sort(key=lambda b: (not b["have"], b["years"] or "9999"))
            out.append({"name": name, "role": p["role"], "bands": bands[:6]})
    out.sort(key=lambda c: not any(b["have"] for b in c["bands"]))
    return out


def build_album(ctx, library_artists=()):
    mb = ctx.get("mb") or {}
    src = _Sources()
    if ctx.get("albumWiki"):
        src.add("Wikipedia: " + ctx["albumWikiTitle"], ctx["albumWiki"], _wurl(ctx["albumWikiTitle"]))
    if ctx.get("bandWiki"):
        src.add("Wikipedia: " + ctx["bandWikiTitle"], ctx["bandWiki"], _wurl(ctx["bandWikiTitle"]))
    out = {"status": "none", "artist": ctx["artist"], "album": ctx["album"], "at": time.time()}
    if mb:
        out.update(date=mb.get("date", ""), label=mb.get("label", ""), recorded=mb.get("recorded", []),
                   credits={t: [{"name": p["name"], "role": p["role"]} for p in ps] for t, ps in mb.get("credits", {}).items()},
                   albumCredits=[{"name": p["name"], "role": p["role"]} for p in mb.get("album_credits", [])], mbid=mb.get("mbid"))
        try:
            out["discography"] = mb_discography(mb.get("artist_id"))
        except Exception:
            out["discography"] = []
        try:
            out["connections"] = connections(ctx, library_artists)
        except Exception as e:
            print("album info: connections: %s" % e, flush=True)
    out["sources"] = src.links()
    if not src.items:
        return out
    res = _llm(ALBUM_TASK.format(album=ctx["album"], artist=ctx["artist"], year=ctx.get("year") or "?"), src.items)
    stories = [{"text": _plain(x.get("text"))[:220], "about": _plain(x.get("about"))} for x in (res.get("stories") or []) if isinstance(x, dict) and x.get("text")]
    out.update(status="ready", summary=_plain(res.get("summary")), stories=stories[:10])
    return out


def build_artist(name):
    src = _Sources()
    members = []
    t = None
    try:
        res = _mb("artist", query="artist:%s" % _q(name), limit=3)
        hit = next((a for a in res.get("artists", []) if int(a.get("score", 0)) >= 90), None)
        if hit:
            full = _mb("artist/%s" % hit["id"], inc="url-rels+artist-rels")
            for rel in full.get("relations", []):
                if rel.get("type") == "wikidata":
                    t = wiki_title_from_wikidata(rel["url"]["resource"])
                if rel.get("type") == "member of band" and rel.get("direction") == "backward":
                    start, end = (rel.get("begin") or "")[:4], (rel.get("end") or "")[:4]
                    span = ("%s-%s" % (start, end) if end else "%s-present" % start if not rel.get("ended") else start) if start else ""
                    members.append({"name": rel["artist"]["name"], "years": span, "role": ", ".join(rel.get("attributes", []))})
    except Exception:
        pass
    t = t or wiki_search_title("%s band musician" % name, must=[name.split()[-1]])
    if t:
        real, text = wiki_article(t)
        src.add("Wikipedia: " + (real or t), re.split(r"\n== (References|External links|Discography) ==", text or "")[0][:40000], _wurl(real or t))
    out = {"status": "none", "artist": name, "members": members, "at": time.time(), "sources": src.links()}
    if not src.items:
        return out
    res = _llm(ARTIST_TASK.format(artist=name), src.items)
    out.update(status="ready", bio=_plain(res.get("bio")),
               stories=[{"text": _plain(x.get("text"))[:220], "about": _plain(x.get("about"))} for x in (res.get("stories") or []) if isinstance(x, dict) and x.get("text")][:8])
    return out


# ---- cache + on-demand queue ------------------------------------------------------------------
# Nothing is prepared ahead: when a track is asked for (it is playing, or its card is opened),
# that track goes first, then the rest of its album in order, then the album's story. Results
# are cached on disk for good.
LIBRARY_ARTISTS = []  # set by the server: names to mark "in your library"
_ctx_lock = threading.Lock()


def _load(kind, key):
    try:
        d = json.load(open(_cache_path(kind, key)))
        if d.get("status") == "none" and time.time() - d.get("at", 0) > RETRY_AFTER:
            return None
        return d
    except (OSError, ValueError):
        return None


def _save(kind, key, d):
    with open(_cache_path(kind, key) + ".tmp", "w") as fh:
        json.dump(d, fh)
    os.replace(_cache_path(kind, key) + ".tmp", _cache_path(kind, key))


def _context(artist, album_name, year, tracks):
    key = _key(artist, album_name)
    with _ctx_lock:
        d = _load("context", key)
        if not d:
            d = build_context(artist, album_name, year, tracks)
            _save("context", key, d)
    return d


def track(artist, album_name, title, year="", tracks=()):
    """Song card for a track, or {"status": "pending"} after queueing it (and its album)."""
    if not enabled():
        return {"status": "off"}
    key = _key(artist, album_name, title)
    d = _load("tracks", key)
    if d:
        return d
    _enqueue(("tracks", key, artist, album_name, title, year, tuple(tracks)), front=True)
    # then the rest of the album, in order, and its story: nothing beyond what is being played
    rest = list(tracks)
    if title in rest:
        i = rest.index(title)
        rest = rest[i + 1:] + rest[:i]
    for t in rest:
        k = _key(artist, album_name, t)
        if not _load("tracks", k):
            _enqueue(("tracks", k, artist, album_name, t, year, tuple(tracks)))
    if not _load("albums", _key(artist, album_name)):
        _enqueue(("albums", _key(artist, album_name), artist, album_name, year, tuple(tracks)))
    return {"status": "pending"}


def album(artist, album_name, year="", tracks=(), client=None):
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
            if front:
                for j in _queue:
                    if j[1] == job[1]:
                        _queue.remove(j)
                        _queue.insert(0, j)
                        break
            return
        PENDING.add(job[1])
        if front:
            _queue.insert(0, job)
        else:
            _queue.append(job)
        _qlock.notify()


def _run(job):
    kind = job[0]
    if kind == "tracks":
        _, key, artist_, album_, title, year, tracks = job
        return build_track(_context(artist_, album_, year, tracks), title)
    if kind == "albums":
        _, key, artist_, album_, year, tracks = job
        return build_album(_context(artist_, album_, year, tracks), LIBRARY_ARTISTS)
    return build_artist(job[2])


def _worker():
    while True:
        with _qlock:
            while not _queue:
                _qlock.wait()
            job = _queue.pop(0)
        kind, key = job[0], job[1]
        try:
            t = time.time()
            d = _run(job)
            _save(kind, key, d)
            print("album info: %s %s -> %s in %.0fs" % (kind, job[2:5], d.get("status"), time.time() - t), flush=True)
        except Exception as e:
            print("album info: %s %s failed: %s" % (kind, job[2:5], e), flush=True)
        finally:
            with _qlock:
                PENDING.discard(key)
        time.sleep(0.5)


def start(client):
    threading.Thread(target=_worker, daemon=True).start()
