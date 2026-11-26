"""The library: one list of folders, picked from any source.

A source is somewhere music lives:
    local            this device (/srv/music/local, the SSH drop folder)
    drive:<fs uuid>  a USB or internal drive, recognised by its filesystem wherever it is mounted
    net:<id>         a network share (SMB/NFS) mounted by musicos-apply under /srv/music/net-<id>

A library folder is (source, path inside it). MPD's music_directory is LIB_DIR, which holds one
symlink per folder: LIB_DIR/<folder id> -> the folder's current location. MPD only ever scans
folders whose source is connected (auto_update is off, and the agent never asks for a scan of
the whole tree), so the albums of an unplugged drive stay in the database and the UI shows
them greyed out until the drive is back.
"""
import json
import os
import re
import secrets
import subprocess
import threading
import time

from . import config

MUSIC_ROOT = os.environ.get("MUSICOS_MUSIC_ROOT", "/srv/music")
AUDIO = {".flac", ".mp3", ".m4a", ".mp4", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff",
         ".dsf", ".dff", ".wv", ".ape", ".mpc", ".wma", ".alac"}
_lock = threading.RLock()
ONLINE = {}         # folder id -> bool (refreshed by the monitor)
NEW_DRIVES = {}     # drive source id -> {"name", "size", "mount"} plugged in but not in the library
_mounts_cache = [0.0, {}]


def lib_dir():
    d = os.environ.get("MUSICOS_LIBRARY_DIR") or os.path.join(config.state_dir(), "library")
    os.makedirs(d, exist_ok=True)
    return d


# ---- folders (library.json) -------------------------------------------------------------
def folders():
    try:
        return json.load(open(os.path.join(config.state_dir(), "library.json")))["folders"]
    except (OSError, ValueError, KeyError):
        return None  # never set up: migrate()


def _save(items, ignored=None):
    path = os.path.join(config.state_dir(), "library.json")
    data = {"folders": items, "ignoredDrives": ignored if ignored is not None else ignored_drives()}
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=1)
    os.replace(tmp, path)


def ignored_drives():
    try:
        return json.load(open(os.path.join(config.state_dir(), "library.json"))).get("ignoredDrives", [])
    except (OSError, ValueError):
        return []


