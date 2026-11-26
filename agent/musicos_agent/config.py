"""Persistent settings and music sources, stored as JSON under the state dir.

The agent runs unprivileged; anything that needs root (mounts, MPD output changes)
is requested by touching `apply-request`, which the root-only musicos-apply.path
unit watches (see apply.py).
"""
import json
import os
import re
import tempfile
import threading

_lock = threading.Lock()

DEFAULTS = {
    "setupComplete": False,
    "name": "",
    "uiSounds": True,
    "audioDevice": "default",
    "bitPerfect": False,
    "screensaver": 5,  # minutes of no input; 0 = never
    "autoSleep": 0,  # minutes idle and not playing before the TV is switched off (CEC); 0 = never
    "sleepSystem": False,  # also suspend the box itself
    "uiScale": 1.0,
    "overscan": 0,  # percent of the screen to pad on each side (TVs that crop the edges)
    "displayMode": "",  # "1920x1080@60"; empty = the TV's preferred mode
    "onlineArt": True,
    "updateUrl": "",  # e.g. http://<build host>:8090 (scripts/publish-update.sh)
    "spotify": True,
    "airplay": True,
    "receiverName": "musicos",
}
EDITABLE = set(DEFAULTS)


def state_dir():
    d = os.environ.get("MUSICOS_STATE")
    if not d:
        d = "/var/lib/musicos" if os.access("/var/lib/musicos", os.W_OK) else os.path.expanduser("~/.musicos-dev")
    os.makedirs(d, exist_ok=True)
    return d


def _path(name):
    return os.path.join(state_dir(), name)


def _read(name, default):
    try:
        with open(_path(name)) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _write(name, data, mode=0o644):
    d = state_dir()
    fd, tmp = tempfile.mkstemp(dir=d, prefix="." + name)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2)
    os.chmod(tmp, mode)
    os.replace(tmp, _path(name))


def load():
    cfg = dict(DEFAULTS)
    cfg.update(_read("config.json", {}))
    return cfg


def update(changes):
    with _lock:
        cfg = load()
        for k, v in changes.items():
            if k in EDITABLE:
                cfg[k] = v
        _write("config.json", cfg)
        return cfg


# ---- network music sources ----
SLUG_RE = re.compile(r"[^a-z0-9]+")


def sources():
    return _read("sources.json", [])


def add_smb(name, server, share, path="", username="", password=""):
    for field, value in (("server", server), ("share", share)):
        if not value or any(c in value for c in "\n\r\0"):
            raise ValueError("invalid %s" % field)
    if any(c in (path or "") + username + password for c in "\n\r\0"):
        raise ValueError("invalid characters")
    sid = SLUG_RE.sub("-", (name or share).lower()).strip("-")[:24] or "share"
    with _lock:
        items = [s for s in sources() if s["id"] != sid]
        items.append({"id": sid, "type": "smb", "name": name or share, "server": server.strip(),
                      "share": share.strip("/ "), "path": (path or "").strip("/ "), "username": username})
        _write("sources.json", items)
        secrets = _path("secrets")
        os.makedirs(secrets, mode=0o700, exist_ok=True)
        cred = os.path.join(secrets, sid + ".cred")
        fd = os.open(cred, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            if username:
                fh.write("username=%s\npassword=%s\n" % (username, password))
            else:
                fh.write("username=guest\npassword=\n")
    request_apply()
    return sid


def add_nfs(name, server, export, path=""):
    for field, value in (("server", server), ("export", export)):
        if not value or any(c in value for c in "\n\r\0\""):
            raise ValueError("invalid %s" % field)
    sid = SLUG_RE.sub("-", (name or export.rsplit("/", 1)[-1] or server).lower()).strip("-")[:24] or "nfs"
    with _lock:
        items = [s for s in sources() if s["id"] != sid]
        items.append({"id": sid, "type": "nfs", "name": name or export, "server": server.strip(),
                      "share": "/" + export.strip("/ "), "path": (path or "").strip("/ ")})
        _write("sources.json", items)
    request_apply()
    return sid


def remove_source(sid):
    with _lock:
        _write("sources.json", [s for s in sources() if s["id"] != sid])
        try:
            os.remove(os.path.join(_path("secrets"), sid + ".cred"))
        except OSError:
            pass
    request_apply()


def request_apply():
    """Ask the root helper to re-apply mounts and audio output."""
    with open(_path("apply-request"), "w") as fh:
        fh.write(str(os.getpid()))
