#!/usr/bin/env bash
# Push out/musicos.raw to Proxmox and (re)create a test VM from it.
#
#   PVE_HOST=root@pve ./scripts/proxmox-deploy.sh
#
# Settings (env vars):
#   PVE_HOST   ssh target of the Proxmox node (required), e.g. root@192.168.1.10
#   BUILD_HOST if set, the node pulls the image from this host (e.g. debian@192.168.1.18,
#              path ~/musicos/out/musicos.raw) instead of uploading a local out/musicos.raw
#   VMID       VM id to use/replace           (default 9101)
#   STORAGE    storage for disks               (default local-lvm)
#   BRIDGE     network bridge                  (default vmbr0)
#   MEMORY     MiB                             (default 2048)
#   CORES      vCPUs                           (default 2)
#   DISK_SIZE  grow the disk before first boot, e.g. 12G (tests first-boot root growth)
#   VGA_RES    virtual screen resolution, e.g. 3840x2160 (default: QEMU's 1280x800)
#
# WARNING: destroys any existing VM with id $VMID before recreating it.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PVE_HOST:?set PVE_HOST, e.g. PVE_HOST=root@pve}"
VMID="${VMID:-9101}"
BUILD_HOST="${BUILD_HOST:-}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
MEMORY="${MEMORY:-2048}"
CORES="${CORES:-2}"
DISK_SIZE="${DISK_SIZE:-}"
VGA_RES="${VGA_RES:-}"
IMAGE="out/musicos.raw"
REMOTE_IMAGE="/var/tmp/musicos.raw"

if [ -z "$BUILD_HOST" ] && [ ! -f "$IMAGE" ]; then
    echo "no $IMAGE; run 'make image' first (or set BUILD_HOST)" >&2
    exit 1
fi

# Refuse to clobber a VM that isn't ours.
existing="$(ssh "$PVE_HOST" "qm config $VMID 2>/dev/null | sed -n 's/^name: //p'" || true)"
if [ -n "$existing" ] && [ "$existing" != "musicos" ]; then
    echo "VM $VMID exists and is named '$existing', not 'musicos'. Pick another VMID." >&2
    exit 1
fi

if [ -n "$BUILD_HOST" ]; then
    echo ">> $PVE_HOST pulling image from $BUILD_HOST"
    ssh "$PVE_HOST" "rsync -a --sparse -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' \
        '$BUILD_HOST:musicos/out/musicos.raw' '$REMOTE_IMAGE'"
else
    echo ">> copying image to $PVE_HOST:$REMOTE_IMAGE"
    rsync -h --progress --sparse "$IMAGE" "$PVE_HOST:$REMOTE_IMAGE"
fi

echo ">> (re)creating VM $VMID"
ssh "$PVE_HOST" bash -s -- "$VMID" "$STORAGE" "$BRIDGE" "$MEMORY" "$CORES" "$REMOTE_IMAGE" "${DISK_SIZE:--}" "${VGA_RES:--}" <<'EOF'
set -euo pipefail
VMID=$1 STORAGE=$2 BRIDGE=$3 MEMORY=$4 CORES=$5 IMG=$6 DISK_SIZE=$7 VGA_RES=$8
if qm status "$VMID" >/dev/null 2>&1; then
    qm stop "$VMID" --skiplock 1 >/dev/null 2>&1 || true
    qm destroy "$VMID" --purge 1
fi
qm create "$VMID" --name musicos --ostype l26 --machine q35 --bios ovmf \
    --cores "$CORES" --memory "$MEMORY" \
    --efidisk0 "$STORAGE:1,efitype=4m,pre-enrolled-keys=0" \
    --scsihw virtio-scsi-single --scsi0 "$STORAGE:0,import-from=$IMG" \
    --boot order=scsi0 \
    --vga virtio --serial0 socket --agent enabled=1 \
    --audio0 device=ich9-intel-hda,driver=spice \
    --net0 "virtio,bridge=$BRIDGE"
if [ "$DISK_SIZE" != - ]; then qm resize "$VMID" scsi0 "$DISK_SIZE"; fi
if [ "$VGA_RES" != - ]; then
    qm set "$VMID" --args "-global virtio-vga.xres=${VGA_RES%x*} -global virtio-vga.yres=${VGA_RES#*x}" >/dev/null
fi
qm start "$VMID"
rm -f "$IMG"
echo "VM $VMID started. Console: Proxmox web UI > $VMID > Console (noVNC or SPICE for audio)."
echo "Serial console: qm terminal $VMID"
EOF
