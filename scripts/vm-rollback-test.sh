#!/usr/bin/env bash
# Rollback safety net, end to end on the running test VM:
#   build + publish a newer version -> the box installs it -> corrupt its new /usr slot from the
#   Proxmox host (as a bad update would) -> reboot -> the trial boots fail (initrd emergency ->
#   reboot) -> after 3 tries systemd-boot goes back to the old version on its own.
# Run after scripts/vm-update-test.sh (or any deploy).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?}" "${BUILD_HOST:?}"
VMID="${VMID:-9101}"
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


for i in $(seq 1 60); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 && break; sleep 3; done

step "before"
old=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")
echo "running $old"

step "build + publish a newer version"
new=$(date +%Y%m%d.%H%M)
[ "$new" = "$old" ] && new="$new.1"
echo "$new" > image/mkosi.version
rsync -az --delete --exclude .git --exclude out --exclude image/mkosi.cache --exclude image/mkosi.packages --exclude ui/node_modules \
    -e "ssh -o BatchMode=yes -J $PVE_HOST" ./ "$BUILD_HOST:musicos/"
ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" 'cd musicos/image && sudo mkosi -f build' > out/test/build-rollback.log 2>&1 \
    || { tail -30 out/test/build-rollback.log; exit 1; }
./scripts/publish-update.sh
url="http://$(echo "$BUILD_HOST" | cut -d@ -f2):${UPDATE_PORT:-8090}"

step "box installs $new"
api POST /api/update/check "{\"url\":\"$url\"}"
for i in $(seq 1 60); do
    st=$(api GET /api/update); echo "$st" | grep -q '"state": "ready"' && break
    echo "$st" | grep -q '"state": "failed"' && { echo "$st"; exit 1; }
    sleep 5
done
api POST /api/update/install '{}'
for i in $(seq 1 60); do
    st=$(api GET /api/update); echo "$st" | grep -qE '"install": "(installed|failed)"' && break; sleep 5
done
echo "$st" | grep -q '"install": "installed"' || { echo "$st"; exit 1; }

step "corrupt the new /usr slot (simulates a bad update)"
disk=$(pve "qm config $VMID" | sed -n 's/^scsi0: \([^,]*\),.*/\1/p')
dev=$(pve "pvesm path $disk")
start=$(pve "sfdisk -d $dev" | grep "name=\"musicos_$new\"" | sed -n 's/.*start= *\([0-9]*\),.*/\1/p')
[ -n "$start" ] || { echo "slot musicos_$new not found"; exit 1; }
pve "sync; dd if=/dev/zero of=$dev bs=512 seek=$start count=131072 conv=notrunc status=none; sync"
echo "zeroed 64 MiB at sector $start of $dev"

step "reboot: expect 3 failed trial boots, then $old again"
api POST /api/power '{"action":"reboot"}' || true
for i in $(seq 1 40); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 || break; sleep 1; done
back=""
for i in $(seq 1 160); do  # up to ~8 minutes
    if pve "qm guest cmd $VMID ping" >/dev/null 2>&1; then back=1; break; fi
    sleep 3
done
[ -n "$back" ] || { step "FAIL: never came back"; exit 1; }
sleep 15
now=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")
g "ls /boot/EFI/Linux; journalctl --list-boots --no-pager | tail -3"
api GET /api/update | python3 -c 'import json,sys; d=json.load(sys.stdin); print("ui:", d["install"], d["installVersion"])'
if [ "$now" = "$old" ]; then step "PASS: bad update $new rolled back to $old by itself"; else step "FAIL: running $now (expected $old)"; exit 1; fi
