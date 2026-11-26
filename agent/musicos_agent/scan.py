"""Library scan progress: what MPD is reading, how far along, how long is left.

MPD itself only says "updating_db". What it does log (journal of mpd.service, readable by
the music user) is every file: "update: added <path>", "update: updating <path>",
"update: removing <path>", plus errors for files it can't read. MPD's song count also grows
live while it scans. Together with a count of the audio files on disk, that gives:
    phase      counting (looking for files) | reading (tags) | idle
    done/total max(tracks in the library, files re-read) vs audio files found on all sources
    current    the album folder being read, and which source it's on
    rate/eta   tracks per second over the last ~20 s, time left
    errors     files MPD could not read
    last       summary of the previous scan
"""
import collections
import json
import os
import re
import subprocess
import threading
import time

AUDIO = {".flac", ".mp3", ".m4a", ".mp4", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff",
         ".dsf", ".dff", ".wv", ".ape", ".mpc", ".wma", ".alac"}
LINE = re.compile(r"^update: (added|updating|removing) (.+)$")
ERROR = re.compile(r"(?i)(fail|error|exception|unsupported|cannot|could not)")

STATE = {"active": False, "phase": "idle", "found": 0, "counted": False, "songs": 0, "total": 0,
         "added": 0, "updated": 0, "removed": 0, "current": "", "source": "", "rate": 0.0, "eta": None,
         "started": 0.0, "pct": None, "done": 0, "firstAt": 0.0, "lastErrors": [], "errors": [], "last": None}
_lock = threading.Lock()
_window = collections.deque(maxlen=40)  # (time, files processed so far)


def _folder(path):
    from . import library
    fid = path.split("/", 1)[0]
    return next((f for f in library.folders() or [] if f["id"] == fid), None)


def _source_name(path):
    """<folder id>/... -> the library folder's source ("USB drive Music", "This device")."""
    f = _folder(path)
    if f:
        kind = {"usb": "USB drive", "disk": "Drive", "network": "Network share"}.get(f.get("sourceKind"), "")
        return ("%s %s" % (kind, f.get("sourceName", ""))).strip() if kind else f.get("sourceName", "")
    top = path.split("/", 1)[0]
    if top == "local":
        return "This device"
    if top.startswith("usb-"):
        return "USB drive " + top[4:]
    if top.startswith("disk-"):
        return "Internal drive " + top[5:]
    return "Music folder"


def _album_of(path):
    """<folder id or source>/.../Artist/Album/01 song.flac -> "Artist / Album"."""
    parts = path.split("/")[:-1]
    if parts and (_folder(path) or parts[0] == "local" or re.match(r"(usb|disk|net)-", parts[0])):
        parts = parts[1:]
    return " / ".join(parts[-2:]) if parts else path


def _count_files(root):
    """Audio files under the music root (MPD skips hidden files and folders too)."""
    n = 0
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    try:
                        if e.is_dir(follow_symlinks=True):
                            stack.append(e.path)
                        elif os.path.splitext(e.name)[1].lower() in AUDIO:
                            n += 1
                            if n % 500 == 0:
                                STATE["found"] = n
                    except OSError:
                        pass
        except OSError:
            pass
    return n


def _last_path():
    from . import config
    return os.path.join(config.state_dir(), "last-scan.json")


def _load_last():
    try:
        STATE["last"] = json.load(open(_last_path()))
        STATE["lastErrors"] = STATE["last"].pop("errorLines", [])
    except (OSError, ValueError):
        pass


def _save_last():
    try:
        with open(_last_path(), "w") as fh:
            json.dump(dict(STATE["last"], errorLines=STATE["lastErrors"]), fh)
    except OSError:
        pass


def status():
    with _lock:
        s = dict(STATE)
        # while idle, the errors shown are the last scan's
        s["errors"] = list(STATE["errors"][-20:] if STATE["active"] else STATE["lastErrors"])
        s.pop("lastErrors", None)
    return s


def _processed():
    return STATE["added"] + STATE["updated"] + STATE["removed"]


