#!/usr/bin/env bash
# Full test loop, run from your workstation:
#   sync repo -> build on the build VM -> deploy test VM on Proxmox -> boot checks -> screenshot
#
#   ./scripts/pve-test.sh            # everything
#   SKIP_BUILD=1 ./scripts/pve-test.sh   # redeploy + test the last build
#
# Settings come from env or .pipeline.env (gitignored), see .pipeline.env.example.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env

: "${PVE_HOST:?set PVE_HOST (e.g. root@100.81.243.27)}"
: "${BUILD_HOST:?set BUILD_HOST (e.g. debian@192.168.1.18)}"
VMID="${VMID:-9101}"
OUT="out/test"
mkdir -p "$OUT"
JUMP="ssh -o BatchMode=yes -J $PVE_HOST"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

if [ -z "${SKIP_BUILD:-}" ]; then
    step "build UI"
    (cd ui && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build >/dev/null) \
        || { echo "UI BUILD FAILED" >&2; exit 1; }

    # every build gets a version (A/B updates compare these); same stamp on both machines
    date +%Y%m%d.%H%M > image/mkosi.version
    echo "version $(cat image/mkosi.version)"

    step "sync repo -> $BUILD_HOST"
    rsync -az --delete --exclude .git --exclude out --exclude image/mkosi.cache --exclude image/mkosi.packages \
        --exclude ui/node_modules -e "$JUMP" ./ "$BUILD_HOST:musicos/"
    $JUMP "$BUILD_HOST" 'cd musicos && ./scripts/fetch-spotify.sh' | sed 's/^/spotify package: /'

    step "build image (log: $OUT/build.log)"
    start=$(date +%s)
    if ! $JUMP "$BUILD_HOST" 'cd musicos/image && sudo mkosi -f build' >"$OUT/build.log" 2>&1; then
        tail -40 "$OUT/build.log"
        echo "BUILD FAILED" >&2
        exit 1
    fi
    echo "built in $(( $(date +%s) - start ))s"
fi

step "deploy VM $VMID"
PVE_HOST="$PVE_HOST" BUILD_HOST="$BUILD_HOST" VMID="$VMID" CORES="${CORES:-2}" MEMORY="${MEMORY:-2048}" \
    DISK_SIZE="${DISK_SIZE:-}" VGA_RES="${VGA_RES:-}" ./scripts/proxmox-deploy.sh \
    | grep -vE '^(transferred|  )' || true

step "boot checks"
ssh -o BatchMode=yes "$PVE_HOST" bash -s -- "$VMID" <<'EOF' | tee "$OUT/checks.log"
set -uo pipefail
VMID=$1
gexec() {  # run a shell command in the guest, print stdout
    qm guest exec "$VMID" --timeout 60 -- sh -c "$1" 2>/dev/null \
        | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("out-data","").rstrip())'
}
fail=0
# catch the Plymouth splash mid-boot
for i in $(seq 1 40); do [ "$(qm status "$VMID" | awk '{print $2}')" = running ] && break; sleep 0.5; done
sleep "${SPLASH_AT:-6}"
qm monitor "$VMID" <<< "screendump /var/tmp/musicos-splash.ppm" >/dev/null
for i in $(seq 1 60); do qm guest cmd "$VMID" ping >/dev/null 2>&1 && break; sleep 3; done
qm guest cmd "$VMID" ping >/dev/null 2>&1 || { echo "FAIL guest agent never came up"; exit 1; }
echo "ok   guest agent"

sleep 20   # let the kiosk settle so a crash loop shows up as restarts
for u in mpd musicos-agent musicos-kiosk musicos-apply.path NetworkManager musicos-input shairport-sync; do
    state=$(gexec "systemctl is-active $u")
    restarts=$(gexec "systemctl show -p NRestarts --value $u")
    if [ "$state" = active ] && [ "${restarts:-0}" -le 1 ]; then
        echo "ok   $u (restarts=$restarts)"
    else
        echo "FAIL $u state=$state restarts=$restarts"
        gexec "journalctl -u $u -b --no-pager -n 15" | sed 's/^/     /'
        fail=1
    fi
done

# boot must finish: A/B updates are only marked good once boot-complete.target is reached
state=$(gexec "systemctl is-active graphical.target; systemctl is-system-running")
case "$state" in
    active*running*|active*degraded*) echo "ok   boot finished ($(echo $state | awk '{print $2}'))" ;;
    *) echo "FAIL boot did not finish: $state"; gexec "systemctl list-jobs --no-pager | head -8" | sed 's/^/     /'; fail=1 ;;
esac
rootsize=$(gexec "df -h --output=size / | tail -1" | tr -d ' ')
echo "info root filesystem $rootsize"
echo "info version $(gexec ". /usr/lib/os-release; echo \$IMAGE_VERSION")"
usr=$(gexec "findmnt -no FSTYPE,OPTIONS,SOURCE /usr")
case "$usr" in
    erofs*ro*mapper*) echo "ok   /usr read-only erofs on dm-verity ($(echo "$usr" | awk '{print $3}'))" ;;
    *) echo "FAIL /usr is not read-only verity erofs: $usr"; fail=1 ;;
esac
ip=$(qm guest cmd "$VMID" network-get-interfaces | python3 -c '
import json,sys
for i in json.load(sys.stdin):
    for a in i.get("ip-addresses", []):
        if a["ip-address-type"] == "ipv4" and not a["ip-address"].startswith("127."):
            print(a["ip-address"]); sys.exit()')
echo "ip   $ip"
if curl -fsS -m 5 "http://$ip:8080/api/status" >/dev/null; then
    echo "ok   agent API http://$ip:8080/api/status"
    # never advertise AirPlay/Spotify as "musicos" from a test VM: phones would pick it
    curl -s -m 5 -H "Content-Type: application/json" -d '{"name":"musicos-test-vm"}' "http://$ip:8080/api/receivers" >/dev/null
else
    echo "FAIL agent API unreachable at $ip:8080"; fail=1
fi
qm monitor "$VMID" <<< "screendump /var/tmp/musicos-shot.ppm" >/dev/null
exit $fail
EOF
rc=${PIPESTATUS[0]}

step "screenshots"
for name in splash shot; do
    scp -q "$PVE_HOST:/var/tmp/musicos-$name.ppm" "$OUT/$name.ppm" 2>/dev/null || continue
    python3 scripts/ppm2png.py "$OUT/$name.ppm" "$OUT/$name.png" >/dev/null
    rm -f "$OUT/$name.ppm"
done
mv -f "$OUT/shot.png" "$OUT/screen.png" 2>/dev/null || true
ls "$OUT"/*.png

[ "$rc" -eq 0 ] && step "PASS" || { step "FAIL"; exit "$rc"; }
