#!/usr/bin/env bash
# Turn the last build on the build VM into an A/B update and serve it on the LAN:
#   ~/musicos-updates/latest.json + musicos_<v>.usr.<uuid>.raw.zst, musicos_<v>.usr-verity.<uuid>.raw.zst, musicos_<v>.efi
# Devices check http://<build-vm>:8090 (Settings > About > Software update), or copy the folder
# to a USB drive as "musicos-update" and install from there.
#
#   ./scripts/publish-update.sh              (uses PVE_HOST + BUILD_HOST from .pipeline.env)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?set PVE_HOST}"
: "${BUILD_HOST:?set BUILD_HOST}"
PORT="${UPDATE_PORT:-8090}"

ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" PORT="$PORT" bash -s <<'EOF'
set -euo pipefail
v=$(cat musicos/image/mkosi.version)
src=musicos/out
dst=~/musicos-updates
usr=$(ls $src/musicos_$v.usr.*.raw 2>/dev/null | head -1 || true)
ver=$(ls $src/musicos_$v.usr-verity.*.raw 2>/dev/null | head -1 || true)
uki=$src/musicos_$v.efi
if [ -z "$usr" ] || [ -z "$ver" ] || [ ! -f "$uki" ]; then
    echo "split artifacts for version $v not found in $src:" >&2
    ls $src >&2
    exit 1
fi
rm -rf "$dst.new" && mkdir -p "$dst.new"
zstd -q -T0 -10 "$usr" -o "$dst.new/$(basename "$usr").zst"
zstd -q -T0 -10 "$ver" -o "$dst.new/$(basename "$ver").zst"
cp "$uki" "$dst.new/"
cd "$dst.new"
python3 - "$v" <<'PY'
import hashlib, json, os, sys
files = []
for name in sorted(os.listdir(".")):
    h = hashlib.sha256(open(name, "rb").read()).hexdigest()
    files.append({"name": name, "sha256": h, "size": os.path.getsize(name)})
json.dump({"version": sys.argv[1], "files": files}, open("latest.json", "w"), indent=1)
PY
cd ..
rm -rf "$dst.old"; [ -d "$dst" ] && mv "$dst" "$dst.old"; mv "$dst.new" "$dst"; rm -rf "$dst.old"
du -sh "$dst" | cut -f1 | sed "s/^/update $v: /"
# served by musicos-updates.service (python3 -m http.server on :8090, set up once on the build
# VM, survives reboots). Fall back to a one-off server if that unit isn't installed.
if ! systemctl is-active -q musicos-updates.service 2>/dev/null && ! pgrep -f "^python3 -m http.server $PORT" >/dev/null; then
    nohup python3 -m http.server "$PORT" --directory "$dst" >/tmp/musicos-updates.log 2>&1 &
    sleep 1
fi
ip=$(hostname -I | awk '{print $1}')
echo "serving at http://$ip:$PORT"
EOF
