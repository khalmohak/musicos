"""Host facts the UI needs: addresses, audio devices, test sound, music sources."""
import math
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import wave

from . import audio, config


def device_info(port):
    ips = []
    try:
        out = subprocess.run(["ip", "-4", "-o", "addr", "show", "scope", "global"],
                             capture_output=True, text=True, timeout=3).stdout
        ips = [line.split()[3].split("/")[0] for line in out.splitlines()]
    except (OSError, subprocess.SubprocessError):
        pass
    if not ips:  # macOS / fallback: address of the default route, no packets sent
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("192.0.2.1", 9))
            ips = [s.getsockname()[0]]
            s.close()
        except OSError:
            pass
    return {"hostname": socket.gethostname().split(".")[0], "ips": ips, "port": port}


# ---- audio ----
def audio_outputs():
    """Playback devices for the setup/settings screens. HDMI ports show whether a display is
    attached; "System default" says where it currently goes."""
    if not os.path.exists("/proc/asound/pcm"):
        # dev machine: representative devices so the screens can be designed
        return [{"id": "default", "name": "System default", "kind": "default", "detail": "TV (HDMI) right now"},
                {"id": "plughw:CARD=HDMI,DEV=3", "name": "LG TV (HDMI)", "kind": "hdmi", "detail": "Connected"},
                {"id": "plughw:CARD=DAC,DEV=0", "name": "USB DAC", "kind": "usb", "detail": "demo device"}]
    devs = audio.devices()
    best = audio.best_default(devs)
    outs = [{"id": "default", "name": "System default", "kind": "default",
             "detail": ("Follows your TV or DAC · now %s" % audio.pretty_name(best)) if best else "No sound hardware found"}]
    for d in devs:
        if d["kind"] == "hdmi":
            detail = "Connected" if d["connected"] else ("Nothing attached" if d["connected"] is False else d["pcmName"])
        else:
            detail = d["pcmName"]
        outs.append({"id": d["id"], "name": audio.pretty_name(d), "kind": d["kind"], "detail": detail,
                     "connected": d["connected"]})
    from . import device
    outs += device.bt_audio_outputs()
    # connected HDMI first, then DACs, Bluetooth, the rest; unplugged HDMI ports last
    rank = {"default": 0, "usb": 2, "bluetooth": 2, "analog": 3}
    outs.sort(key=lambda o: rank.get(o["kind"], 1 if o.get("connected") else 4))
    return outs


def _chime_wav():
    """A short warm two-note chime, generated (no audio assets in the repo)."""
    rate, dur = 44100, 1.4
    path = os.path.join(tempfile.gettempdir(), "musicos-chime.wav")
    if os.path.exists(path):
        return path
    frames = bytearray()
    notes = [(0.0, 392.0), (0.18, 587.33)]  # G4 then D5
    for i in range(int(rate * dur)):
        t = i / rate
        v = 0.0
        for start, f in notes:
            if t >= start:
                tt = t - start
                env = min(1.0, tt / 0.01) * math.exp(-tt * 3.2)
                v += env * (math.sin(2 * math.pi * f * tt) + 0.25 * math.sin(4 * math.pi * f * tt))
        s = int(max(-1.0, min(1.0, v * 0.28)) * 32767)
        frames += struct.pack("<hh", s, s)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def play_test_sound(device):
    wav = _chime_wav()
    if sys.platform == "darwin":
        cmd = ["afplay", wav]
    else:
        cmd = ["aplay", "-q"] + ([] if device in ("", "default") else ["-D", device]) + [wav]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "playback failed").strip().splitlines()[-1])


# ---- music sources ----
def music_sources(root):
    """What is under the music root: local folder, USB drives, network shares."""
    out = []
    net = {"net-" + s["id"]: s for s in config.sources()}
    try:
        entries = sorted(os.listdir(root))
    except OSError:
        entries = []
    for name in entries:
        p = os.path.join(root, name)
        if not os.path.isdir(p) or name.startswith("."):
            continue
        if name.startswith("usb-"):
            kind, label = "usb", "USB drive \u00b7 " + name[4:]
        elif name.startswith("disk-"):
            kind, label = "disk", "Internal drive \u00b7 " + name[5:]
        elif name in net:
            kind, label = "network", net[name]["name"]
        elif name == "local":
            kind, label = "local", "This device"
        else:
            kind, label = "folder", name
        mounted = os.path.ismount(p) or kind in ("local", "folder")
        item = {"id": name, "kind": kind, "name": label, "mounted": mounted, "path": p}
        if mounted:
            try:
                du = shutil.disk_usage(p)
                item.update(total=du.total, free=du.free)
            except OSError:
                pass
        out.append(item)
    # plain artist folders directly under the root (a dev library, or files copied straight in)
    # are one source, not dozens
    folders = [s for s in out if s["kind"] == "folder"]
    if len(folders) > 2:
        out = [s for s in out if s["kind"] != "folder"]
        out.insert(0, {"id": ".", "kind": "folder", "name": "Music folder (%d artists)" % len(folders),
                       "mounted": True, "path": root})
    for key, s in net.items():
        if key not in entries:
            out.append({"id": key, "kind": "network", "name": s["name"], "mounted": False})
    return out


