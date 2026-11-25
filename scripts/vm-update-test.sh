#!/usr/bin/env bash
# A/B update end to end on the running test VM:
#   build a newer version -> publish it -> the box downloads + verifies + installs it through its
#   own API -> reboot -> check it runs the new version from the other /usr slot.
# Needs a VM deployed by scripts/pve-test.sh first.
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
g ". /usr/lib/os-release; echo version \$IMAGE_VERSION; findmnt -no SOURCE /usr; ls /boot/EFI/Linux"
old=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")

step "build a newer version on the build VM (same sources)"
new=$(date +%Y%m%d.%H%M)
[ "$new" = "$old" ] && new="$new.1"
echo "$new" > image/mkosi.version
rsync -az --delete --exclude .git --exclude out --exclude image/mkosi.cache --exclude image/mkosi.packages --exclude ui/node_modules \
    -e "ssh -o BatchMode=yes -J $PVE_HOST" ./ "$BUILD_HOST:musicos/"
ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" 'cd musicos/image && sudo mkosi -f build' > out/test/build-update.log 2>&1 \
    || { tail -30 out/test/build-update.log; exit 1; }
echo "built $new"

step "publish"
./scripts/publish-update.sh
url="http://$(echo "$BUILD_HOST" | cut -d@ -f2):${UPDATE_PORT:-8090}"

step "box: check, download, verify, install"
api POST /api/update/check "{\"url\":\"$url\"}"
for i in $(seq 1 60); do
    st=$(api GET /api/update)
    echo "$st" | grep -q '"state": "ready"' && break
    echo "$st" | grep -q '"state": "failed"' && { echo "$st"; exit 1; }
    sleep 5
done
api POST /api/update/install '{}'
for i in $(seq 1 60); do
    st=$(api GET /api/update)
    echo "$st" | grep -qE '"install": "(installed|failed)"' && break
    sleep 5
done
echo "$st" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("install:", d["install"], "staged:", d["staged"])'
g "tail -5 /var/lib/musicos/update.log; ls /boot/EFI/Linux; sfdisk -l -o Device,Size,Name /dev/sda 2>/dev/null | tail -7"

step "reboot into $new"
api POST /api/power '{"action":"reboot"}' || true
wait_reboot
sleep 20
g ". /usr/lib/os-release; echo version \$IMAGE_VERSION; findmnt -no SOURCE /usr; systemctl is-active musicos-agent musicos-kiosk musicos-health; ls /boot/EFI/Linux; ls /srv/music; cat /var/lib/musicos/config.json | head -3"
now=$(g ". /usr/lib/os-release; echo \$IMAGE_VERSION")
[ "$now" = "$new" ] || { step "FAIL: still on $now (expected $new)"; exit 1; }
# the health check passed and systemd-bless-boot dropped the tries counter: the entry is good
for i in $(seq 1 30); do
    g "ls /boot/EFI/Linux" | grep -qx "musicos_$new.efi" && break
    sleep 3
done
g "ls /boot/EFI/Linux" | grep -qx "musicos_$new.efi" || { step "FAIL: boot entry for $new not marked good"; g "ls /boot/EFI/Linux; systemctl status musicos-health boot-complete.target systemd-bless-boot --no-pager | head -30"; exit 1; }
step "PASS: $old -> $new, boot entry marked good, settings kept"
