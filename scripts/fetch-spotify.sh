#!/usr/bin/env bash
# Spotify Connect needs librespot, which Debian doesn't package. This fetches the Raspotify
# project's amd64 .deb (librespot inside), pinned by version AND sha256, into image/mkosi.packages/
# so mkosi can install it. Run on the build host before `mkosi build`.
#
# scripts/pve-test.sh runs this on the build host (SPOTIFY=0 to build without Spotify Connect).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="0.48.4"
DEB="raspotify_0.48.4.librespot.v0.8.0-99b6088_amd64.deb"
URL="https://github.com/dtcooper/raspotify/releases/download/$VERSION/$DEB"
# reviewed 2026-11-25: contains /usr/bin/librespot + raspotify units/config (disabled in postinst)
SHA256="7b228feb0623bf0f9b65904961ad3ad9df8e1f4b07a002ab2388e1ee9385eeed"

mkdir -p image/mkosi.packages
out="image/mkosi.packages/raspotify.deb"   # fixed name: image/mkosi.conf.d/50-spotify.conf matches on it
if [ ! -f "$out" ]; then
    curl -fsSL "$URL" -o "$out.part"
    mv "$out.part" "$out"
fi
echo "$SHA256  $out" | sha256sum -c -
