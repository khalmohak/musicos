#!/usr/bin/env bash
# Install to disk, end to end on the running test VM:
#   add an empty 20G disk -> install onto it through the agent API (what Settings does) ->
#   power off, detach the original disk (= pull the USB stick), boot from the new one ->
#   check version, /usr, root on the new disk, settings kept -> put the VM back as it was.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?}"
VMID="${VMID:-9101}"
STORE="${STORE:-local-lvm}"
pve() { ssh -o BatchMode=yes "$PVE_HOST" "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
g() {
    pve "qm guest exec $VMID --timeout ${2:-120} -- sh -c $(printf '%q' "$1")" \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("out-data","")+d.get("err-data","")).rstrip())'
}
vm_ip() {
    pve "qm guest cmd $VMID network-get-interfaces" | python3 -c '
import json,sys
for i in json.load(sys.stdin):
    for a in i.get("ip-addresses", []):
        if a["ip-address-type"] == "ipv4" and not a["ip-address"].startswith("127."):
            print(a["ip-address"]); sys.exit()'
}
api() {  # api METHOD PATH [JSON] -- over the LAN from the Proxmox host, like the UI does
    local ip body; ip=$(vm_ip); body="${3:-}"; [ -n "$body" ] || body='{}'
    if [ "$1" = POST ]; then
        pve "curl -s -m 60 -H 'Content-Type: application/json' -d '$body' http://$ip:8080$2"
    else
        pve "curl -s -m 60 http://$ip:8080$2"
    fi
    echo
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


wait_up() {
    for i in $(seq 1 100); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 && return 0; sleep 3; done
    return 1
}
restore() {
    step "restore the VM (original disk back, test disk deleted)"
    pve "qm stop $VMID >/dev/null 2>&1 || true"
    pve "qm config $VMID | grep -q '^scsi0: $ORIG' || qm set $VMID --scsi0 $ORIG >/dev/null"
    if pve "qm config $VMID | grep -q '^scsi1:'"; then
        local newvol; newvol=$(pve "qm config $VMID" | sed -n 's/^scsi1: \([^,]*\),.*/\1/p')
        pve "qm set $VMID --delete scsi1 >/dev/null"
        # only ever destroy the test disk we added (never the original)
        [ -n "$newvol" ] && [ "$newvol" != "$ORIG" ] && pve "u=\$(qm config $VMID | grep -F ' $newvol' | cut -d: -f1); [ -n \"\$u\" ] && qm disk unlink $VMID --idlist \$u --force >/dev/null" || true
    fi
    pve "qm set $VMID --boot order=scsi0 >/dev/null; qm start $VMID"
    wait_up && echo "   VM back on its original disk"
}

wait_up
ORIG=$(pve "qm config $VMID" | sed -n 's/^scsi0: \([^,]*\),.*/\1/p')
[ -n "$ORIG" ] || { echo "no scsi0 on VM $VMID"; exit 1; }
step "before (original disk $ORIG)"
old=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")
g "lsblk -d -o NAME,SIZE,MODEL,SERIAL"

step "add an empty 20G disk"
pve "qm config $VMID | grep -q '^scsi1:' || qm set $VMID --scsi1 $STORE:20 >/dev/null"
sleep 8
g "lsblk -d -o NAME,SIZE,MODEL,SERIAL"

step "the agent lists it"
info=$(api GET /api/install)
echo "$info" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("boot:", d["boot"]["name"] if d["boot"] else None, "needs", d["neededText"]); [print(" ", x["path"], x["name"], x["sizeText"], "ok" if x.get("ok") else x.get("why")) for x in d["disks"]]'
body=$(echo "$info" | python3 -c 'import json,sys; d=[x for x in json.load(sys.stdin)["disks"] if x.get("ok")][0]; print(json.dumps({"path": d["path"], "serial": d["serial"], "size": d["size"]}))')

step "install onto it"
api POST /api/install "$body"
st=""
for i in $(seq 1 240); do
    st=$(api GET /api/install | python3 -c 'import json,sys; s=json.load(sys.stdin)["status"]; print(s["state"], s.get("pct",""), s.get("step",""), s.get("error",""), s.get("warning",""))')
    case "$st" in done*|failed*) break ;; esac
    [ $((i % 6)) -eq 0 ] && echo "   $st"
    sleep 5
done
echo "   $st"
case "$st" in done*) ;; *) g "journalctl -u musicos-install --no-pager | tail -20"; restore; exit 1 ;; esac
g "efibootmgr | head -6; sfdisk -l -o Device,Size,Type,Name /dev/sdb | tail -7"

step "boot from the new disk only (original detached)"
pve "qm shutdown $VMID --timeout 60 || qm stop $VMID; qm set $VMID --delete scsi0 >/dev/null; qm set $VMID --boot order=scsi1 >/dev/null; qm start $VMID"
if ! wait_up; then step "FAIL: did not boot from the new disk"; restore; exit 1; fi
sleep 20
g ". /usr/lib/os-release; echo version \$IMAGE_VERSION; findmnt -no SOURCE,FSTYPE /usr; findmnt -no SOURCE,SIZE /; lsblk -o NAME,SIZE,PARTLABEL; systemctl is-active musicos-agent musicos-kiosk mpd; cat /var/lib/musicos/config.json | head -c 200"
now=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")
name=$(api GET /api/receivers | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])' || true)
ok=1
[ "$now" = "$old" ] || { echo "   version $now, expected $old"; ok=0; }
[ "$name" = "musicos-test-vm" ] || { echo "   settings not kept (receiver name: $name)"; ok=0; }
restore
if [ $ok = 1 ]; then step "PASS: installed to disk, boots without the original, settings kept"; else step "FAIL"; exit 1; fi
