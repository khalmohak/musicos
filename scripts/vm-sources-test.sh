#!/usr/bin/env bash
# Music sources end to end on the running test VM, against the Samba server on the build VM
# (share "music": user mtest/testpass, Library/ = 1800 tracks + Backups/; share "public": guest):
#   migration -> discovery -> connection test (good + wrong password) -> add the share ->
#   browse -> add only Library/ -> scan -> server goes away: albums stay, greyed out, and a scan
#   doesn't drop them -> server back -> remove the folder -> forget the share.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?}" "${BUILD_HOST:?}"
VMID="${VMID:-9101}"
SMB=$(echo "$BUILD_HOST" | cut -d@ -f2)
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


fail() { step "FAIL: $*"; ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" "sudo systemctl start smbd" || true; exit 1; }
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
build() { ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" "$@"; }

for i in $(seq 1 60); do pve "qm guest cmd $VMID ping" >/dev/null 2>&1 && break; sleep 3; done
sleep 5

step "migration: connected sources became library folders"
api GET /api/library | j '"\n".join("   %s %s path=%r online=%s" % (f["id"], f["source"], f["path"], f["online"]) for f in d["folders"]) or "   (none)"'
api GET /api/library | j 'any(f["source"] == "local" for f in d["folders"])' | grep -q True || fail "local folder not migrated"

step "discovery"
api GET /api/net/discover | j '"\n".join("   %s %s %s" % (s["name"], s["address"], s["protocols"]) for s in d)'
api GET /api/net/discover | grep -q "\"$SMB\"" || fail "build VM not discovered"

step "connection test: wrong password, then right"
api POST /api/net/test "{\"server\":\"$SMB\",\"share\":\"music\",\"username\":\"mtest\",\"password\":\"nope\"}" | j '"   ok=%s: %s" % (d["ok"], " / ".join(s["title"] + (": " + s["detail"] if s["ok"] is False else "") for s in d["steps"]))'
api POST /api/net/test "{\"server\":\"$SMB\",\"share\":\"music\",\"username\":\"mtest\",\"password\":\"testpass\"}" > /tmp/musicos-nt.json
j '"   ok=%s: %s" % (d["ok"], " / ".join(s["title"] for s in d["steps"]))' < /tmp/musicos-nt.json
j 'd["ok"]' < /tmp/musicos-nt.json | grep -q True || fail "connection test"

step "add the share, wait for it to mount"
sid=$(api POST /api/sources/smb "{\"name\":\"music\",\"server\":\"$SMB\",\"share\":\"music\",\"path\":\"\",\"username\":\"mtest\",\"password\":\"testpass\"}" | j 'd["id"]')
src="net:$sid"; echo "   source $src"
on=""
for i in $(seq 1 30); do
    api GET "/api/library/browse?source=$src&path=" >/dev/null 2>&1 || true
    api GET /api/library | j 'any(s["id"] == "'$src'" and s["online"] for s in d["sources"])' | grep -q True && on=1 && break
    sleep 2
done
[ -n "$on" ] || fail "share never mounted"

step "browse and add only Library/"
api GET "/api/library/browse?source=$src&path=" | j '"\n".join("   %s: %d audio%s" % (f["name"], f["audio"], "" if f["complete"] else "+") for f in d["folders"])'
fid=$(api POST /api/library/add "{\"source\":\"$src\",\"path\":\"Library\"}" | j 'd["id"]')
echo "   folder $fid"
for i in $(seq 1 90); do
    songs=$(api GET /api/stats | j 'd["songs"]')
    [ "$songs" -ge 1800 ] && break; sleep 2
done
echo "   library: $songs songs"
[ "$songs" -ge 1800 ] || fail "share folder not scanned"
api GET /api/library | j '"\n".join("   %s: %d albums, %d tracks, online=%s" % (f["name"], f["albums"], f["tracks"], f["online"]) for f in d["folders"])'

step "server goes away: albums stay, greyed out"
build "sudo systemctl stop smbd"
off=""
for i in $(seq 1 40); do
    api GET /api/library | j '[f for f in d["folders"] if f["id"] == "'$fid'"][0]["online"]' | grep -q False && off=1 && break
    sleep 3
done
[ -n "$off" ] || fail "folder never went offline"
api POST /api/update '{}' >/dev/null; sleep 8
songs=$(api GET /api/stats | j 'd["songs"]'); grey=$(api GET /api/albums | j 'sum(1 for a in d if a.get("offline"))')
echo "   after a scan while offline: $songs songs, $grey albums greyed out"
[ "$songs" -ge 1800 ] && [ "$grey" -ge 150 ] || fail "offline albums were dropped or not greyed"

step "server back"
build "sudo systemctl start smbd"
back=""
for i in $(seq 1 40); do
    api GET /api/library | j '[f for f in d["folders"] if f["id"] == "'$fid'"][0]["online"]' | grep -q True && back=1 && break
    sleep 3
done
[ -n "$back" ] || fail "folder never came back"
grey=$(api GET /api/albums | j 'sum(1 for a in d if a.get("offline"))'); echo "   greyed out now: $grey"
[ "$grey" = 0 ] || fail "albums still greyed"

step "remove the folder, forget the share"
api POST /api/library/remove "{\"id\":\"$fid\"}" >/dev/null
sleep 6
songs=$(api GET /api/stats | j 'd["songs"]'); echo "   library: $songs songs"
[ "$songs" -lt 1800 ] || fail "songs not dropped after removing the folder"
api POST /api/sources/remove "{\"id\":\"$sid\"}" >/dev/null
step "PASS: discovery, test, add share, choose folder, offline kept + greyed, back online, remove"
