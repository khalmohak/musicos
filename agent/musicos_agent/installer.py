"""Install musicos from the drive it is running on (the USB stick) onto another disk (an SSD).

The new disk gets the same layout as the stick, with the same partition types and labels.
The /usr partitions also keep their UUIDs, because each boot entry finds its /usr through
the UUIDs derived from usrhash=:
    1 ESP          copied as-is (systemd-boot + boot entries)
    2 usr A        copied block for block; 4 GiB (bigger than on the stick, room to grow)
    3 usr-verity A copied
    4 usr B        copied (or left empty for the first update)
    5 usr-verity B copied
    6 root         new ext4 filling the rest of the disk, plus a copy of the running root
                   (settings, Wi-Fi, Bluetooth pairings, SSH keys, music in /srv/music/local)
Then a UEFI boot entry for the new disk is added and put first.

The agent (user "music") lists disks and writes a request. musicos-install.service (root)
runs `python3 -m musicos_agent.installer run`, re-checks the request and does the work,
writing progress to install-status.json.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

from . import config

GiB, MiB = 1 << 30, 1 << 20
MIN_DISK = 16 * GiB
USR_SLOT = 4 * GiB
VERITY_SLOT = 320 * MiB
TYPES = {
    "c12a7328-f81f-11d2-ba4b-00a0c93ec93b": "esp",
    "8484680c-9521-48c6-9c11-b0720656f69e": "usr",          # usr, x86-64
    "77ff5f63-e7b6-4633-acf4-1565b864c0e6": "usr-verity",   # usr-verity, x86-64
    "4f68bce3-e8cd-4db1-96e7-fbcaf984b709": "root",         # root, x86-64
}
MOUNT = "/run/musicos/install-target"
FLAG = "/run/musicos/installing"  # automount leaves the target alone while this exists


def _state(name):
    return os.path.join(config.state_dir(), name)


def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=kw.pop("timeout", 120), **kw)


def _lsblk(dev=None):
    cols = "NAME,PATH,SIZE,MODEL,SERIAL,TRAN,RM,TYPE,ROTA,FSTYPE,LABEL,MOUNTPOINTS,FSUSED,PARTTYPE,PARTLABEL,PARTUUID,PARTFLAGS,LOG-SEC"
    r = _run(["lsblk", "-J", "-b", "-o", cols] + ([dev] if dev else []))
    return json.loads(r.stdout or '{"blockdevices": []}')["blockdevices"]


def boot_disk():
    """Name of the disk the running system's root lives on (e.g. "sda")."""
    src = _run(["findmnt", "-no", "SOURCE", "/"]).stdout.strip()
    disk = _run(["lsblk", "-no", "PKNAME", src]).stdout.strip().splitlines() if src else []
    return disk[0] if disk else ""


def _root_used():
    st = os.statvfs("/")
    return (st.f_blocks - st.f_bfree) * st.f_frsize


def _needed():
    return MiB + GiB + 2 * (USR_SLOT + VERITY_SLOT) + int(_root_used() * 1.1) + 2 * GiB


def _human(n):
    for unit, size in (("TB", 1e12), ("GB", 1e9), ("MB", 1e6)):
        if n >= size:
            return "%.0f %s" % (n / size, unit) if n >= 10 * size else "%.1f %s" % (n / size, unit)
    return "%d B" % n


def _describe(d):
    parts = []
    for c in d.get("children") or []:
        mounts = [m for m in (c.get("mountpoints") or []) if m]
        bits = [c.get("label") or c.get("partlabel") or c.get("name"), c.get("fstype") or "", _human(int(c.get("size") or 0))]
        if c.get("fsused"):
            bits.append("%s used" % _human(int(c["fsused"])))
        parts.append({"name": " · ".join(b for b in bits if b), "mounted": mounts})
    return parts


def disks():
    """Disks musicos could be installed on (never the one it runs from)."""
    boot = boot_disk()
    needed = _needed()
    out, boot_info = [], None
    for d in _lsblk():
        if d.get("type") != "disk" or re.match(r"(loop|zram|sr|ram|dm-)", d["name"]):
            continue
        size = int(d.get("size") or 0)
        tran = (d.get("tran") or "").lower()
        kind = "NVMe SSD" if tran == "nvme" or d["name"].startswith("nvme") else \
            "USB drive" if tran == "usb" else "Hard disk" if d.get("rota") else "SSD"
        info = {"path": d["path"], "name": (d.get("model") or d["name"]).strip(), "serial": (d.get("serial") or "").strip(),
                "size": size, "sizeText": _human(size), "kind": kind, "usb": tran == "usb", "parts": _describe(d)}
        if d["name"] == boot:
            boot_info = info
            continue
        if size < MIN_DISK:
            continue
        info["ok"] = size >= needed
        info["why"] = "" if info["ok"] else "Too small: needs at least %s" % _human(needed)
        out.append(info)
    return {"disks": out, "boot": boot_info, "needed": needed, "neededText": _human(needed),
            "fromUsb": bool(boot_info and boot_info["usb"]), "status": status()}


