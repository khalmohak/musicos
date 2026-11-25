"""Device controls for the UI: power, time zone, display mode, Bluetooth, saved Wi-Fi networks.

The agent runs as the unprivileged "music" user. The few privileged actions (power off, time
zone, NetworkManager) are allowed for that user by polkit rules in the image
(/etc/polkit-1/rules.d/50-musicos-*.rules); nothing here uses sudo.
"""
import glob
import os
import re
import shutil
import subprocess
import sys

DEV = not sys.platform.startswith("linux")  # on a Mac: return demo data, change nothing


def run(*cmd, timeout=15):
    r = subprocess.run(list(cmd), capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else "%s failed" % cmd[0])
    return r.stdout


# ---------------------------------------------------------------- power
def power(action):
    """shutdown | reboot | sleep | tv-off"""
    if action == "tv-off":
        helper = "/usr/local/lib/musicos/cec"
        if os.path.exists(helper):
            subprocess.Popen([helper, "standby"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return
    verb = {"shutdown": "poweroff", "reboot": "reboot", "sleep": "suspend"}.get(action)
    if not verb:
        raise ValueError("unknown power action")
    if DEV:
        print("(dev) would run systemctl %s" % verb, flush=True)
        return
    if action == "sleep" and os.path.exists("/usr/local/lib/musicos/cec"):
        subprocess.run(["/usr/local/lib/musicos/cec", "standby"], timeout=5, capture_output=True)
    # --no-block: answer the HTTP request before the system goes down
    run("systemctl", verb, "--no-block", "--no-ask-password")


# ---------------------------------------------------------------- time zone
def timezones():
    try:
        zones = run("timedatectl", "list-timezones").split()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        zones = sorted(os.path.relpath(p, "/usr/share/zoneinfo") for p in glob.glob("/usr/share/zoneinfo/*/*")
                       if os.path.isfile(p) and "/posix/" not in p and "/right/" not in p)
    current = ""
    try:
        current = run("timedatectl", "show", "-p", "Timezone", "--value").strip()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        try:
            current = os.path.realpath("/etc/localtime").split("zoneinfo/", 1)[1]
        except IndexError:
            pass
    regions = {}
    for z in zones:
        if "/" in z:
            region, city = z.split("/", 1)
            if region in ("Etc", "SystemV", "US", "Brazil", "Canada", "Chile", "Mexico"):
                continue
            regions.setdefault(region, []).append(city)
    return {"current": current, "regions": regions}


def set_timezone(zone):
    if not re.match(r"^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$", zone or ""):
        raise ValueError("invalid time zone")
    if DEV:
        return
    run("timedatectl", "set-timezone", zone)


# ---------------------------------------------------------------- display (cage + wlr-randr)
def _wl_env():
    env = dict(os.environ)
    uid = os.getuid()
    env.setdefault("XDG_RUNTIME_DIR", "/run/user/%d" % uid)
    socks = sorted(glob.glob(os.path.join(env["XDG_RUNTIME_DIR"], "wayland-*[0-9]")))
    if socks:
        env["WAYLAND_DISPLAY"] = os.path.basename(socks[0])
    return env


def display_modes():
    """Connected outputs and the modes the TV/monitor offers."""
    if DEV or not shutil.which("wlr-randr"):
        return {"outputs": [{"name": "HDMI-A-1", "current": "3840x2160@60", "modes": [
            "3840x2160@60", "3840x2160@30", "2560x1440@60", "1920x1080@60", "1920x1080@50", "1920x1080@24"]}], "demo": True}
    r = subprocess.run(["wlr-randr"], capture_output=True, text=True, env=_wl_env(), timeout=10)
    outputs, cur = [], None
    for line in r.stdout.splitlines():
        if line and not line.startswith(" "):
            cur = {"name": line.split()[0], "current": "", "modes": []}
            outputs.append(cur)
        m = re.match(r"\s+(\d+)x(\d+) px, ([\d.]+) Hz(.*)", line)
        if m and cur is not None:
            mode = "%sx%s@%d" % (m.group(1), m.group(2), round(float(m.group(3))))
            if mode not in cur["modes"]:
                cur["modes"].append(mode)
            if "current" in m.group(4):
                cur["current"] = mode
    return {"outputs": outputs, "demo": False}


def set_display_mode(output, mode):
    """Apply now (wlr-randr); the choice is saved in config and re-applied by musicos-session."""
    if not re.match(r"^[A-Za-z0-9-]+$", output or "") or not re.match(r"^\d+x\d+@\d+$", mode or ""):
        raise ValueError("invalid mode")
    if DEV or not shutil.which("wlr-randr"):
        return
    res, hz = mode.split("@")
    r = subprocess.run(["wlr-randr", "--output", output, "--mode", "%s@%sHz" % (res, hz)],
                       capture_output=True, text=True, env=_wl_env(), timeout=10)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or "mode change failed").strip())


