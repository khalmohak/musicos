"""Network shares: find servers, list their shares, and test a connection step by step
before it is added (smbclient / showmount, no root and no mount needed).

The test answers, in order, the questions people actually have:
    reach   is the server there?            (TCP connect to 445 / 2049, with the time it took)
    login   are the username/password right? (SMB)
    share   does the share exist?            (lists the ones that do when it doesn't)
    read    can musicos read it?
    music   is there music in it?            (audio files found in a quick look)
    speed   is the network fast enough?      (reads one audio file, MB/s, and what that allows)
"""
import os
import re
import socket
import subprocess
import tempfile
import time

AUDIO = re.compile(r"\.(flac|mp3|m4a|mp4|aac|ogg|oga|opus|wav|aiff?|dsf|dff|wv|ape|mpc|wma|alac)$", re.I)
HOST = re.compile(r"^[A-Za-z0-9.\-:]+$")


def _host(h):
    h = (h or "").strip().strip("/").replace("smb://", "").replace("\\\\", "")
    if not HOST.match(h):
        raise ValueError("enter a server name or address, like 192.168.1.20 or nas.local")
    return h


def discover(timeout=4):
    """Servers announcing SMB or NFS on the LAN (mDNS), e.g. a Samba server, a NAS, a Mac."""
    found = {}
    for svc, proto in (("_smb._tcp", "smb"), ("_nfs._tcp", "nfs")):
        try:
            r = subprocess.run(["avahi-browse", "-rpt", svc], capture_output=True, text=True, timeout=timeout + 2)
        except (OSError, subprocess.SubprocessError):
            continue
        for line in r.stdout.splitlines():
            f = line.split(";")
            # =;eth0;IPv4;Name;_smb._tcp;local;host.local;192.168.1.20;445;txt
            if len(f) >= 9 and f[0] == "=" and f[2] == "IPv4" and not f[7].startswith("127."):
                key = f[7]
                s = found.setdefault(key, {"name": f[3].replace("\\032", " "), "host": f[6], "address": f[7], "protocols": []})
                if proto not in s["protocols"]:
                    s["protocols"].append(proto)
    return sorted(found.values(), key=lambda s: s["name"].casefold())


def _authfile(username, password):
    fd, path = tempfile.mkstemp(prefix="musicos-smb-")
    with os.fdopen(fd, "w") as fh:
        fh.write("username = %s\npassword = %s\n" % (username or "guest", password or ""))
    return path