# ---- sources ----------------------------------------------------------------------------
def _mounts():
    """{mountpoint: {"uuid", "fstype", "source"}} for drives under the music root (cached 5 s)."""
    if time.time() - _mounts_cache[0] < 5:
        return _mounts_cache[1]
    out = {}
    try:
        r = subprocess.run(["findmnt", "-rn", "-o", "TARGET,UUID,FSTYPE,SOURCE"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            parts = line.split(" ")
            if len(parts) >= 4 and parts[0].startswith(MUSIC_ROOT + "/"):
                target = parts[0].encode().decode("unicode_escape")
                if parts[2] == "autofs":  # automount placeholder: not mounted yet
                    continue
                out[target] = {"uuid": parts[1], "fstype": parts[2], "source": parts[3]}
    except (OSError, subprocess.SubprocessError):
        pass
    _mounts_cache[:] = [time.time(), out]
    return out


def sources():
    """Every place music can come from right now (connected or remembered)."""
    out = [{"id": "local", "kind": "local", "name": "This device", "online": True,
            "mount": os.path.join(MUSIC_ROOT, "local")}]
    for mnt, m in sorted(_mounts().items()):
        name = os.path.basename(mnt)
        if name.startswith(("usb-", "disk-")) and m["uuid"]:
            out.append({"id": "drive:" + m["uuid"], "kind": "usb" if name.startswith("usb-") else "disk",
                        "name": name.split("-", 1)[1].replace("_", " "), "online": True, "mount": mnt,
                        "fstype": m["fstype"]})
    for s in config.sources():
        mnt = os.path.join(MUSIC_ROOT, "net-" + s["id"])
        out.append({"id": "net:" + s["id"], "kind": "network", "name": s.get("name") or s["id"],
                    "online": mnt in _mounts(), "mount": mnt, "server": s.get("server", ""),
                    "share": s.get("share", ""), "protocol": s.get("type", "smb")})
    # drives that hold library folders but are unplugged
    known = {s["id"] for s in out}
    for f in folders() or []:
        if f["source"] not in known:
            known.add(f["source"])
            out.append({"id": f["source"], "kind": "usb" if f.get("sourceKind") == "usb" else "disk",
                        "name": f.get("sourceName") or "Drive", "online": False, "mount": ""})
    return out


def source_mount(source_id):
    """Where a source is mounted now, or None when it isn't connected."""
    if source_id == "local":
        return os.path.join(MUSIC_ROOT, "local")
    if source_id.startswith("net:"):
        mnt = os.path.join(MUSIC_ROOT, "net-" + source_id[4:])
        return mnt  # automounted: touching it mounts it (status comes from the monitor)
    if source_id.startswith("drive:"):
        uuid = source_id[6:]
        for mnt, m in _mounts().items():
            if m["uuid"] == uuid:
                return mnt
    return None


def _safe_rel(path):
    path = (path or "").strip("/")
    if any(p in ("..", ".") for p in path.split("/")) or "\0" in path:
        raise ValueError("bad path")
    return path


def folder_target(f):
    mnt = source_mount(f["source"])
    return os.path.join(mnt, f["path"]) if mnt else None


# ---- browsing ---------------------------------------------------------------------------
def _count_audio(path, budget):
    """Audio files under path, giving up after `budget` seconds (returns (count, complete))."""
    n, stack, deadline = 0, [path], time.time() + budget
    while stack:
        if time.time() > deadline:
            return n, False
        d = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        elif os.path.splitext(e.name)[1].lower() in AUDIO:
                            n += 1
                    except OSError:
                        pass
        except OSError:
            pass
    return n, True


def browse(source_id, path=""):
    """Subfolders of a source folder, each with an audio file count (capped in time)."""
    mnt = source_mount(source_id)
    if not mnt:
        raise ValueError("that source is not connected")
    rel = _safe_rel(path)
    here = os.path.join(mnt, rel)
    try:
        entries = sorted((e for e in os.scandir(here) if e.is_dir() and not e.name.startswith(".")),
                         key=lambda e: e.name.casefold())
    except OSError as e:
        raise ValueError("can't open this folder: %s" % e.strerror)
    budget = max(0.15, 4.0 / max(1, len(entries)))
    out = []
    for e in entries[:400]:
        n, complete = _count_audio(e.path, budget)
        out.append({"name": e.name, "path": os.path.join(rel, e.name), "audio": n, "complete": complete})
    here_files = sum(1 for e in os.scandir(here) if e.is_file() and os.path.splitext(e.name)[1].lower() in AUDIO)
    included = [f for f in folders() or [] if f["source"] == source_id]
    return {"source": source_id, "path": rel, "folders": out, "audioHere": here_files,
            "included": [f["path"] for f in included]}


# ---- changing the library ---------------------------------------------------------------
def _link(f):
    """(Re)point LIB_DIR/<id> at the folder's current location. Dangling while offline."""
    link = os.path.join(lib_dir(), f["id"])
    target = folder_target(f)
    if not target:
        return
    try:
        if os.readlink(link) == target:
            return
        os.remove(link)
    except OSError:
        pass
    os.symlink(target, link)


def add_folder(source_id, path, client=None):
    path = _safe_rel(path)
    src = next((s for s in sources() if s["id"] == source_id), None)
    if not src:
        raise ValueError("unknown source")
    mnt = source_mount(source_id)
    if not mnt or not os.path.isdir(os.path.join(mnt, path)):
        raise ValueError("that folder is not reachable")
    with _lock:
        items = folders() or []
        for f in items:
            if f["source"] == source_id and (f["path"] == path or path.startswith(f["path"] + "/") and f["path"]):
                raise ValueError("already in the library (inside %s)" % (f["path"] or "the whole source"))
            if f["source"] == source_id and f["path"].startswith(path + "/" if path else ""):
                raise ValueError("a folder inside it is already in the library: remove that one first")
        f = {"id": "f" + secrets.token_hex(3), "source": source_id, "path": path,
             "name": path.rsplit("/", 1)[-1] if path else src["name"], "sourceName": src["name"],
             "sourceKind": src["kind"], "enabled": True, "added": time.time()}
        items.append(f)
        ignored = [d for d in ignored_drives() if d != source_id]
        _save(items, ignored)
        NEW_DRIVES.pop(source_id, None)
        _link(f)
        ONLINE[f["id"]] = True
    if client:
        client.update(f["id"])
    return f


def remove_folder(fid, client=None):
    with _lock:
        items = folders() or []
        if not any(f["id"] == fid for f in items):
            raise ValueError("no such folder")
        _save([f for f in items if f["id"] != fid])
        try:
            os.remove(os.path.join(lib_dir(), fid))
        except OSError:
            pass
        ONLINE.pop(fid, None)
    if client:
        client.update(fid)  # the path is gone: MPD drops its songs
    return {"ok": True}


def set_enabled(fid, on):
    """Pause a folder: its albums are hidden, nothing is deleted or rescanned."""
    with _lock:
        items = folders() or []
        for f in items:
            if f["id"] == fid:
                f["enabled"] = bool(on)
        _save(items)
    return {"ok": True}


def ignore_drive(source_id):
    with _lock:
        _save(folders() or [], sorted(set(ignored_drives()) | {source_id}))
        NEW_DRIVES.pop(source_id, None)
    return {"ok": True}


def migrate(client=None):
    """First run of the folder library: every source connected right now becomes a folder."""
    with _lock:
        if folders() is not None:
            return False
        _save([])
    added = []
    for s in sources():
        if s["online"] and os.path.isdir(s["mount"]):
            try:
                added.append(add_folder(s["id"], "", client=None))
            except ValueError:
                pass
    print("library: migrated %d source(s) into folders" % len(added), flush=True)
    if client:
        for f in added:
            client.update(f["id"])
    return True


# ---- state for the UI -------------------------------------------------------------------
def folder_of(file):
    return file.split("/", 1)[0] if file else ""


def hidden_folders():
    return {f["id"] for f in folders() or [] if not f.get("enabled", True)}


def offline_folders():
    return {fid for fid, on in ONLINE.items() if not on}


def overview(client=None):
    counts = client.folder_counts() if client and hasattr(client, "folder_counts") else {}
    srcs = {s["id"]: s for s in sources()}
    out = []
    for f in folders() or []:
        s = srcs.get(f["source"], {})
        c = counts.get(f["id"], {})
        out.append(dict(f, online=ONLINE.get(f["id"], False), sourceOnline=s.get("online", False),
                        albums=c.get("albums", 0), tracks=c.get("tracks", 0), seconds=c.get("seconds", 0)))
    return {"folders": out, "sources": list(srcs.values()),
            "newDrives": [dict(v, id=k) for k, v in NEW_DRIVES.items()]}


# ---- monitor ----------------------------------------------------------------------------
def _reachable(path, timeout=6.0):
    """isdir with a time limit: an unreachable network share can block for a long time."""
    res = []
    def probe():
        try:
            os.listdir(path)  # raises when missing, unmounted share, permission denied
            res.append(True)
        except OSError:
            res.append(False)
    t = threading.Thread(target=probe, daemon=True)
    t.start()
    t.join(timeout)
    return bool(res and res[0])


def _signature(path):
    """Cheap change detector for writable folders: newest mtime of the folder and two levels down."""
    best = 0.0
    try:
        best = os.stat(path).st_mtime
        with os.scandir(path) as it:
            for e in it:
                if e.is_dir(follow_symlinks=False) and not e.name.startswith("."):
                    best = max(best, e.stat().st_mtime)
                    with os.scandir(e.path) as it2:
                        for e2 in it2:
                            if e2.is_dir(follow_symlinks=False):
                                best = max(best, e2.stat().st_mtime)
    except OSError:
        pass
    return best


def monitor(client):
    """Every 10 s: which folders are reachable; scan folders that came back or changed;
    note drives that were plugged in but aren't in the library."""
    def loop():
        sigs, last_net = {}, {}
        while True:
            try:
                for f in folders() or []:
                    target = folder_target(f)
                    on = bool(target) and _reachable(target)
                    was = ONLINE.get(f["id"])
                    ONLINE[f["id"]] = on
                    if not on:
                        continue
                    _link(f)
                    net = f["source"].startswith("net:")
                    if was is False:  # came back: catch up on what changed while away
                        print("library: %s is back, scanning it" % f["name"], flush=True)
                        client.update(f["id"])
                    elif not net:
                        sig = _signature(target)
                        if f["id"] in sigs and sig != sigs[f["id"]]:
                            client.update(f["id"])
                        sigs[f["id"]] = sig
                    elif time.time() - last_net.get(f["id"], 0) > 3600:
                        if f["id"] in last_net:
                            client.update(f["id"])
                        last_net[f["id"]] = time.time()
                used = {f["source"] for f in folders() or []}
                ignored = set(ignored_drives())
                for s in sources():
                    if s["id"].startswith("drive:") and s["online"] and s["id"] not in used | ignored:
                        if s["id"] not in NEW_DRIVES:
                            try:
                                import shutil
                                size = shutil.disk_usage(s["mount"]).total
                            except OSError:
                                size = 0
                            NEW_DRIVES[s["id"]] = {"name": s["name"], "kind": s["kind"], "size": size, "mount": s["mount"]}
                for k in list(NEW_DRIVES):
                    if not any(s["id"] == k and s["online"] for s in sources()):
                        NEW_DRIVES.pop(k, None)
            except Exception as e:
                print("library monitor: %s" % e, flush=True)
            time.sleep(10)
    threading.Thread(target=loop, daemon=True).start()


def scan_all(client, full=False):
    """Scan (or re-read) every connected, enabled folder. Never the whole tree: that would
    drop the albums of unplugged drives."""
    n = 0
    for f in folders() or []:
        if ONLINE.get(f["id"]) or (folder_target(f) and _reachable(folder_target(f))):
            (client.rescan if full else client.update)(f["id"])
            n += 1
    return n