# ---------------------------------------------------------------- Bluetooth (bluez via bluetoothctl)
MAC_RE = re.compile(r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")


def _bt_kind(info):
    icon = re.search(r"Icon: (\S+)", info)
    icon = icon.group(1) if icon else ""
    uuids = info
    if "input-gaming" in icon:
        return "controller"
    if "input-keyboard" in icon or "input-mouse" in icon:
        return "keyboard"
    if "audio" in icon or "Audio Sink" in uuids or "headset" in icon or "headphone" in icon:
        return "audio"
    if "phone" in icon:
        return "phone"
    return "other"


def bt_devices():
    if DEV or not shutil.which("bluetoothctl"):
        return {"available": True, "powered": True, "demo": True, "devices": [
            {"mac": "AA:BB:CC:00:11:22", "name": "Xbox Wireless Controller", "kind": "controller", "paired": True, "connected": True},
            {"mac": "AA:BB:CC:00:11:33", "name": "WH-1000XM5", "kind": "audio", "paired": True, "connected": False},
            {"mac": "AA:BB:CC:00:11:44", "name": "8BitDo Pro 2", "kind": "controller", "paired": False, "connected": False}]}
    try:
        show = run("bluetoothctl", "show", timeout=5)
    except (RuntimeError, subprocess.SubprocessError):
        return {"available": False, "powered": False, "devices": []}
    if "Controller" not in show:
        return {"available": False, "powered": False, "devices": []}
    powered = "Powered: yes" in show
    devs = []
    for line in run("bluetoothctl", "devices", timeout=5).splitlines():
        m = re.match(r"Device (\S+) (.+)", line)
        if not m or not MAC_RE.match(m.group(1)):
            continue
        info = run("bluetoothctl", "info", m.group(1), timeout=5)
        name = m.group(2)
        if re.fullmatch(r"([0-9A-F]{2}-){5}[0-9A-F]{2}", name):
            continue  # nameless beacons
        devs.append({"mac": m.group(1), "name": name, "kind": _bt_kind(info),
                     "paired": "Paired: yes" in info, "connected": "Connected: yes" in info})
    devs.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"].casefold()))
    return {"available": True, "powered": powered, "devices": devs}


def bt_scan(seconds=15):
    """Discover nearby devices for a while (runs in the background)."""
    if DEV or not shutil.which("bluetoothctl"):
        return
    subprocess.run(["bluetoothctl", "power", "on"], capture_output=True, timeout=5)
    subprocess.Popen(["bluetoothctl", "--timeout", str(int(seconds)), "scan", "on"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def bt_pair(mac):
    if not MAC_RE.match(mac or ""):
        raise ValueError("invalid address")
    if DEV:
        return
    # controllers, keyboards and headphones pair with "just works"; trust = reconnect automatically
    for args, t in ((["pair", mac], 30), (["trust", mac], 5), (["connect", mac], 20)):
        r = subprocess.run(["bluetoothctl", "--agent", "NoInputNoOutput"] + args, capture_output=True, text=True, timeout=t)
        out = r.stdout + r.stderr
        if r.returncode != 0 and "AlreadyExists" not in out and "already" not in out.lower():
            raise RuntimeError(out.strip().splitlines()[-1] if out.strip() else "%s failed" % args[0])


def bt_forget(mac):
    if not MAC_RE.match(mac or ""):
        raise ValueError("invalid address")
    if not DEV:
        run("bluetoothctl", "remove", mac, timeout=10)


def bt_audio_outputs():
    """Connected Bluetooth speakers/headphones, as ALSA (bluez-alsa) output devices."""
    if DEV:
        return []
    try:
        state = bt_devices()
    except Exception:
        return []
    return [{"id": "bluealsa:DEV=%s,PROFILE=a2dp" % d["mac"], "name": d["name"], "kind": "bluetooth",
             "detail": "Bluetooth" + (" · connected" if d["connected"] else ""), "connected": d["connected"]}
            for d in state["devices"] if d["kind"] == "audio" and d["paired"]]


# ---------------------------------------------------------------- saved Wi-Fi networks
def wifi_saved():
    if DEV or not shutil.which("nmcli"):
        return [{"name": "Homelab", "active": True, "method": "auto"}]
    out = []
    for line in run("nmcli", "-t", "-f", "NAME,TYPE,ACTIVE", "connection", "show").splitlines():
        parts = re.split(r"(?<!\\):", line)
        if len(parts) >= 3 and parts[1] == "802-11-wireless":
            name = parts[0].replace("\\:", ":")
            method = run("nmcli", "-g", "ipv4.method", "connection", "show", name).strip()
            out.append({"name": name, "active": parts[2] == "yes", "method": method})
    return out


def wifi_forget(name):
    if DEV:
        return
    run("nmcli", "connection", "delete", "id", name)


def wifi_hidden(ssid, password):
    if any(c in ssid + password for c in "\n\r\0"):
        raise ValueError("invalid characters")
    if DEV:
        return
    args = ["nmcli", "device", "wifi", "connect", ssid, "hidden", "yes"]
    if password:
        args += ["password", password]
    run(*args, timeout=45)


IP_RE = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


def set_ipv4(connection, method, address="", prefix=24, gateway="", dns=""):
    """method 'auto' (DHCP) or 'manual' with address/prefix/gateway/dns."""
    if method not in ("auto", "manual"):
        raise ValueError("invalid method")
    if method == "manual" and not (IP_RE.match(address) and IP_RE.match(gateway) and (not dns or IP_RE.match(dns))):
        raise ValueError("invalid address")
    if DEV:
        return
    if method == "auto":
        run("nmcli", "connection", "modify", connection, "ipv4.method", "auto", "ipv4.addresses", "",
            "ipv4.gateway", "", "ipv4.dns", "")
    else:
        run("nmcli", "connection", "modify", connection, "ipv4.method", "manual",
            "ipv4.addresses", "%s/%d" % (address, int(prefix)), "ipv4.gateway", gateway, "ipv4.dns", dns or gateway)
    run("nmcli", "connection", "up", connection, timeout=30)


def active_connections():
    """Names of active Ethernet/Wi-Fi connections (for the static IP editor)."""
    if DEV or not shutil.which("nmcli"):
        return [{"name": "Wired connection 1", "type": "ethernet", "method": "auto"}]
    out = []
    for line in run("nmcli", "-t", "-f", "NAME,TYPE", "connection", "show", "--active").splitlines():
        parts = re.split(r"(?<!\\):", line)
        if len(parts) >= 2 and parts[1] in ("802-3-ethernet", "802-11-wireless"):
            name = parts[0].replace("\\:", ":")
            method = run("nmcli", "-g", "ipv4.method", "connection", "show", name).strip()
            out.append({"name": name, "type": "ethernet" if parts[1] == "802-3-ethernet" else "wifi", "method": method})
    return out
