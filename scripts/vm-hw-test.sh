#!/usr/bin/env bash
# Hardware-ish tests against the running test VM (after scripts/pve-test.sh):
#   1. hot-plug a virtual USB stick (exFAT, real albums) -> auto-mount -> library scan
#   2. a virtual game controller drives the UI (d-pad, A, Y)
#   3. audio routing (/etc/asound.conf) and the diagnostics report on the boot partition
# Screenshots land in out/test/hw-*.png.
#
# Test albums: put Artist/Album folders in $PVE_HOST:/var/tmp/musicos-testlib first.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?set PVE_HOST}"
VMID="${VMID:-9101}"
OUT=out/test
mkdir -p "$OUT"

pve() { ssh -o BatchMode=yes "$PVE_HOST" "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
shot() {
    pve "qm monitor $VMID <<< 'screendump /var/tmp/musicos-hw.ppm' >/dev/null"
    scp -q "$PVE_HOST:/var/tmp/musicos-hw.ppm" "$OUT/hw-$1.ppm"
    python3 scripts/ppm2png.py "$OUT/hw-$1.ppm" "$OUT/hw-$1.png" >/dev/null && rm -f "$OUT/hw-$1.ppm"
    echo "   screenshot $OUT/hw-$1.png"
}
# run a shell command inside the VM via the guest agent, print its output
g() {
    pve "qm guest exec $VMID --timeout ${2:-60} -- sh -c $(printf '%q' "$1")" \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("out-data","")+d.get("err-data","")).rstrip())'
}

# wait for a real restart: guest agent gone, then back with a fresh uptime
wait_reboot() {
    for i in $(seq 1 40); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 || break; sleep 1; done
    for i in $(seq 1 100); do
        if pve "qm guest cmd $VMID ping" >/dev/null 2>&1; then
            up=$(g "cut -d. -f1 /proc/uptime" 2>/dev/null || true)
            [ -n "$up" ] && [ "$up" -lt 300 ] && { echo "   back up (uptime ${up}s)"; return 0; }
        fi
        sleep 3
    done
    echo "   did not come back"; return 1
}

step "1. USB stick: build exFAT image with test albums, hot-plug it"
pve 'set -e
img=/var/tmp/musicos-usb.raw
rm -f $img; truncate -s 1500M $img
mkfs.exfat -q -L MUSICUSB $img >/dev/null
mnt=$(mktemp -d); mount -o loop $img $mnt
cp -r /var/tmp/musicos-testlib/. $mnt/
du -sh $mnt | cut -f1; umount $mnt; rmdir $mnt'
pve "qm monitor $VMID <<'EOF' >/dev/null
drive_add 0 if=none,id=usbstick,file=/var/tmp/musicos-usb.raw,format=raw
device_add usb-storage,id=usbstick0,drive=usbstick
EOF"
sleep 15
g "journalctl -b --no-pager -u 'musicos-automount@*' | tail -4; ls /srv/music; ls /srv/music/usb-MUSICUSB 2>&1 | head"
sleep 20  # agent notices the new source and asks MPD to rescan
g "mpc stats | head -3"

step "2. finish setup, reload the UI on the wall"
g "python3 -c \"import urllib.request as u; u.urlopen(u.Request('http://127.0.0.1:8080/api/config', b'{\\\"name\\\":\\\"Mohak\\\",\\\"setupComplete\\\":true}', {'Content-Type':'application/json'}))\"; systemctl restart musicos-kiosk"
sleep 25
shot wall

step "3. virtual game controller: right, right, A (open album), A (play), Y (lyrics)"
g "cat > /tmp/pad.py <<'EOF'
import time
from evdev import UInput, AbsInfo, ecodes as e
cap = {e.EV_KEY: [e.BTN_SOUTH, e.BTN_EAST, e.BTN_NORTH, e.BTN_WEST, e.BTN_START, e.BTN_SELECT, e.BTN_MODE, e.BTN_TL, e.BTN_TR],
       e.EV_ABS: [(e.ABS_X, AbsInfo(0, -32768, 32767, 16, 128, 0)), (e.ABS_Y, AbsInfo(0, -32768, 32767, 16, 128, 0)),
                  (e.ABS_HAT0X, AbsInfo(0, -1, 1, 0, 0, 0)), (e.ABS_HAT0Y, AbsInfo(0, -1, 1, 0, 0, 0))]}
