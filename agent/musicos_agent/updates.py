"""Software updates (A/B, systemd-sysupdate).

An update is a folder with latest.json + the files systemd-sysupdate installs:
    latest.json                               {"version": "...", "files": [{"name", "sha256", "size"}]}
    musicos_<v>.usr.<uuid>.raw.zst            /usr partition (erofs)
    musicos_<v>.usr-verity.<uuid>.raw.zst
    musicos_<v>.efi                           unified kernel image (boot entry)
It's published by scripts/publish-update.sh and fetched from a URL (Settings) or from a
"musicos-update" folder on any USB drive. Files are verified against latest.json (sha256),
the partition images are unpacked to .raw (systemd-sysupdate copies local files as-is), and
the root-only musicos-update.service installs them into the inactive slot.

Also a command line for SSH (as root, see /usr/local/bin/musicos-update):
    python3 -m musicos_agent.updates [URL]     check, download, verify, unpack; then install
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

from . import config

PROGRESS = {"state": "idle", "done": 0, "total": 0, "error": ""}
# result of the last automatic check: {"version", "checked"} (version "" = up to date)
AVAILABLE = {"version": "", "checked": 0.0, "error": ""}
_lock = threading.Lock()


def updates_dir():
    d = os.path.join(config.state_dir(), "updates")
    os.makedirs(d, exist_ok=True)
    return d


def current_version():
    for path in ("/usr/lib/os-release", "/etc/os-release"):
        try:
            for line in open(path):
                if line.startswith("IMAGE_VERSION="):
                    return line.split("=", 1)[1].strip().strip('"')
        except OSError:
            pass
    return "dev"


def _vkey(v):
    return [int(p) if p.isdigit() else p for p in v.replace("-", ".").split(".")]


def newer(a, b):
    try:
        return _vkey(a) > _vkey(b)
    except TypeError:
        return a > b


def usb_updates():
    """latest.json manifests found in a musicos-update folder on any mounted drive."""
    out = []
    for m in glob.glob("/srv/music/*/musicos-update/latest.json"):
        try:
            out.append({"path": os.path.dirname(m), "version": json.load(open(m))["version"]})
        except (OSError, ValueError, KeyError):
            pass
    return out


def _booted_at():
    try:
        return time.time() - float(open("/proc/uptime").read().split()[0])
    except (OSError, ValueError):
        return 0.0


def _install_state():
    """"", queued, installing, installed (restart pending), failed, or rolledback (the new
    version was installed but this boot is still the old one: it failed to start)."""
    path = os.path.join(config.state_dir(), "update-status.json")
    try:
        st = json.load(open(path))
        mtime = os.stat(path).st_mtime
    except (OSError, ValueError):
        return "", ""
    state, ver = st.get("state", ""), st.get("version", "")
    if state == "installed":
        if ver and ver == current_version():
            return "", ver  # done: we are running it
        if mtime < _booted_at() - 5 and ver:
            return "rolledback", ver  # rebooted since, but still on the old version
    return state, ver


def status():
    state, ver = _install_state()
    staged = None
    try:
        staged = json.load(open(os.path.join(updates_dir(), "latest.json")))["version"]
    except (OSError, ValueError, KeyError):
        pass
    return {"current": current_version(), "staged": staged, "install": state, "installVersion": ver,
            "progress": dict(PROGRESS), "url": config.load().get("updateUrl", ""), "usb": usb_updates(),
            "available": AVAILABLE["version"], "checked": AVAILABLE["checked"], "checkError": AVAILABLE["error"],
            "log": _tail(os.path.join(config.state_dir(), "update.log"))}


def _tail(path, n=12):
    try:
        return open(path, errors="replace").read().splitlines()[-n:]
    except OSError:
        return []


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _stage(manifest, fetch):
    """Download/copy every file into the updates dir, verify, then write latest.json last."""
    d = updates_dir()
    for f in os.listdir(d):  # only one staged update at a time
        os.remove(os.path.join(d, f))
    files = manifest["files"]
    PROGRESS.update(state="downloading", done=0, total=sum(int(f.get("size", 0)) for f in files), error="")
    for f in files:
        name = os.path.basename(f["name"])
        if not name.startswith("musicos_") or "/" in f["name"]:
            raise ValueError("unexpected file in update: %s" % f["name"])
        tmp = os.path.join(d, name + ".part")
        fetch(name, tmp)
        if _sha256(tmp) != f["sha256"]:
            os.remove(tmp)
            raise ValueError("checksum mismatch for %s" % name)
        os.replace(tmp, os.path.join(d, name))
    PROGRESS.update(state="unpacking")
    for name in os.listdir(d):
        if name.endswith(".raw.zst"):
            _unpack(os.path.join(d, name))
    with open(os.path.join(d, "latest.json"), "w") as fh:
        json.dump(manifest, fh)
    PROGRESS.update(state="ready")


def _unpack(path):
    """foo.raw.zst -> foo.raw (sparse). systemd-sysupdate writes a local file to the partition
    byte for byte, so it must be the plain image."""
    out = path[:-4]
    r = subprocess.run(["zstd", "-q", "-d", "-f", "--sparse", path, "-o", out + ".part"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("unpack failed: %s" % (r.stderr.strip() or r.returncode))
    os.replace(out + ".part", out)
    os.remove(path)


def _copy_progress(src, dst):
    with src as r, open(dst, "wb") as w:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            w.write(chunk)
            PROGRESS["done"] += len(chunk)


def _run(job):
    if not _lock.acquire(blocking=False):
        raise RuntimeError("an update is already in progress")

    def wrapped():
        try:
            job()
        except Exception as e:
            PROGRESS.update(state="failed", error=str(e))
        finally:
            _lock.release()

    threading.Thread(target=wrapped, daemon=True).start()


def check_url(url):
    """Fetch latest.json from url; returns it (no download)."""
    url = url.rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise ValueError("update address must start with http:// or https://")
    with urllib.request.urlopen(url + "/latest.json", timeout=10) as r:
        return json.load(r)


def download(url):
    url = url.rstrip("/")
    manifest = check_url(url)
    if not newer(manifest["version"], current_version()):
        return {"upToDate": True, "version": manifest["version"]}

    def fetch(name, tmp):
        _copy_progress(urllib.request.urlopen("%s/%s" % (url, name), timeout=30), tmp)

    _run(lambda: _stage(manifest, fetch))
    return {"upToDate": False, "version": manifest["version"]}


def from_usb(path):
    if not any(u["path"] == path for u in usb_updates()):
        raise ValueError("no update there")
    manifest = json.load(open(os.path.join(path, "latest.json")))

    def fetch(name, tmp):
        _copy_progress(open(os.path.join(path, name), "rb"), tmp)

    _run(lambda: _stage(manifest, fetch))
    return {"version": manifest["version"]}


def auto_check():
    """Background: look for a newer version at the update address every 6 hours.
    Only checks (a few hundred bytes); downloading and installing stay the user's call."""
    time.sleep(90)
    while True:
        url = config.load().get("updateUrl", "")
        if url:
            try:
                v = check_url(url)["version"]
                AVAILABLE.update(version=v if newer(v, current_version()) else "", checked=time.time(), error="")
            except Exception as e:
                AVAILABLE.update(checked=time.time(), error=str(e)[:200])
        time.sleep(6 * 3600)


