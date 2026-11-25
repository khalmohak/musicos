# musicos

A minimal Linux appliance that boots straight into a TV-friendly music player.

```
musicos device (TV)                               homelab (Proxmox)
┌──────────────────────────────────┐             ┌─────────────────────────────┐
│ cage (kiosk compositor, tty1)    │             │ 8TB SMB library             │
│  └─ cog / WPE WebKit → ui/       │             │ later: Navidrome, listens   │
│ musicos-agent :8080 (HTTP API)   │◄── SMB ────►│ DB, recommendation engine   │
│ MPD :6600 → ALSA → HDMI / DAC    │             └─────────────────────────────┘
│ /srv/music (local, USB, SMB)     │
└──────────────────────────────────┘
```

| Piece | What it is |
|---|---|
| `image/` | mkosi config: Debian trixie disk image, systemd-boot, boots to `graphical.target` → kiosk |
| `agent/` | `musicos-agent`, stdlib-only Python HTTP API over MPD, also serves the UI |
| `ui/` | 10-foot TV UI: React + Glyph + Lucide (Vite). Scales with the screen, 1080p to 4K |
| `scripts/` | build-host setup, Proxmox deploy and test, USB fetch/flash |
| `dev/` | MPD config for developing the UI on a Mac against the real library |

## 1. Develop the UI on your Mac (no Linux needed)

```sh
make dev-library  # real covers from /Volumes/8TB/... , simulated playback -> http://localhost:8080
make dev          # tiny fake library
make ui-dev       # hot reload on :5173 (run one of the above alongside for the API)
```

Keys: arrows move, Enter opens/plays, Backspace/Esc goes back, Space play/pause,
N/B next/previous, +/- volume, M now playing. `?debug&go=home|settings|playing|album:12`
jumps straight to a screen.

## 2. Set up a build host on Proxmox (once)

Create a Debian 13 (trixie) x86-64 VM: 2+ vCPU, 4 GB RAM, 30 GB disk. An unprivileged
LXC won't work because mkosi needs root and loop/mount access; use a VM.

```sh
git clone <this repo> && cd musicos
sudo ./scripts/setup-build-host.sh
```

## 3. Build and test the image

```sh
make image        # -> out/musicos.raw  (first build downloads ~1 GB of packages)
make vm           # boot it in QEMU on the build host (needs a display or use -nographic serial)
```

## 4. Run it as a Proxmox VM

From the build host (with SSH key access to the Proxmox node):

```sh
PVE_HOST=root@<proxmox-ip> make deploy     # VMID 9100 by default; override VMID=...
```

The script refuses to overwrite a VM with that ID unless it's named `musicos`.
Open the VM console in the Proxmox web UI. Use SPICE (virt-viewer) to hear audio,
since noVNC carries video only.

Dev logins (change before real use): `root` / `musicos`, `music` / `music`. SSH is on.

### Point it at the library

```sh
ssh music@<vm-ip>
sudo -i
cp /etc/systemd/system/srv-music.mount.example    /etc/systemd/system/srv-music.mount
cp /etc/systemd/system/srv-music.automount.example /etc/systemd/system/srv-music.automount
printf 'username=...\npassword=...\n' > /etc/musicos/smb-credentials && chmod 600 /etc/musicos/smb-credentials
systemctl daemon-reload && systemctl enable --now srv-music.automount
mpc update
```

## 5. Boot it on a real machine from USB

The image is a complete, bootable disk: write it to a USB stick and the machine runs musicos
from the stick ("live"); settings and copied music persist on it. On first boot the system
grows to fill the whole stick.

```sh
make fetch                 # latest build -> out/musicos.img.gz (~0.8 GB)
./scripts/flash-usb.sh     # lists USB disks
make usb DISK=disk4        # macOS (Linux: DISK=sdb). Asks you to type the disk name, then sudo
```

balenaEtcher works too: open `out/musicos.img.gz`, pick the stick, flash.

On the target machine:
1. Plug the stick into a USB 3 port, connect the TV/monitor over HDMI or DisplayPort.
2. Boot menu key at power-on (usually F12, F11, F8 or Esc) → pick the USB stick (the UEFI entry).
3. If it refuses to boot: firmware setup → **disable Secure Boot** (the image is unsigned) and
   make sure UEFI boot is on (CSM/legacy off).