def status():
    try:
        return json.load(open(_state("install-status.json")))
    except (OSError, ValueError):
        return {"state": "idle"}


def request(path, serial, size):
    """From the UI: install onto `path`. serial+size must match what the user saw."""
    match = [d for d in disks()["disks"] if d["path"] == path]
    if not match:
        raise ValueError("that disk is not available")
    d = match[0]
    if d["serial"] != (serial or "") or d["size"] != int(size):
        raise ValueError("the disks changed; look again")
    if not d["ok"]:
        raise ValueError(d["why"])
    if status().get("state") in ("queued", "running"):
        raise RuntimeError("an install is already running")
    _write_status(state="queued", step="Starting", pct=0, target=d["name"], error="")
    with open(_state("install-request"), "w") as fh:
        json.dump({"path": path, "serial": d["serial"], "size": d["size"], "at": time.time()}, fh)
    return {"ok": True}


# ---- root side --------------------------------------------------------------------------


def _write_status(**kw):
    st = status() if kw.get("state") not in ("queued",) else {}
    st.update(kw, at=time.time())
    tmp = _state("install-status.json.tmp")
    with open(tmp, "w") as fh:
        json.dump(st, fh)
    os.chmod(tmp, 0o644)
    os.replace(tmp, _state("install-status.json"))


def _progress(step, pct):
    print("install: %3d%% %s" % (pct, step), flush=True)
    _write_status(state="running", step=step, pct=int(pct))


def _check(r, what):
    if r.returncode != 0:
        raise RuntimeError("%s failed: %s" % (what, (r.stderr or r.stdout).strip()[-300:]))
    return r


def _copy_block(src, dst, nbytes, step, lo, hi):
    """dd with progress between lo..hi percent."""
    done, last = 0, 0.0
    with open(src, "rb", buffering=0) as r, open(dst, "r+b", buffering=0) as w:
        while done < nbytes:
            chunk = r.read(min(8 * MiB, nbytes - done))
            if not chunk:
                break
            w.write(chunk)
            done += len(chunk)
            if time.time() - last > 1:
                last = time.time()
                _progress(step, lo + (hi - lo) * done / nbytes)
        os.fsync(w.fileno())


def _source_layout():
    """Partitions of the boot disk, in order, classified by GPT type."""
    disk = "/dev/" + boot_disk()
    table = json.loads(_check(_run(["sfdisk", "-J", disk]), "reading the boot disk").stdout)["partitiontable"]
    sector = int(table.get("sectorsize", 512))
    parts = []
    for p in table["partitions"]:
        kind = TYPES.get(p["type"].lower())
        if not kind:
            raise RuntimeError("unexpected partition %s on the boot disk" % p["node"])
        parts.append({"node": p["node"], "kind": kind, "type": p["type"], "uuid": p.get("uuid", ""),
                      "name": p.get("name", ""), "bytes": int(p["size"]) * sector})
    kinds = [p["kind"] for p in parts]
    if kinds != ["esp", "usr", "usr-verity", "usr", "usr-verity", "root"]:
        raise RuntimeError("unexpected layout on the boot disk: %s" % ", ".join(kinds))
    return parts


