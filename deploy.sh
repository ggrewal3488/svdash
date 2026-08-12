#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SVDash TV deployment
#
# For each room's Android TV: connect over ADB (network), install the APK,
# and provision its room number headlessly via the "room" intent extra
# (handled by MainActivity.applyRoomExtra).
#
# Usage:
#   ./deploy.sh            # deploy to every room in the table
#   ./deploy.sh 103        # deploy to a single room
#   BUILD_TYPE=release ./deploy.sh
#   CUTOVER=1 BUILD_TYPE=release ./deploy.sh   # one-time debug -> release handoff
#
# CUTOVER=1 (only meaningful with BUILD_TYPE=release) additionally makes the
# release app the default HOME app via `pm set-home-activity` and uninstalls
# the sibling debug app (com.stayvista.svdash.debug) so it stops competing
# for BOOT_COMPLETED/HOME. The release and debug builds have different
# application IDs, so this first switch-over is a fresh install + handoff,
# not an in-place update -- ordinary `BUILD_TYPE=release ./deploy.sh` runs
# after that are real updates and don't need CUTOVER=1 again.
#
# Env overrides: ADB, ADB_PORT, BUILD_TYPE, CUTOVER
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
ADB_PORT="${ADB_PORT:-5555}"
BUILD_TYPE="${BUILD_TYPE:-debug}"     # debug | release
CUTOVER="${CUTOVER:-0}"               # 1 = also hand off default-launcher + drop the debug app
DEBUG_PKG="com.stayvista.svdash.debug"

if [ "$BUILD_TYPE" = "release" ]; then
  APK="app/build/outputs/apk/release/app-release.apk"
  PKG="com.stayvista.svdash"          # release: no id suffix
else
  APK="app/build/outputs/apk/debug/app-debug.apk"
  PKG="$DEBUG_PKG"                    # debug applicationIdSuffix ".debug"
fi
ACTIVITY="$PKG/com.stayvista.svdash.MainActivity"

# room  ip   (see MEMORY: tv-room-ip-map)
# NOTE: this table only covers floor 1 (101-108). ProvisioningManager.kt's
# IP_ROOM_MAP covers 101-109/201-209/301-309/401-409 (35 rooms) -- sync this
# list with that map before running a property-wide cutover, unless floors
# 2-4 are intentionally not live yet.
ROOMS="\
101 192.168.10.17
102 192.168.10.18
103 192.168.10.19
104 192.168.10.20
105 192.168.10.21
106 192.168.10.22
107 192.168.10.23
108 192.168.10.24"

[ -x "$ADB" ] || { echo "adb not found/executable at: $ADB"; exit 1; }
[ -f "$APK" ] || { echo "APK not found: $APK  (build it first)"; exit 1; }

FILTER="${1:-all}"

deploy_one() {
  local room="$1" ip="$2" target="$2:$ADB_PORT"
  echo "==> Room $room  ($target)"

  if ! "$ADB" connect "$target" | grep -qE "connected|already"; then
    echo "    !! could not connect to $target — skipping"
    return 1
  fi

  echo "    installing $APK"
  "$ADB" -s "$target" install -r "$APK"

  echo "    provisioning room=$room"
  "$ADB" -s "$target" shell am start -n "$ACTIVITY" --es room "$room" >/dev/null

  if [ "$BUILD_TYPE" = "release" ] && [ "$CUTOVER" = "1" ]; then
    echo "    setting default HOME app -> $ACTIVITY"
    "$ADB" -s "$target" shell cmd package set-home-activity "$ACTIVITY" || \
      echo "    !! set-home-activity failed — set it manually on this TV"

    echo "    removing sibling debug app ($DEBUG_PKG)"
    "$ADB" -s "$target" uninstall "$DEBUG_PKG" || \
      echo "    (no debug app installed, or uninstall failed — check manually)"
  fi

  "$ADB" disconnect "$target" >/dev/null 2>&1 || true
  echo "    done"
}

rc=0
while read -r room ip; do
  [ -z "${room:-}" ] && continue
  if [ "$FILTER" = "all" ] || [ "$FILTER" = "$room" ]; then
    deploy_one "$room" "$ip" || rc=1
  fi
done <<< "$ROOMS"

exit $rc
