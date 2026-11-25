#!/usr/bin/env bash
# Download the latest build from the build VM as a compressed image: out/musicos.img.gz
# (gzip, so balenaEtcher / Raspberry Pi Imager / scripts/flash-usb.sh can all read it).
#
#   ./scripts/fetch-image.sh          # uses PVE_HOST + BUILD_HOST from .pipeline.env
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .pipeline.env ] && . ./.pipeline.env
: "${PVE_HOST:?set PVE_HOST}"
: "${BUILD_HOST:?set BUILD_HOST}"
mkdir -p out
OUT=out/musicos.img.gz

echo ">> compressing on $BUILD_HOST and downloading to $OUT"
ssh -o BatchMode=yes -J "$PVE_HOST" "$BUILD_HOST" \
    'set -e; f=musicos/out/musicos.raw; [ -f "$f" ] || { echo "no build yet: run make test or make image" >&2; exit 1; }
     date -r "$f" "+built %Y-%m-%d %H:%M" >&2
     (command -v pigz >/dev/null && pigz -c -3 "$f") || gzip -c -3 "$f"' > "$OUT.part"
mv "$OUT.part" "$OUT"
ls -lh "$OUT" | awk '{print ">> " $5 "  " $NF}'
echo ">> next: ./scripts/flash-usb.sh $OUT <disk>   (or open it in balenaEtcher)"