def _smb(args, username, password, timeout=12):
    auth = _authfile(username, password)
    try:
        extra = ["-A", auth] if username else ["-N"]
        r = subprocess.run(["smbclient"] + extra + args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        return 124, (e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
    finally:
        os.remove(auth)


SMB_ERRORS = {
    "NT_STATUS_LOGON_FAILURE": "Wrong username or password",
    "NT_STATUS_ACCESS_DENIED": "This account isn't allowed to read it",
    "NT_STATUS_ACCOUNT_DISABLED": "This account is disabled on the server",
    "NT_STATUS_BAD_NETWORK_NAME": "No share with that name",
    "NT_STATUS_OBJECT_NAME_NOT_FOUND": "That folder doesn't exist on the share",
    "NT_STATUS_OBJECT_PATH_NOT_FOUND": "That folder doesn't exist on the share",
    "NT_STATUS_HOST_UNREACHABLE": "The server can't be reached",
    "NT_STATUS_CONNECTION_REFUSED": "The server refused the connection (file sharing off?)",
    "NT_STATUS_IO_TIMEOUT": "The server didn't answer in time",
}


def _smb_error(out):
    for code, text in SMB_ERRORS.items():
        if code in out:
            return text
    m = re.search(r"NT_STATUS_[A-Z_]+", out)
    return m.group(0) if m else (out.strip().splitlines() or ["unknown error"])[-1][:160]


def shares(protocol, server, username="", password=""):
    server = _host(server)
    if protocol == "nfs":
        r = subprocess.run(["showmount", "-e", "--no-headers", server], capture_output=True, text=True, timeout=12)
        if r.returncode != 0:
            raise ValueError((r.stderr or "no answer").strip()[:200])
        return [{"name": line.split()[0], "comment": ""} for line in r.stdout.splitlines() if line.strip()]
    rc, out = _smb(["-g", "-L", "//" + server], username, password)
    items = []
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) >= 2 and parts[0] == "Disk" and not parts[1].endswith("$"):
            items.append({"name": parts[1], "comment": parts[2] if len(parts) > 2 else ""})
    if not items and rc != 0:
        raise ValueError(_smb_error(out))
    return items


def _tcp(server, port, timeout=3):
    t = time.time()
    try:
        with socket.create_connection((server, port), timeout=timeout):
            return int((time.time() - t) * 1000), ""
    except socket.gaierror:
        return None, "Can't find a server called %s" % server
    except OSError as e:
        return None, "No answer from %s (%s): check it's on and on this network" % (server, e.strerror or "timeout")


def verdict(mb_s):
    if mb_s >= 5:
        return "Fast enough for anything, including DSD and 24-bit/192 kHz"
    if mb_s >= 1.5:
        return "Fine for hi-res (24-bit/192 kHz); DSD256 may stutter"
    if mb_s >= 0.4:
        return "Fine for CD quality; hi-res may stutter"
    return "Too slow for reliable playback: try Ethernet or move closer to the router"


def test(protocol, server, share, path="", username="", password=""):
    """Run the connection test; returns {"ok", "steps": [{"id", "ok", "title", "detail"}]}."""
    steps = []

    def step(sid, ok, title, detail=""):
        steps.append({"id": sid, "ok": ok, "title": title, "detail": detail})
        return ok

    try:
        server = _host(server)
    except ValueError as e:
        step("reach", False, "Server address", str(e))
        return {"ok": False, "steps": steps}
    port = 2049 if protocol == "nfs" else 445
    ms, err = _tcp(server, port)
    if not step("reach", ms is not None, "Server reachable" if ms is not None else "Server not reachable",
                "%s answered in %d ms" % (server, ms) if ms is not None else err):
        return {"ok": False, "steps": steps}

    if protocol == "nfs":
        try:
            exports = [s["name"] for s in shares("nfs", server)]
        except Exception as e:
            step("share", False, "Exports not readable", str(e))
            return {"ok": False, "steps": steps}
        ok = share in exports
        step("share", ok, "Export found" if ok else "Export not found",
             share if ok else "Available: %s" % (", ".join(exports) or "none"))
        if ok:
            step("read", None, "Reading and speed", "Checked after it's added (NFS needs a mount)")
        return {"ok": ok, "steps": steps}

    try:
        names = [s["name"] for s in shares("smb", server, username, password)]
        step("login", True, "Signed in" if username else "Guest access works", username or "no password")
    except ValueError as e:
        step("login", False, "Sign-in failed", str(e))
        return {"ok": False, "steps": steps}
    if share not in names and share.lower() not in [n.lower() for n in names]:
        step("share", False, "Share not found", "Available: %s" % (", ".join(names) or "none"))
        return {"ok": False, "steps": steps}
    step("share", True, "Share found", share)

    target = "//%s/%s" % (server, share)
    sub = (path or "").strip("/")
    rc, out = _smb([target, "-D", sub or "/", "-c", "ls"], username, password)
    if rc != 0:
        step("read", False, "Can't read it", _smb_error(out))
        return {"ok": False, "steps": steps}
    step("read", True, "Can read files", "/" + sub if sub else "the whole share")

    # quick look for music: recursive listing, cut off after a few seconds
    rc, out = _smb([target, "-D", sub or "/", "-c", "recurse ON; ls"], username, password, timeout=8)
    current, audio, biggest = "", 0, None
    for line in out.splitlines():
        if line.startswith("\\"):
            current = line.strip()
            continue
        m = re.match(r"^\s{2}(.+?)\s+[A-Z]*\s+(\d+)\s+\w{3} \w{3}\s+\d+", line)
        if m and AUDIO.search(m.group(1).strip()):
            audio += 1
            size = int(m.group(2))
            if 2_000_000 < size < 400_000_000 and (biggest is None or size > biggest[1]):
                biggest = (current.rstrip("\\") + "\\" + m.group(1).strip(), size)
    partial = rc == 124
    if not step("music", audio > 0, "Music found" if audio else "No music found",
                ("at least %d audio files" if partial else "%d audio files") % audio if audio
                else "No audio files in this folder: pick the folder your music is in"):
        return {"ok": True, "steps": steps, "audio": 0}

    if not biggest:
        step("speed", None, "Speed not measured", "No audio file big enough for a fair measurement")
    else:
        remote = biggest[0].lstrip("\\")  # the recursive listing is relative to the share root
        t = time.time()
        rc, out = _smb([target, "-c", 'get "%s" /dev/null' % remote.replace('"', "")], username, password, timeout=25)
        m = re.search(r"\(average ([\d.]+) KiloBytes/sec\)", out)
        if m:
            mb = float(m.group(1)) / 1024
        elif rc == 0:
            mb = biggest[1] / max(0.001, time.time() - t) / 1e6
        else:
            mb = None
        if mb is not None:
            step("speed", mb >= 0.4, "Read speed %.1f MB/s" % mb, verdict(mb))
        else:
            step("speed", None, "Speed not measured", _smb_error(out))
    return {"ok": True, "steps": steps, "audio": audio}
