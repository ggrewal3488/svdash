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

# room  ip   (see MEMORY: tv-room-ip-map; kept in sync with
# ProvisioningManager.IP_ROOM_MAP -- update both together)
ROOMS="\
101 192.168.10.17
102 192.168.10.18
103 192.168.10.19
104 192.168.10.20
105 192.168.10.21
106 192.168.10.22
107 192.168.10.23
108 192.168.10.24
109 192.168.10.25
201 192.168.10.26
203 192.168.10.28
204 192.168.10.29
205 192.168.10.30
206 192.168.10.31
207 192.168.10.32
208 192.168.10.33
209 192.168.10.34
301 192.168.10.35
302 192.168.10.36
303 192.168.10.37
304 192.168.10.38
305 192.168.10.39
306 192.168.10.40
307 192.168.10.41
308 192.168.10.42
309 192.168.10.43
401 192.168.10.44
402 192.168.10.45
403 192.168.10.50
404 192.168.10.47
405 192.168.10.48
406 192.168.10.27
407 192.168.10.46
408 192.168.10.51
409 192.168.10.52"

[ -x "$ADB" ] || { echo "adb not found/executable at: $ADB"; exit 1; }
[ -f "$APK" ] || { echo "APK not found: $APK  (build it first)"; exit 1; }

FILTER="${1:-all}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-8}"     # seconds; macOS has no `timeout(1)`, so we roll our own
INSTALL_TIMEOUT="${INSTALL_TIMEOUT:-90}"    # seconds; a wedged streamed install can otherwise hang forever

# Portable bounded-wait wrapper: "$@" is backgrounded and killed if it
# outdoes $1 seconds. Needed because `adb connect` to a host that's
# unreachable-but-not-actively-refusing (no RST) can hang on the TCP
# handshake far longer than the ROOMS table has patience for, stalling
# the whole fleet rollout behind one dead TV.
with_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return $rc
}

deploy_one() {
  local room="$1" ip="$2" target="$2:$ADB_PORT"
  echo "==> Room $room  ($target)"

  if ! with_timeout "$CONNECT_TIMEOUT" "$ADB" connect "$target" | grep -qE "connected|already"; then
    echo "    !! could not connect to $target (within ${CONNECT_TIMEOUT}s) — skipping"
    return 1
  fi

  echo "    installing $APK"
  if ! with_timeout "$INSTALL_TIMEOUT" "$ADB" -s "$target" install -r "$APK" </dev/null; then
    echo "    !! install timed out/failed after ${INSTALL_TIMEOUT}s — skipping rest of this room"
    "$ADB" disconnect "$target" >/dev/null 2>&1 || true
    return 1
  fi

  echo "    provisioning room=$room"
  "$ADB" -s "$target" shell am start -n "$ACTIVITY" --es room "$room" >/dev/null </dev/null

  if [ "$BUILD_TYPE" = "release" ] && [ "$CUTOVER" = "1" ]; then
    echo "    setting default HOME app -> $ACTIVITY"
    "$ADB" -s "$target" shell cmd package set-home-activity "$ACTIVITY" </dev/null || \
      echo "    !! set-home-activity failed — set it manually on this TV"

    echo "    removing sibling debug app ($DEBUG_PKG)"
    "$ADB" -s "$target" uninstall "$DEBUG_PKG" || \
      echo "    (no debug app installed, or uninstall failed — check manually)"
  fi

  "$ADB" disconnect "$target" >/dev/null 2>&1 || true
  echo "    done"
}

rc=0
# Read room list from fd 3, not stdin (fd 0) -- `adb shell` inside deploy_one
# forwards stdin to the device by default, and would otherwise swallow the
# rest of $ROOMS after the first iteration.
while read -r room ip <&3; do
  [ -z "${room:-}" ] && continue
  if [ "$FILTER" = "all" ] || [ "$FILTER" = "$room" ]; then
    deploy_one "$room" "$ip" || rc=1
  fi
done 3<<< "$ROOMS"

exit $rc
