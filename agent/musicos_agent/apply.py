"""Root helper: turn the agent's settings into system state.

Run by musicos-apply.service whenever /var/lib/musicos/apply-request changes
(musicos-apply.path). It only reads files the agent wrote and validates them;
it never takes commands from the network directly.

- network shares in sources.json  -> /etc/systemd/system/srv-music-net-<id>.{mount,automount}
- audioDevice / bitPerfect        -> /var/lib/musicos/mpd-output.conf (included by mpd.conf), mpd restart
"""
import os
import re
import shutil
import subprocess

from . import config

UNIT_DIR = "/etc/systemd/system"
CRED_DIR = "/etc/musicos/creds"
MUSIC_ROOT = "/srv/music"
SAFE_ID = re.compile(r"^[a-z0-9-]{1,24}$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9.\-:]+$")
SAFE_PATH = re.compile(r"^[^\n\r\0\"]*$")
SAFE_DEVICE = re.compile(r"^(default|(plug)?hw:CARD=[A-Za-z0-9_]+,DEV=\d+)$")


def sh(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def write(path, text, mode=0o644):
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    os.replace(tmp, path)


def apply_mounts():
    os.makedirs(CRED_DIR, mode=0o700, exist_ok=True)
    wanted = set()
    for s in config.sources():
        sid = s.get("id", "")
        if s.get("type") != "smb" or not SAFE_ID.match(sid) or not SAFE_HOST.match(s.get("server", "")) \
                or not SAFE_PATH.match(s.get("share", "") + s.get("path", "")):
            print("skipping invalid source %r" % sid)
            continue
        wanted.add(sid)
        # unit name for /srv/music/net-<id>: "/" -> "-", "-" -> "\x2d" (ids are [a-z0-9-])
        unit = "srv-music-" + ("net-" + sid).replace("-", "\\x2d")
        where = os.path.join(MUSIC_ROOT, "net-" + sid)
        what = "//%s/%s" % (s["server"], s["share"]) + ("/" + s["path"] if s.get("path") else "")
        src = os.path.join(config.state_dir(), "secrets", sid + ".cred")
        cred = os.path.join(CRED_DIR, sid)
        if os.path.exists(src):
            shutil.copyfile(src, cred)
            os.chmod(cred, 0o600)
        write(os.path.join(UNIT_DIR, unit + ".mount"), (
            "[Unit]\nDescription=musicos network share %s\nAfter=network-online.target\n"
            "Wants=network-online.target\n\n[Mount]\nWhat=%s\nWhere=%s\nType=cifs\n"
            "Options=ro,credentials=%s,iocharset=utf8,uid=mpd,gid=audio,file_mode=0644,dir_mode=0755,_netdev\n"
            "TimeoutSec=30\n") % (s.get("name", sid), what.replace(" ", "\\040"), where, cred))
        write(os.path.join(UNIT_DIR, unit + ".automount"), (
            "[Unit]\nDescription=musicos network share %s (automount)\n\n[Automount]\nWhere=%s\n"
            "TimeoutIdleSec=0\n\n[Install]\nWantedBy=multi-user.target\n") % (s.get("name", sid), where))
    # remove shares that were deleted
    for name in os.listdir(UNIT_DIR):
        if name.startswith("srv-music-net\\x2d") and name.endswith(".automount"):
            sid = name[len("srv-music-net\\x2d"):-len(".automount")].replace("\\x2d", "-")
            if sid not in wanted:
                base = name[:-len(".automount")]
                sh("systemctl", "disable", "--now", base + ".automount")
                sh("systemctl", "stop", base + ".mount")
                for ext in (".automount", ".mount"):
                    try:
                        os.remove(os.path.join(UNIT_DIR, base + ext))
                    except OSError:
                        pass
                try:
                    os.remove(os.path.join(CRED_DIR, sid))
                except OSError:
                    pass
    sh("systemctl", "daemon-reload")
    for sid in wanted:
        base = "srv-music-" + ("net-" + sid).replace("-", "\\x2d")
        os.makedirs(os.path.join(MUSIC_ROOT, "net-" + sid), exist_ok=True)
        sh("systemctl", "enable", base + ".automount")
        sh("systemctl", "start", "--no-block", base + ".automount")


def playback_cards():
    """[(index, id)] of sound cards that can play, from /proc/asound."""
    cards, ids = [], {}
    try:
        for line in open("/proc/asound/cards"):
            line = line.strip()
            if line and line[0].isdigit() and "[" in line:
                ids[line.split()[0]] = line.split("[", 1)[1].split("]", 1)[0].strip()
        for line in open("/proc/asound/pcm"):
            if "playback" in line:
                idx = str(int(line.split("-", 1)[0]))
                if (idx, ids.get(idx, idx)) not in cards:
                    cards.append((idx, ids.get(idx, idx)))
    except OSError:
        pass
    return cards


def apply_alsa_default(device):
    """Point ALSA's "default" at the chosen card (or the first real one): card 0 isn't always it.
    Interface sounds and "System default" both go through this. Returns True if it changed."""
    cards = playback_cards()
    if not cards:
        return False
    want = None
    m = re.search(r"CARD=([A-Za-z0-9_]+)", device)
    if m:
        want = next((i for i, cid in cards if cid == m.group(1)), None)
    idx = want or cards[0][0]
    text = "# written by musicos-apply\ndefaults.pcm.card %s\ndefaults.ctl.card %s\n" % (idx, idx)
    old = open("/etc/asound.conf").read() if os.path.exists("/etc/asound.conf") else ""
    if text == old:
        return False
    write("/etc/asound.conf", text)
    return True


def apply_audio():
    cfg = config.load()
    device = cfg.get("audioDevice") or "default"
    if not SAFE_DEVICE.match(device):
        print("invalid audio device %r, using default" % device)
        device = "default"
    lines = ['audio_output {', '    type        "alsa"', '    name        "musicos"',
             '    device      "%s"' % device]
    if cfg.get("bitPerfect") and device != "default":
        # straight to the DAC: no software volume, no resampling, no format conversion
        lines += ['    mixer_type  "none"', '    auto_resample "no"', '    auto_channels "no"',
                  '    auto_format "no"', '    dop "yes"']
    else:
        lines += ['    mixer_type  "software"']
    lines.append("}")
    path = os.path.join(config.state_dir(), "mpd-output.conf")
    new = "\n".join(lines) + "\n"
    old = open(path).read() if os.path.exists(path) else ""
    alsa = apply_alsa_default(device)
    if new != old or alsa:
        write(path, new)
        # --no-block: at boot this unit runs Before=mpd, so waiting here would deadlock
        sh("systemctl", "try-restart", "--no-block", "mpd")


def main():
    apply_audio()
    apply_mounts()
    # rescan so new shares show up, but only if MPD is already up: at boot MPD waits for us,
    # and its socket activation would make `mpc` wait for MPD -> 30 s deadlock
    if sh("systemctl", "is-active", "--quiet", "mpd").returncode == 0:
        sh("mpc", "-q", "update")


if __name__ == "__main__":
    main()