# ---- network (NetworkManager; the music user is allowed by a polkit rule) ----
def _nmcli(*args, timeout=15):
    r = subprocess.run(["nmcli"] + list(args), capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or "nmcli failed")
    return r.stdout


def _split_terse(line):
    """nmcli -t output: ':'-separated, with literal ':' escaped as '\\:'."""
    out, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def _has_nmcli():
    return shutil.which("nmcli") is not None


def network_status():
    """Wired + wireless state for the UI. Demo values on machines without NetworkManager."""
    if not _has_nmcli():
        return {"demo": True, "internet": True,
                "ethernet": {"present": True, "connected": True, "ip": (device_info(0)["ips"] or [""])[0]},
                "wifi": {"present": True, "connected": False, "ssid": "", "signal": 0, "ip": ""}}
    eth = {"present": False, "connected": False, "ip": ""}
    wifi = {"present": False, "connected": False, "ssid": "", "signal": 0, "ip": ""}
    for line in _nmcli("-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device").splitlines():
        dev, typ, state, conn = (_split_terse(line) + ["", "", "", ""])[:4]
        target = eth if typ == "ethernet" else wifi if typ == "wifi" else None
        if target is None:
            continue
        target["present"] = True
        if state.startswith("connected") and not target["connected"]:
            target["connected"] = True
            try:
                target["ip"] = _nmcli("-g", "IP4.ADDRESS", "device", "show", dev).split("/")[0].strip()
            except RuntimeError:
                pass
            if typ == "wifi":
                target["ssid"] = conn
    if wifi["connected"]:
        for net in wifi_scan(rescan=False):
            if net["active"]:
                wifi["signal"] = net["signal"]
    try:
        internet = _nmcli("networking", "connectivity").strip() == "full"
    except RuntimeError:
        internet = False
    return {"demo": False, "internet": internet, "ethernet": eth, "wifi": wifi}


def wifi_scan(rescan=True):
    if not _has_nmcli():
        return [{"ssid": "Homelab", "signal": 82, "secure": True, "active": False},
                {"ssid": "Homelab-5G", "signal": 64, "secure": True, "active": False},
                {"ssid": "Neighbours", "signal": 31, "secure": True, "active": False}]
    out = _nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list",
                 "--rescan", "yes" if rescan else "no", timeout=25)
    best = {}
    for line in out.splitlines():
        inuse, ssid, signal, sec = (_split_terse(line) + ["", "", "", ""])[:4]
        if not ssid:
            continue
        item = {"ssid": ssid, "signal": int(signal or 0), "secure": bool(sec and sec != "--"),
                "active": inuse == "*"}
        if ssid not in best or item["signal"] > best[ssid]["signal"] or item["active"]:
            best[ssid] = item
    return sorted(best.values(), key=lambda n: (not n["active"], -n["signal"]))


def wifi_connect(ssid, password=""):
    if any(c in ssid + password for c in "\n\r\0"):
        raise ValueError("invalid characters")
    if not _has_nmcli():
        return {"ok": True, "demo": True}
    args = ["device", "wifi", "connect", ssid]
    if password:
        args += ["password", password]
    _nmcli(*args, timeout=45)
    return {"ok": True}


def access_info(port):
    """How to reach this box from another computer (copying music in, remote control)."""
    info = device_info(port)
    ssh = os.path.exists("/usr/sbin/sshd") or sys.platform == "darwin"
    return {"hostname": info["hostname"], "mdns": info["hostname"] + ".local", "ips": info["ips"],
            "ssh": ssh, "user": "music", "dropFolder": "/srv/music/local",
            "remoteUrl": "http://%s:%d/phone" % (info["ips"][0], port) if info["ips"] else ""}