def _follow_journal():
    """Every file MPD reads, from its log. Restarts if journalctl ends."""
    while True:
        try:
            p = subprocess.Popen(["journalctl", "-u", "mpd", "-f", "-n", "0", "-o", "cat"],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, errors="replace")
            for line in p.stdout:
                line = line.rstrip("\n")
                m = LINE.match(line)
                with _lock:
                    if m:
                        kind, path = m.groups()
                        STATE["firstAt"] = STATE["firstAt"] or time.time()
                        STATE[{"added": "added", "updating": "updated", "removing": "removed"}[kind]] += 1
                        if kind != "removing":
                            STATE["current"] = _album_of(path)
                            STATE["source"] = _source_name(path)
                    elif line.startswith(("update:", "exception:", "decoder:", "ffmpeg:", "flac:", "mad:", "tag:")) and ERROR.search(line):
                        STATE["errors"].append(line[:300])
                        del STATE["errors"][:-100]
        except Exception as e:
            print("scan: journal follower: %s" % e, flush=True)
        time.sleep(5)


def _start_count(root):
    def run():
        n = _count_files(root)
        with _lock:
            STATE.update(total=n, found=n, counted=True)
    threading.Thread(target=run, daemon=True).start()


def _poll(client, root):
    """Once a second: is MPD scanning? Keep the numbers and the time estimate current."""
    quiet_since = None
    while True:
        try:
            st = client.stats()
            updating = st["updating"]
            now = time.time()
            with _lock:
                # A scan has started when MPD says so, or when files went by in its log (a small
                # folder can be scanned entirely between two of these checks). Counters only
                # reset when a scan ends, so nothing read before we noticed is lost.
                if (updating or STATE["firstAt"]) and not STATE["active"]:
                    if not quiet_since or now - quiet_since > 8:  # a new scan, not a gap in one
                        STATE.update(active=True, phase="counting", started=min(now, STATE["firstAt"] or now),
                                     current="", source="", found=0, counted=False, total=0, eta=None)
                        _window.clear()
                        _start_count(root)
                    else:
                        STATE["active"] = True
                    quiet_since = None
                STATE["songs"] = st["songs"]
                if STATE["active"]:
                    _window.append((now, _processed()))
                    if STATE["counted"] or _processed():
                        STATE["phase"] = "reading"
                    total = STATE["total"] if STATE["counted"] else 0
                    # first scan / new drive: the song count grows; full rescan: the count stays
                    # put and the files re-read grow. Whichever is further along is the progress.
                    done = max(st["songs"], _processed())
                    if total:
                        done = min(done, total)  # two scans merged into one can re-read files twice
                    STATE["done"] = done
                    STATE["pct"] = min(99, int(100 * done / total)) if total else None
                    rate = 0.0
                    if len(_window) >= 3 and _window[-1][0] - _window[0][0] > 2:
                        rate = (_window[-1][1] - _window[0][1]) / (_window[-1][0] - _window[0][0])
                    STATE["rate"] = round(rate, 1)
                    left = max(0, total - done) if total else None
                    STATE["eta"] = int(left / rate) if (left is not None and rate > 0.2) else None
                if not updating and STATE["active"]:
                    if quiet_since is None:
                        quiet_since = now
                    elif now - quiet_since > 3:  # really finished
                        STATE.update(active=False, phase="idle", pct=None, eta=None, rate=0.0, current="", source="")
                        STATE["last"] = {"at": now, "seconds": max(0, int(quiet_since - STATE["started"])),
                                         "added": STATE["added"], "updated": STATE["updated"],
                                         "removed": STATE["removed"], "errors": len(STATE["errors"]),
                                         "songs": st["songs"], "albums": st["albums"]}
                        STATE["lastErrors"] = STATE["errors"][-20:]
                        _save_last()
                        STATE.update(added=0, updated=0, removed=0, errors=[], firstAt=0.0)
        except Exception as e:
            print("scan: %s" % e, flush=True)
        time.sleep(1)


def start(client, root):
    _load_last()
    threading.Thread(target=_follow_journal, daemon=True).start()
    threading.Thread(target=_poll, args=(client, root), daemon=True).start()