def _partition_script(src):
    lines = ["label: gpt", ""]
    for p in src:
        if p["kind"] == "esp":
            size, extra = "size=%dMiB" % (p["bytes"] // MiB), ""
        elif p["kind"] == "usr":
            size, extra = "size=%dMiB" % (max(USR_SLOT, p["bytes"]) // MiB), ', uuid=%s, attrs="GUID:60"' % p["uuid"]
        elif p["kind"] == "usr-verity":
            size, extra = "size=%dMiB" % (max(VERITY_SLOT, p["bytes"]) // MiB), ', uuid=%s, attrs="GUID:60"' % p["uuid"]
        else:  # root: the rest of the disk
            size, extra = "", ""
        bits = [b for b in (size, "type=%s" % p["type"]) if b]
        lines.append('%s%s, name="%s"' % (", ".join(bits), extra, p["name"].replace('"', "")))
    return "\n".join(lines) + "\n"


def _umount_all(target):
    for d in _lsblk(target):
        for c in [d] + (d.get("children") or []):
            for m in c.get("mountpoints") or []:
                if m:
                    _run(["umount", "-l", m])


def _efi_entry(target):
    loader = None
    for base in ("/boot", "/efi", "/boot/efi"):
        for rel in ("EFI/systemd/systemd-bootx64.efi", "EFI/BOOT/BOOTX64.EFI"):
            if os.path.exists(os.path.join(base, rel)):
                loader = "\\" + rel.replace("/", "\\")
                break
        if loader:
            break
    if not os.path.isdir("/sys/firmware/efi/efivars"):
        return "not booted with UEFI: choose the new disk in the firmware boot menu"
    r = _run(["efibootmgr", "-c", "-d", target, "-p", "1", "-L", "musicos", "-l", loader or "\\EFI\\BOOT\\BOOTX64.EFI"])
    if r.returncode != 0:
        return "could not add a boot entry (%s): choose the new disk in the firmware boot menu" % r.stderr.strip()[-120:]
    return ""


def run():
    req = json.load(open(_state("install-request")))
    os.remove(_state("install-request"))
    os.makedirs("/run/musicos", exist_ok=True)
    open(FLAG, "w").close()
    target = req["path"]
    try:
        _progress("Checking the disk", 1)
        info = [d for d in disks()["disks"] if d["path"] == target]
        if not info or info[0]["serial"] != req["serial"] or info[0]["size"] != req["size"]:
            raise RuntimeError("the disk changed since it was chosen")
        if not info[0]["ok"]:
            raise RuntimeError(info[0]["why"])
        src = _source_layout()

        _progress("Erasing %s" % info[0]["name"], 3)
        _umount_all(target)
        _run(["wipefs", "-a", target])
        _check(_run(["sfdisk", "--wipe", "always", "--wipe-partitions", "always", "-q", target],
                    input=_partition_script(src)), "partitioning")
        _run(["partprobe", target])
        _run(["udevadm", "settle", "-t", "20"])
        _umount_all(target)  # in case anything raced us
        kids = [c["path"] for c in (_lsblk(target)[0].get("children") or [])]
        if len(kids) != len(src):
            raise RuntimeError("expected %d partitions on the new disk, found %d" % (len(src), len(kids)))

        # block copies: ESP, both /usr slots and their verity data (skip never-used slots)
        blocks = [(s, d) for s, d in zip(src, kids) if s["kind"] != "root" and s["name"] != "_empty"]
        total = sum(s["bytes"] for s, _ in blocks) or 1
        done = 0
        labels = {"esp": "boot files", "usr": "system", "usr-verity": "system checksums"}
        for s, d in blocks:
            lo = 5 + 55 * done / total
            done += s["bytes"]
            _copy_block(s["node"], d, s["bytes"], "Copying %s" % labels[s["kind"]], lo, 5 + 55 * done / total)

        _progress("Creating the data partition", 61)
        root_src = src[-1]
        label = _run(["lsblk", "-no", "LABEL", root_src["node"]]).stdout.strip() or "root"
        _check(_run(["mkfs.ext4", "-F", "-q", "-L", label, kids[-1]], timeout=600), "formatting")
        os.makedirs(MOUNT, exist_ok=True)
        _check(_run(["mount", kids[-1], MOUNT]), "mounting the new disk")
        try:
            _progress("Copying settings and music", 63)
            errlog = open(_state("install-rsync.log"), "w+")
            p = subprocess.Popen(
                ["rsync", "-aHAXx", "--numeric-ids", "--info=progress2", "--no-inc-recursive",
                 "--exclude=/var/lib/musicos/updates/*", "--exclude=/var/lib/musicos/install-*",
                 "--exclude=/var/lib/musicos/update-status.json", "--exclude=/var/log/journal/*",
                 "/", MOUNT + "/"], stdout=subprocess.PIPE, stderr=errlog, text=True)
            last = 0.0
            for chunk in iter(lambda: p.stdout.read(512), ""):  # progress2 redraws with \r
                m = re.findall(r"(\d+)%", chunk)
                if m and time.time() - last > 1:
                    last = time.time()
                    _progress("Copying settings and music", 63 + 32 * int(m[-1]) / 100)
            rc = p.wait()
            errlog.seek(0)
            errors = errlog.read().strip()
            errlog.close()
            # 24: files vanished while copying; 23: some files not copied (sockets, live logs)
            if rc not in (0, 23, 24):
                raise RuntimeError("copying failed (%d): %s" % (rc, errors[-300:]))
            if rc == 23:
                print("install: rsync partial: %s" % errors[-500:], flush=True)
            _run(["sync"], timeout=600)
        finally:
            _run(["umount", MOUNT])

        _progress("Adding the boot entry", 97)
        warn = _efi_entry(target)
        _write_status(state="done", step="Installed", pct=100, warning=warn, error="")
        print("install: done %s" % warn, flush=True)
    except Exception as e:
        print("install: FAILED %s" % e, flush=True)
        _write_status(state="failed", error=str(e)[:400])
        return 1
    finally:
        try:
            os.remove(FLAG)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["run"]:
        sys.exit(run())
    if sys.argv[1:] == ["disks"]:
        print(json.dumps(disks(), indent=1))
        sys.exit(0)
    print("usage: python3 -m musicos_agent.installer disks|run")
    sys.exit(2)