pad = UInput(cap, name='Test Xbox Controller', vendor=0x045e, product=0x028e)
time.sleep(4)  # musicos-input rescans every 2 s
def hat(axis, v):
    pad.write(e.EV_ABS, axis, v); pad.syn(); time.sleep(0.12); pad.write(e.EV_ABS, axis, 0); pad.syn(); time.sleep(0.5)
def btn(b):
    pad.write(e.EV_KEY, b, 1); pad.syn(); time.sleep(0.1); pad.write(e.EV_KEY, b, 0); pad.syn(); time.sleep(1.5)
import sys
for step in sys.argv[1:]:
    {'right': lambda: hat(e.ABS_HAT0X, 1), 'left': lambda: hat(e.ABS_HAT0X, -1),
     'down': lambda: hat(e.ABS_HAT0Y, 1), 'up': lambda: hat(e.ABS_HAT0Y, -1),
     'A': lambda: btn(e.BTN_SOUTH), 'B': lambda: btn(e.BTN_EAST), 'Y': lambda: btn(e.BTN_NORTH)}[step]()
time.sleep(1)
EOF
python3 /tmp/pad.py right A; journalctl -b -u musicos-input --no-pager | tail -3"
sleep 3
shot album
g "python3 /tmp/pad.py A" 90
sleep 6
shot playing
g "python3 /tmp/pad.py Y" 90
sleep 8
shot lyrics
g "python3 -c \"import urllib.request as u; print(u.urlopen('http://127.0.0.1:8080/api/status').read()[:300])\""

step "4. audio routing and diagnostics report"
g "systemctl start musicos-apply.service; cat /etc/asound.conf; PYTHONPATH=/usr/lib/musicos/agent python3 -m musicos_agent.audio | tail -3; aplay -q -D default /usr/share/sounds/alsa/Front_Center.wav && echo 'default device plays OK'"
g "systemctl start musicos-report.service; ls -la \$(bootctl --print-esp-path 2>/dev/null || echo /boot)/musicos-report.txt; grep -c '' /var/lib/musicos/report.txt" 120

step "5. device controls through the UI's API (display, time zone, Bluetooth, power)"
g "cat > /tmp/api.py <<'PY'
import json, sys, urllib.request as u
def call(path, body=None):
    req = u.Request('http://127.0.0.1:8080' + path, json.dumps(body).encode() if body is not None else None, {'Content-Type': 'application/json'})
    try:
        return json.loads(u.urlopen(req, timeout=60).read())
    except Exception as e:
        return {'error': getattr(e, 'read', lambda: str(e).encode())().decode()[:200]}
print('display  ', json.dumps(call('/api/display'))[:300])
print('bluetooth', call('/api/bluetooth'))
tz = call('/api/timezones'); print('timezone ', tz.get('current'), len(tz.get('regions', {})), 'regions')
print('set tz   ', call('/api/timezone', {'zone': 'Europe/London'}))
print('tz now   ', call('/api/timezones').get('current'))
print('set back ', call('/api/timezone', {'zone': tz.get('current') or 'Asia/Kolkata'}))
print('outputs  ', [(o['name'], o['detail']) for o in call('/api/audio/outputs')])
print('saved wifi', call('/api/wifi/saved'), 'conns', call('/api/connections'))
PY
python3 /tmp/api.py" 120
echo "   power: asking the UI's API to restart the VM (tests the polkit rule)"
g "python3 -c \"import urllib.request as u; print(u.urlopen(u.Request('http://127.0.0.1:8080/api/power', b'{\\\"action\\\":\\\"reboot\\\"}', {'Content-Type':'application/json'})).read())\""
wait_reboot
sleep 10
g "uptime; systemctl is-active musicos-kiosk musicos-agent"
