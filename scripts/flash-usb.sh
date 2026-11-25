#!/usr/bin/env bash
# Write a musicos image to a USB stick (macOS or Linux). ERASES THE TARGET DISK.
#
#   ./scripts/flash-usb.sh                          # list candidate USB disks
#   ./scripts/flash-usb.sh out/musicos.img.gz disk4 # macOS
#   ./scripts/flash-usb.sh out/musicos.img.gz sdb   # Linux
#
# Refuses internal disks and the disk the system runs from, and asks you to type the
# disk name before writing.
set -euo pipefail

IMG="${1:-}"
DISK="${2:-}"
OS="$(uname -s)"

list_disks() {
    echo "External / removable disks:"
    if [ "$OS" = Darwin ]; then
        diskutil list external physical | grep -E '^/dev/disk' || echo "  (none found)"
        echo
        diskutil list external physical | sed -n 's/^ *0: *//p' | sed 's/^/  /'
    else
        lsblk -d -o NAME,SIZE,TRAN,RM,MODEL | awk 'NR==1 || $3=="usb" || $4=="1"'
    fi
}

if [ -z "$IMG" ] || [ -z "$DISK" ]; then
    list_disks
    echo
    echo "usage: $0 <image(.gz|.raw)> <disk>   e.g. $0 out/musicos.img.gz ${OS:+$( [ "$OS" = Darwin ] && echo disk4 || echo sdb)}"
    exit 1
fi
[ -f "$IMG" ] || { echo "no such image: $IMG" >&2; exit 1; }
DISK="${DISK#/dev/}"

# ---------- safety checks ----------
if [ "$OS" = Darwin ]; then
    [[ "$DISK" =~ ^disk[0-9]+$ ]] || { echo "use a whole disk like disk4, not a partition" >&2; exit 1; }
    info="$(diskutil info "/dev/$DISK")" || { echo "no such disk: $DISK" >&2; exit 1; }
    grep -qE 'Device Location: +External|Removable Media: +(Removable|Yes)' <<<"$info" \
        || { echo "refusing: /dev/$DISK is not an external/removable disk" >&2; exit 1; }
    boot="$(diskutil info / | sed -n 's/.*Part of Whole: *//p')"
    [ "$DISK" != "$boot" ] || { echo "refusing: /dev/$DISK holds the running system" >&2; exit 1; }
    size="$(sed -n 's/.*Disk Size: *\([^(]*\).*/\1/p' <<<"$info" | head -1)"
    model="$(sed -n 's/.*Device \/ Media Name: *//p' <<<"$info" | head -1)"
    TARGET="/dev/r$DISK"
else
    [[ "$DISK" =~ ^(sd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$ ]] || { echo "use a whole disk like sdb" >&2; exit 1; }
    [ -b "/dev/$DISK" ] || { echo "no such disk: $DISK" >&2; exit 1; }
    tran="$(lsblk -dno TRAN "/dev/$DISK")"; rm="$(lsblk -dno RM "/dev/$DISK" | tr -d ' ')"
    [ "$tran" = usb ] || [ "$rm" = 1 ] || { echo "refusing: /dev/$DISK is not USB/removable" >&2; exit 1; }
    root="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)"
    [ "$DISK" != "$root" ] || { echo "refusing: /dev/$DISK holds the running system" >&2; exit 1; }
    size="$(lsblk -dno SIZE "/dev/$DISK")"; model="$(lsblk -dno MODEL "/dev/$DISK")"
    TARGET="/dev/$DISK"
fi

echo "About to ERASE /dev/$DISK  ($model, $size) and write $(basename "$IMG")."
read -r -p "Type the disk name ($DISK) to continue: " answer
[ "$answer" = "$DISK" ] || { echo "aborted"; exit 1; }

# ---------- write ----------
if [ "$OS" = Darwin ]; then
    diskutil unmountDisk "/dev/$DISK" >/dev/null
    BS=4m
else
    for p in $(lsblk -lno NAME "/dev/$DISK" | tail -n +2); do sudo umount "/dev/$p" 2>/dev/null || true; done
    BS=4M
fi

case "$IMG" in
    *.gz) reader=(gzip -dc "$IMG") ;;
    *) reader=(cat "$IMG") ;;
esac

echo ">> writing (a few minutes; sudo will ask for your password)"
if [ "$OS" = Darwin ]; then
    "${reader[@]}" | sudo dd of="$TARGET" bs="$BS"
    sync
    diskutil eject "/dev/$DISK" >/dev/null || true
else
    "${reader[@]}" | sudo dd of="$TARGET" bs="$BS" conv=fsync status=progress
fi
echo ">> done. Plug it into the target machine and boot from USB (UEFI, Secure Boot off)."
