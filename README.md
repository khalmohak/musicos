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
| `ui/` | 10-foot web UI, no build step, keyboard/remote focus navigation |
| `scripts/` | build-host setup, Proxmox deploy |
| `dev/` | MPD config for developing the UI on a Mac against the real library |

## 1. Develop the UI on your Mac (no Linux needed)

```sh
make dev          # fake library, open http://localhost:8080
```

Against the real library on the SMB share:

```sh
brew install mpd mpc
make dev-mpd      # first scan of the 8TB share takes a while; watch with `mpc stats`
```

Keys: arrows move, Enter opens/plays, Backspace/Esc goes back, Space play/pause,
N/P next/previous, +/- volume, U rescans the library.

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

## Debugging

| Symptom | Check |
|---|---|
| Black screen | `journalctl -u musicos-kiosk -b`. In a VM, uncomment `WLR_RENDERER=pixman` in `/etc/musicos/kiosk.env`, then `systemctl restart musicos-kiosk` |
| UI says can't reach player | `journalctl -u musicos-agent -u mpd -b`, `curl localhost:8080/api/status` |
| No sound | `aplay -l`, `mpc outputs`, `alsamixer`; in Proxmox the audio goes to the SPICE client |
| Artists missing | MPD lists by AlbumArtist tag; files tagged with Artist only need retagging (beets) |

## Roadmap

1. **Now:** image boots to UI in a Proxmox VM, plays the SMB library.
2. Real hardware (N100 mini PC or Pi 5): firmware packages, HDMI audio, HDMI-CEC remote (`cec-ctl`/`ir-keytable` → key events).
3. Appliance hardening: read-only root, A/B updates (systemd-sysupdate or RAUC), setup screen for Wi-Fi and shares.
4. Backend integration: browse Navidrome/Subsonic, send listens to the homelab listens DB, show recommendation playlists.
5. Optional: Buildroot port for a tiny, fast-booting image.
