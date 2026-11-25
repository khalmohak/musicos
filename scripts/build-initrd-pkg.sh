#!/usr/bin/env bash
# Package image/initrd-pkg as image/mkosi.packages/musicos-initrd.deb (installed into the
# initrd via InitrdPackages=). Run on the build host before `mkosi build`.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p image/mkosi.packages
chmod 755 image/initrd-pkg/usr/lib/musicos-initrd/trial-boot-failed
dpkg-deb --root-owner-group -Zxz -b image/initrd-pkg image/mkosi.packages/musicos-initrd.deb >/dev/null
echo "built image/mkosi.packages/musicos-initrd.deb"
