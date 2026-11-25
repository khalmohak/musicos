"""Sound card discovery shared by the agent (listing outputs) and the root helper (routing).

HDMI is the tricky part: an HDMI "card" (GPU audio) has several playback devices (3, 7, 8, 9...),
one per port, and only the one whose port has a powered TV/receiver plays anything. ALSA exposes
that as "HDMI/DP,pcm=N Jack" controls, and the attached display's name in /proc/.../eld#*.
"""
import glob
import os
import re
import subprocess

JACK_RE = re.compile(r"name='HDMI/DP,pcm=(\d+) Jack'.*?: values=(on|off)", re.S)


def _read(path):
    try:
        with open(path) as fh:
            return fh.read()
    except OSError:
        return ""


def cards():
    """{index: {"id", "driver", "long"}} from /proc/asound/cards."""
    out = {}
    lines = _read("/proc/asound/cards").splitlines()
    for i, line in enumerate(lines):
        line = line.strip()
        if not line or not line[0].isdigit() or "[" not in line:
            continue
        idx = int(line.split()[0])
        cid = line.split("[", 1)[1].split("]", 1)[0].strip()
        driver = line.split("]:", 1)[1].split(" - ")[0].strip() if "]:" in line else ""
        long = lines[i + 1].strip() if i + 1 < len(lines) else ""
        out[idx] = {"id": cid, "driver": driver, "long": long}
    return out


def jacks(card):
    """{device: connected} for HDMI/DP outputs of one card (needs alsa-utils' amixer)."""
    try:
        txt = subprocess.run(["amixer", "-c", str(card), "contents"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    return {int(d): v == "on" for d, v in JACK_RE.findall(txt)}


def display_names(card):
    """Names of displays currently attached to this card's HDMI ports (from ELD)."""
    names = []
    for f in sorted(glob.glob("/proc/asound/card%d/eld#*" % card)):
        txt = _read(f)
        if re.search(r"monitor_present\s+1", txt):
            m = re.search(r"monitor_name\s+(.+)", txt)
            names.append(m.group(1).strip() if m else "")
    return names


def devices():
    """Every playback device, classified, with HDMI connection state where known."""
    cs = cards()
    jack_cache, out = {}, []
    for line in _read("/proc/asound/pcm").splitlines():
        # "01-00: Generic Analog : Generic Analog : playback 1 : capture 1"
        parts = [p.strip() for p in line.split(":")]
        if len(parts) < 4 or not any(p.startswith("playback") for p in parts[3:]):
            continue
        card, dev = (int(x) for x in parts[0].split("-"))
        info = cs.get(card, {"id": str(card), "driver": "", "long": ""})
        pcm_name = parts[1]
        hdmi = "hdmi" in pcm_name.lower() or "hdmi" in info["long"].lower() or pcm_name.upper().startswith("DP")
        if card not in jack_cache:
            jack_cache[card] = jacks(card)
        connected = jack_cache[card].get(dev) if hdmi else None
        if hdmi:
            kind = "hdmi"
        elif info["driver"] == "USB-Audio":
            kind = "usb"
        else:
            kind = "analog"
        out.append({"card": card, "cardId": info["id"], "dev": dev, "kind": kind, "pcmName": pcm_name,
                    "long": info["long"], "connected": connected,
                    "id": "plughw:CARD=%s,DEV=%d" % (info["id"], dev)})
    # name the connected HDMI port after the display, when the card has exactly one attached
    for card in {d["card"] for d in out if d["kind"] == "hdmi"}:
        names = display_names(card)
        live = [d for d in out if d["card"] == card and d["connected"]]
        if len(live) == 1 and len(names) == 1 and names[0]:
            live[0]["display"] = names[0]
    return out


def best_default(devs):
    """Where "System default" should play: a connected HDMI display, else a USB DAC, else
    analog out, else the first HDMI port. None if there is no sound hardware at all."""
    for test in (lambda d: d["kind"] == "hdmi" and d["connected"],
                 lambda d: d["kind"] == "usb",
                 lambda d: d["kind"] == "analog",
                 lambda d: True):
        for d in devs:
            if test(d):
                return d
    return None


def unmute(card):
    """HDMI/S-PDIF outputs often boot muted (IEC958 switches); open them and the main volume."""
    try:
        txt = subprocess.run(["amixer", "-c", str(card), "scontrols"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return
    for m in re.finditer(r"Simple mixer control '([^']+)',(\d+)", txt):
        name, idx = m.group(1), m.group(2)
        ctl = "%s,%s" % (name, idx)
        if "IEC958" in name or name in ("Master", "PCM", "Speaker", "Headphone", "Front"):
            args = ["amixer", "-q", "-c", str(card), "sset", ctl, "unmute"]
            if "IEC958" not in name:
                args.insert(-1, "100%")
            subprocess.run(args, capture_output=True, timeout=5)


def asound_conf(dev):
    """/etc/asound.conf: everything that says "default" mixes (dmix) into the chosen device, so
    interface sounds and music can share it. Bit-perfect mode bypasses this (MPD uses hw:)."""
    return (
        "# written by musicos-apply: default output = %s\n"
        "pcm.musicos_mix {\n"
        "    type dmix\n"
        "    ipc_key 4242\n"
        "    ipc_perm 0666\n"
        "    slave { pcm \"hw:CARD=%s,DEV=%d\" rate 48000 }\n"
        "}\n"
        "pcm.!default { type plug slave.pcm \"musicos_mix\" }\n"
        "ctl.!default { type hw card %s }\n"
    ) % (dev["id"], dev["cardId"], dev["dev"], dev["cardId"])


def pretty_name(d):
    if d["kind"] == "hdmi":
        base = d.get("display") or "TV / receiver"
        return "%s (HDMI)" % base
    if d["kind"] == "usb":
        return d["long"].split(" at ")[0] or "USB DAC"
    return "%s (analog)" % d["cardId"]


if __name__ == "__main__":  # quick check on a device: python3 -m musicos_agent.audio
    ds = devices()
    for d in ds:
        print(d)
    print("default ->", best_default(ds))
    if os.path.exists("/etc/asound.conf"):
        print(_read("/etc/asound.conf"))