def install():
    if PROGRESS.get("state") not in ("ready", "idle") and not os.path.exists(os.path.join(updates_dir(), "latest.json")):
        raise RuntimeError("nothing staged")
    with open(os.path.join(config.state_dir(), "update-status.json"), "w") as fh:
        json.dump({"state": "queued"}, fh)
    with open(os.path.join(config.state_dir(), "update-request"), "w") as fh:
        fh.write("install")
    return {"ok": True}


def discard():
    shutil.rmtree(updates_dir(), ignore_errors=True)
    PROGRESS.update(state="idle", done=0, total=0, error="")


def main(argv):
    """musicos-update [URL]: the same download/verify/unpack as the UI, then install. For SSH."""
    url = (argv[0] if argv else "") or config.load().get("updateUrl", "")
    if not url:
        print("usage: musicos-update URL   (or set the update address in Settings)")
        return 2
    m = check_url(url)
    print("installed %s, available %s" % (current_version(), m["version"]))
    if not newer(m["version"], current_version()) and "--force" not in argv:
        print("already up to date (--force to reinstall)")
        return 0
    url = url.rstrip("/")
    _stage(m, lambda name, tmp: _copy_progress(urllib.request.urlopen("%s/%s" % (url, name), timeout=30), tmp))
    print("downloaded and verified; installing")
    r = subprocess.run(["/usr/local/lib/musicos/install-update"])
    print(open(os.path.join(config.state_dir(), "update.log")).read())
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
