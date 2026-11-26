#!/usr/bin/env bash
# Package image/initrd-pkg as image/mkosi.packages/musicos-initrd.deb (installed into the
# initrd via InitrdPackages=). Run on the build host before `mkosi build`.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p image/mkosi.packages
chmod 755 image/initrd-pkg/usr/lib/musicos-initrd/trial-boot-failed
# fresh version per build: a changed package must never reuse a version number
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp -a image/initrd-pkg/. "$tmp/"
sed -i "s/^Version: .*/Version: 1.$(date +%Y%m%d%H%M)/" "$tmp/DEBIAN/control"
dpkg-deb --root-owner-group -Zxz -b "$tmp" image/mkosi.packages/musicos-initrd.deb >/dev/null
echo "built image/mkosi.packages/musicos-initrd.deb"
