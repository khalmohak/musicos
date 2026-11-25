#!/usr/bin/env bash
# One-time setup of the image build host: a Debian trixie VM/LXC on Proxmox (x86-64).
# Needs ~20 GB free disk. Run as root (or with sudo).
set -euo pipefail

if ! grep -q 'VERSION_CODENAME=trixie' /etc/os-release; then
    echo "warning: tested on Debian trixie; other releases may ship an older mkosi" >&2
fi

apt-get update
apt-get install -y --no-install-recommends \
    mkosi systemd-repart systemd-boot-efi systemd-ukify \
    debian-archive-keyring apt dpkg \
    dosfstools mtools e2fsprogs zstd cpio \
    qemu-system-x86 qemu-utils ovmf \
    python3 git make rsync openssh-client

echo
mkosi --version
echo "Build host ready. Next: make image"
