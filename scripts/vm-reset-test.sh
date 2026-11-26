#!/usr/bin/env bash
# Library scan progress + reset + boot repair, end to end on the running test VM:
#   fsck.repair=yes on the kernel command line -> copy a 1800-track library in and scan it
#   through the API (progress, summary) -> "Reset settings" keeps the library -> "Erase
#   everything" empties it. Needs the synthetic library in ~/synth on the build VM.
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


vm() {  # look the IP up first: that ssh must not eat our stdin (a piped tar stream)
    local ip; ip=$(vm_ip </dev/null)
    ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -J "$PVE_HOST" "music@$ip" "$@"
}
fail() { step "FAIL: $*"; exit 1; }
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
rename() { api POST /api/receivers '{"name":"musicos-test-vm"}' >/dev/null; }  # never advertise as "musicos"

for i in $(seq 1 60); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 && break; sleep 3; done
sleep 5

step "boot repair"
g "cat /proc/cmdline" | grep -q "fsck.repair=yes" && echo "   fsck.repair=yes" || fail "fsck.repair missing"

step "scan a 1800-track library"
ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" 'tar -C ~/synth -cf - .' | vm 'mkdir -p /srv/music/local/synth && tar -C /srv/music/local/synth -xf -'
sleep 3
api POST /api/update '{"full": true}' >/dev/null
seen=""
for i in $(seq 1 120); do
    sc=$(api GET /api/scan)
    line=$(echo "$sc" | j '"%s %s%% %s/%s %s" % (d["phase"], d["pct"], d["done"], d["total"], d["current"][:40]) if d["active"] else "idle"')
    [ "$line" != idle ] && seen=1 && echo "   $line"
    [ -n "$seen" ] && [ "$line" = idle ] && break
    sleep 1
done
last=$(api GET /api/scan | j 'd["last"]')
echo "   last: $last"
songs=$(api GET /api/stats | j 'd["songs"]')
[ "$songs" -ge 1800 ] || fail "library has $songs songs"
echo "$last" | grep -q "'errors': 0" || fail "scan reported errors"

step "reset settings: settings gone, library kept"
api POST /api/receivers '{"name":"reset-me"}' >/dev/null
api POST /api/config '{"setupComplete": true, "name": "Tester"}' >/dev/null
api POST /api/reset '{"mode":"settings"}'
wait_reboot; sleep 20
cfg=$(api GET /api/config); rename
echo "$cfg" | j '"   setupComplete=%s name=%r" % (d.get("setupComplete"), d.get("name"))'
echo "$cfg" | grep -q '"setupComplete": false' || fail "settings not reset"
songs=$(api GET /api/stats | j 'd["songs"]'); echo "   library: $songs songs"
[ "$songs" -ge 1800 ] || fail "library lost on settings reset"

step "erase everything: local music and library gone"
api POST /api/reset '{"mode":"everything"}'
wait_reboot; sleep 25
rename
songs=$(api GET /api/stats | j 'd["songs"]'); left=$(g "ls -A /srv/music/local | wc -l")
echo "   library: $songs songs, local folder entries: $left"
[ "$songs" = 0 ] && [ "$left" = 0 ] || fail "erase everything left $songs songs / $left files"
step "PASS: scan progress, reset settings, erase everything, boot repair"