It boots to the musicos splash, then setup. 4K works out of the box: the UI and covers scale
with the screen. Firmware for Intel/AMD/NVIDIA (nouveau) graphics, Intel/Realtek Wi-Fi and NICs,
and Intel SOF audio is included.

## Disk layout and updates (A/B)

```
ESP 512M      systemd-boot + one UKI per installed version (musicos_<version>.efi, boot-counted)
/usr  slot A  erofs, read-only, dm-verity  (the whole OS)      + verity hash partition
/usr  slot B  empty until the first update                     + verity hash partition
root          ext4, writable: /etc, /var, /srv/music/local, /home  (grows to fill the disk)
```

Each UKI carries `usrhash=` for its own `/usr`, so choosing a boot entry chooses the slot. Updates
(systemd-sysupdate, `/usr/lib/sysupdate.d`) write the inactive slot plus a new UKI with 3 tries;
if it never reaches `boot-complete.target`, systemd-boot falls back to the previous version.
Settings, Wi-Fi, Bluetooth pairings, local music and play state live on root and are untouched.
Logs are kept in RAM (`Storage=volatile`).

Everything musicos ships lives under `/usr` (units in `/usr/lib/systemd/system`, rules in
`/usr/lib/udev/rules.d` and `/usr/share/polkit-1/rules.d`, agent in `/usr/lib/musicos`, UI in
`/usr/share/musicos/ui`), so it updates with the slot. Don't add files under `image/mkosi.extra/etc`.

Publishing an update (after a build):

```sh
./scripts/publish-update.sh        # ~/musicos-updates on the build VM, served on :8090
```

On the box: Settings → About → Software update → set the address (`http://<build-vm>:8090`) →
Check → Install → Restart. Or copy `~/musicos-updates` to a USB drive as `musicos-update/`.
`scripts/vm-update-test.sh` runs the whole flow against the test VM.

## AirPlay and Spotify Connect

AirPlay (shairport-sync, Debian) is built in. Spotify Connect needs librespot, which Debian
doesn't package; `scripts/fetch-spotify.sh` pulls Raspotify's pinned, checksummed amd64 build
into `image/mkosi.packages/` (opt-in). Both play through ALSA `default`, pause local playback
when a phone starts streaming, and show the track on the TV. Settings → AirPlay & Spotify.

## Automated test loop (Proxmox)

`make test` (or `./scripts/pve-test.sh`) runs from your workstation: rsync the repo to the
build VM, build the image, have Proxmox pull it and recreate the test VM, then check through
the QEMU guest agent that mpd, the agent and the kiosk are up without restart loops, hit the
API over the LAN, and save a screenshot to `out/test/screen.png`. Copy `.pipeline.env.example`
to `.pipeline.env` first. `SKIP_BUILD=1` redeploys the last build, `VGA_RES=3840x2160`
renders the VM at 4K, `DISK_SIZE=12G` checks first-boot root growth.

## Debugging

| Symptom | Check |
|---|---|
| Black screen | `journalctl -u musicos-kiosk -b`. In a VM, uncomment `WLR_RENDERER=pixman` in `/etc/musicos/kiosk.env`, then `systemctl restart musicos-kiosk` |
| UI says can't reach player | `journalctl -u musicos-agent -u mpd -b`, `curl localhost:8080/api/status` |
| No sound | `aplay -l`, `mpc outputs`, `alsamixer`; in Proxmox the audio goes to the SPICE client |
| Artists missing | MPD lists by AlbumArtist tag; files tagged with Artist only need retagging (beets) |

## Roadmap

1. **Now:** boots to the UI in a Proxmox VM and from USB on real x86 hardware.
2. Real hardware polish: HDMI-CEC/IR remote key maps, HDMI audio passthrough, refresh-rate choice.
3. Appliance hardening: read-only root, A/B updates (systemd-sysupdate or RAUC), setup screen for Wi-Fi and shares.
4. Backend integration: browse Navidrome/Subsonic, send listens to the homelab listens DB, show recommendation playlists.
5. Optional: Buildroot port for a tiny, fast-booting image.
