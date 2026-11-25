#!/usr/bin/env bash
# Push out/musicos.raw to Proxmox and (re)create a test VM from it.
#
#   PVE_HOST=root@pve ./scripts/proxmox-deploy.sh
#
# Settings (env vars):
#   PVE_HOST   ssh target of the Proxmox node (required), e.g. root@192.168.1.10
#   VMID       VM id to use/replace           (default 9100)
#   STORAGE    storage for disks               (default local-lvm)
#   BRIDGE     network bridge                  (default vmbr0)
#   MEMORY     MiB                             (default 2048)
#   CORES      vCPUs                           (default 2)
#
# WARNING: destroys any existing VM with id $VMID before recreating it.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${PVE_HOST:?set PVE_HOST, e.g. PVE_HOST=root@pve}"
VMID="${VMID:-9100}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
MEMORY="${MEMORY:-2048}"
CORES="${CORES:-2}"
IMAGE="out/musicos.raw"
REMOTE_IMAGE="/var/tmp/musicos.raw"

[ -f "$IMAGE" ] || { echo "no $IMAGE; run 'make image' first" >&2; exit 1; }

# Refuse to clobber a VM that isn't ours.
existing="$(ssh "$PVE_HOST" "qm config $VMID 2>/dev/null | sed -n 's/^name: //p'" || true)"
if [ -n "$existing" ] && [ "$existing" != "musicos" ]; then
    echo "VM $VMID exists and is named '$existing', not 'musicos'. Pick another VMID." >&2
    exit 1
fi

echo ">> copying image to $PVE_HOST:$REMOTE_IMAGE"
rsync -h --progress --sparse "$IMAGE" "$PVE_HOST:$REMOTE_IMAGE"

echo ">> (re)creating VM $VMID"
ssh "$PVE_HOST" bash -s -- "$VMID" "$STORAGE" "$BRIDGE" "$MEMORY" "$CORES" "$REMOTE_IMAGE" <<'EOF'
set -euo pipefail
VMID=$1 STORAGE=$2 BRIDGE=$3 MEMORY=$4 CORES=$5 IMG=$6
if qm status "$VMID" >/dev/null 2>&1; then
    qm stop "$VMID" --skiplock 1 >/dev/null 2>&1 || true
    qm destroy "$VMID" --purge 1
fi
qm create "$VMID" --name musicos --ostype l26 --machine q35 --bios ovmf \
    --cores "$CORES" --memory "$MEMORY" \
    --efidisk0 "$STORAGE:1,efitype=4m,pre-enrolled-keys=0" \
    --scsihw virtio-scsi-single --scsi0 "$STORAGE:0,import-from=$IMG" \
    --boot order=scsi0 \
    --vga virtio --serial0 socket \
    --audio0 device=ich9-intel-hda,driver=spice \
    --net0 "virtio,bridge=$BRIDGE"
qm start "$VMID"
rm -f "$IMG"
echo "VM $VMID started. Console: Proxmox web UI > $VMID > Console (noVNC or SPICE for audio)."
echo "Serial console: qm terminal $VMID"
EOF
