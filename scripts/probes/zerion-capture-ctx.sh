#!/usr/bin/env bash
# A5 — Zerion ctx capture (multi-attempt, with flock + optional isolated install).
#
# WHY: the installed `zerion` CLI's policy dispatcher (run-policies.mjs)
# loads only scripts named in the active policy's `config.scripts` array.
# The Zerion-bundled "standard" policy points at deny-transfers.mjs.
# Dropping our probe into ~/.config/zerion/policies/ is therefore ignored,
# and `agent create-policy` in this CLI build has no flag to bind a custom
# script. The only path to invoke our `check(ctx)` is to swap the bundled
# deny-transfers.mjs for one tx, then restore.
#
# SAFETY:
#   1. DEFAULT MODE: `ZERION_ISOLATED=1` (now the default). Installs
#      zerion-cli into a disposable prefix at /tmp/sentinel-zerion-isolated.<pid>/
#      and patches only that copy. Your global install is never touched, and
#      concurrent `zerion` invocations from other terminals are unaffected.
#   2. ALWAYS restores the original via bash `trap restore EXIT INT TERM`
#      (Ctrl-C, SIGTERM, and normal error exits all restore). Bash traps
#      do NOT fire on SIGKILL / kill -9 — see scripts/probes/zerion-restore.sh
#      for emergency manual restore in that case.
#   3. OPT-OUT: `ZERION_GLOBAL=1` patches the global zerion-cli install
#      directly. We hold a `flock` for the patch window, but the lock only
#      serializes other instances of THIS script — ordinary `zerion`
#      commands in other terminals do NOT acquire the lock and CAN see
#      the patched script during the window. Use only when isolated mode
#      cannot be made to work (e.g., npm install fails in your environment).
#
# A5 ACCEPTANCE: this script is a tool. A5 is NOT closed by smoke-test
# output (synthetic ctx piped to the dispatcher proves wiring, not real
# Zerion runtime). A5 is closed only when a REAL `zerion` command produces
# /tmp/sentinel-zerion-ctx.json. The script labels these outcomes
# distinctly. See docs/A5-instructions.md "Acceptance criteria".
#
# Run from repo root:
#   pnpm probe:zerion                     # default: ISOLATED (safe)
#   ZERION_GLOBAL=1 pnpm probe:zerion     # opt-out: patches global install
#
# Optional env overrides:
#   ZERION_POL_DIR        — override auto-detected policies dir (global mode)
#   PROBE                 — override probe source (default: scripts/probes/zerion.mjs)
#   SENTINEL_PROBE_DUMP   — override dump path (default: /tmp/sentinel-zerion-ctx.json)
#   SENTINEL_PROBE_WALLET — wallet name (default: sentinelbot)
#   SENTINEL_A5_SCENARIO  — discovery | swap-first | swap-only | sign-first (default: discovery)
#   SENTINEL_SWAP_CMD     — remainder after `zerion` for swap attempt (scenario swap-*)
#   SENTINEL_A5_GLOBAL_CONFIRM — "1" skips the global-mode interactive confirmation
#   ZERION_GLOBAL         — "1" to patch global install instead of using disposable prefix
#   ZERION_ISOLATED       — "1" forces isolated mode (now the default; kept for backwards compat)

set -euo pipefail

# Default to isolated; ZERION_GLOBAL=1 opts out. ZERION_ISOLATED=1 also opts in
# (legacy). If both unset, isolated wins (safe default).
GLOBAL_OPT_OUT="${ZERION_GLOBAL:-0}"
LEGACY_ISOLATED="${ZERION_ISOLATED:-1}"
if [[ "$GLOBAL_OPT_OUT" == "1" ]]; then
  ISOLATED=0
elif [[ "$LEGACY_ISOLATED" == "0" ]]; then
  ISOLATED=0
else
  ISOLATED=1
fi
PREFIX=""
ZERION_BIN="zerion"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE="${PROBE:-$REPO_ROOT/scripts/probes/zerion.mjs}"
DUMP="${SENTINEL_PROBE_DUMP:-/tmp/sentinel-zerion-ctx.json}"
WALLET="${SENTINEL_PROBE_WALLET:-sentinelbot}"
LOG="/tmp/sentinel-zerion-attempts.log"
EVIDENCE="/tmp/sentinel-a5-evidence.txt"

SCENARIO="${SENTINEL_A5_SCENARIO:-discovery}"
GLOBAL_CONFIRM="${SENTINEL_A5_GLOBAL_CONFIRM:-0}"

SWAP_CMD_DEFAULT="swap eth usdc 0.001 --chain base --wallet $WALLET --pretty"
SWAP_CMD="${SENTINEL_SWAP_CMD:-$SWAP_CMD_DEFAULT}"

cyan()    { printf "\033[36m%s\033[0m\n" "$*"; }
green()   { printf "\033[32m%s\033[0m\n" "$*"; }
yellow()  { printf "\033[33m%s\033[0m\n" "$*"; }
red()     { printf "\033[31m%s\033[0m\n" "$*"; }
bold_red(){ printf "\033[1;31m%s\033[0m\n" "$*"; }
dim()     { printf "\033[2m%s\033[0m\n" "$*"; }

if [[ ! -f "$PROBE" ]]; then
  red "[A5] ERROR: probe not at $PROBE"
  exit 1
fi
if ! command -v zerion >/dev/null 2>&1; then
  red "[A5] ERROR: zerion not on PATH"
  exit 1
fi
if ! command -v flock >/dev/null 2>&1; then
  red "[A5] ERROR: \`flock\` not available (needed for safe patch serialization)"
  red "       Install: sudo apt-get install -y util-linux"
  exit 1
fi

# ─── Mode A: isolated prefix (opt-in via ZERION_ISOLATED=1) ──────────────────
if [[ "$ISOLATED" == "1" ]]; then
  PREFIX="/tmp/sentinel-zerion-isolated.$$"
  yellow "[A5] ZERION_ISOLATED=1 → installing zerion-cli into $PREFIX (your global install is untouched)"
  mkdir -p "$PREFIX"
  if ! npm install --prefix "$PREFIX" zerion-cli >/tmp/sentinel-zerion-install.log 2>&1; then
    red "[A5] npm install in isolated prefix failed; see /tmp/sentinel-zerion-install.log"
    rm -rf "$PREFIX"
    exit 1
  fi
  ZERION_BIN="$PREFIX/node_modules/.bin/zerion"
  ZERION_POL_DIR="$PREFIX/node_modules/zerion-cli/cli/policies"
  if [[ ! -x "$ZERION_BIN" ]] || [[ ! -d "$ZERION_POL_DIR" ]]; then
    red "[A5] isolated install layout differs from expectation — bailing"
    rm -rf "$PREFIX"
    exit 1
  fi
  green "[A5] isolated zerion : $ZERION_BIN"
  green "[A5] isolated policy : $ZERION_POL_DIR"
else
  ZERION_POL_DIR="${ZERION_POL_DIR:-$(npm root -g 2>/dev/null)/zerion-cli/cli/policies}"
fi

TARGET="$ZERION_POL_DIR/deny-transfers.mjs"
DISPATCHER="$ZERION_POL_DIR/run-policies.mjs"
LOCK="$ZERION_POL_DIR/.sentinel-a5.lock"
BACKUP="/tmp/deny-transfers.mjs.bak.$$"

if [[ ! -f "$TARGET" ]]; then
  red "[A5] ERROR: $TARGET not found"
  [[ "$ISOLATED" == "1" ]] && rm -rf "$PREFIX"
  exit 1
fi

# Restore on any exit. Cleans up isolated prefix too.
restore() {
  local exit_code=$?
  if [[ -f "$BACKUP" ]]; then
    cp "$BACKUP" "$TARGET" && rm -f "$BACKUP" \
      && green "[A5] restored $TARGET" \
      || red "[A5] WARN: restore failed; backup at $BACKUP — restore manually"
  fi
  if [[ "$ISOLATED" == "1" && -n "$PREFIX" && -d "$PREFIX" ]]; then
    rm -rf "$PREFIX" && dim "[A5] cleaned isolated prefix $PREFIX"
  fi
  rm -f "$LOCK" 2>/dev/null || true
  exit "$exit_code"
}
trap restore EXIT INT TERM

if [[ "$ISOLATED" != "1" ]]; then
  bold_red "[A5] WARNING — GLOBAL MODE — your global zerion-cli install will be patched."
  bold_red "             flock serializes other instances of THIS script, but it does"
  bold_red "             NOT block ordinary \`zerion\` commands run from other terminals"
  bold_red "             during the patch window. Close other zerion sessions, or abort"
  bold_red "             and run as:    pnpm probe:zerion    (default = isolated)."
  echo
  if [[ "$GLOBAL_CONFIRM" == "1" ]]; then
    yellow "[A5] SENTINEL_A5_GLOBAL_CONFIRM=1 — skipping interactive confirmation."
  else
    read -r -p "[A5] Continue with global patch anyway? (y/N) " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      red "[A5] aborted by user — omit ZERION_GLOBAL=1 for isolated mode"
      exit 1
    fi
  fi
fi

cyan "[A5] policies dir : $ZERION_POL_DIR"
cyan "[A5] target       : $TARGET"
cyan "[A5] dispatcher   : $DISPATCHER"
cyan "[A5] mode         : $([[ "$ISOLATED" == "1" ]] && echo "ISOLATED" || echo "GLOBAL+FLOCK")"
cyan "[A5] scenario    : $SCENARIO"
if [[ "$SCENARIO" == swap-first || "$SCENARIO" == swap-only ]]; then
  cyan "[A5] swap cmd    : $SWAP_CMD"
fi

# Acquire flock on a custom file in the policies dir.
# IMPORTANT: this is NOT a global zerion lock. It only serializes other
# instances of THIS script. Ordinary `zerion` commands in other terminals
# do not acquire this lock and ARE NOT blocked by it. The lock prevents
# two parallel runs of the capture script from clobbering each other's
# backup; it is not a substitute for isolated mode.
if [[ "$ISOLATED" != "1" ]]; then
  exec 200>"$LOCK"
  if ! flock -x -w 30 200; then
    red "[A5] ERROR: could not acquire $LOCK after 30s — another instance of"
    red "       this script may be running. Aborting to avoid backup clobber."
    exit 1
  fi
  green "[A5] acquired script-mutex flock on $LOCK"
fi

cyan "[A5] backup       : $TARGET → $BACKUP"
cp "$TARGET" "$BACKUP"

cyan "[A5] patch        : $PROBE → $TARGET"
cp "$PROBE" "$TARGET"

rm -f "$DUMP" "$LOG"
touch "$LOG"

DEAD_EVM="0x000000000000000000000000000000000000dEaD"

# Multi-attempt. First successful dump exits.
declare -a ATTEMPTS=()

case "$SCENARIO" in
  discovery)
    ATTEMPTS=(
      "sign-message sentinel-probe-test --chain ethereum --wallet $WALLET --pretty"
      "sign-message sentinel-probe-test --chain solana --wallet $WALLET --pretty"
      "send eth 0.001 --to $DEAD_EVM --chain base --wallet $WALLET --pretty"
      "send usdc 0.001 --to $DEAD_EVM --chain base --wallet $WALLET --pretty"
      "$SWAP_CMD"
    )
    ;;
  swap-first)
    ATTEMPTS=(
      "$SWAP_CMD"
      "sign-message sentinel-probe-test --chain ethereum --wallet $WALLET --pretty"
      "sign-message sentinel-probe-test --chain solana --wallet $WALLET --pretty"
      "send eth 0.001 --to $DEAD_EVM --chain base --wallet $WALLET --pretty"
      "send usdc 0.001 --to $DEAD_EVM --chain base --wallet $WALLET --pretty"
    )
    ;;
  swap-only)
    ATTEMPTS=("$SWAP_CMD")
    ;;
  sign-first)
    ATTEMPTS=(
      "sign-message sentinel-probe-test --chain ethereum --wallet $WALLET --pretty"
      "sign-message sentinel-probe-test --chain solana --wallet $WALLET --pretty"
      "$SWAP_CMD"
      "send eth 0.001 --to $DEAD_EVM --chain base --wallet $WALLET --pretty"
    )
    ;;
  *)
    red "[A5] ERROR: unknown SENTINEL_A5_SCENARIO=$SCENARIO"
    red "       Use: discovery | swap-first | swap-only | sign-first"
    exit 1
    ;;
esac

i=0
for cmd in "${ATTEMPTS[@]}"; do
  i=$((i + 1))
  echo
  cyan "[A5] attempt $i/${#ATTEMPTS[@]}: $ZERION_BIN $cmd"
  yellow "[A5] (probe denies after dump → expected output may include 'Sentinel probe' rejection)"
  rm -f "$DUMP"
  {
    echo "═══ attempt $i: $ZERION_BIN $cmd ═══"
    "$ZERION_BIN" $cmd 2>&1 || true
  } | tee -a "$LOG"

  if [[ -f "$DUMP" ]]; then
    bytes=$(wc -c <"$DUMP")
    green "[A5] OK — captured $bytes bytes via attempt $i"
    {
      echo "A5 evidence — captured $(date -Iseconds)"
      echo "Mode      : $([[ "$ISOLATED" == "1" ]] && echo "ISOLATED" || echo "GLOBAL+FLOCK")"
      echo "Command   : $ZERION_BIN $cmd"
      echo "Dump path : $DUMP ($bytes bytes)"
      echo
      echo "═══ stdout/stderr ═══"
      grep -A 1000 "═══ attempt $i:" "$LOG" | head -200
      echo
      echo "═══ first 80 lines of dump ═══"
      head -80 "$DUMP"
    } >"$EVIDENCE"
    echo
    cyan "[A5] First 80 lines of $DUMP:"
    head -80 "$DUMP"
    echo
    green "[A5] DONE — A5 acceptance criteria met (real command produced ctx)."
    cyan "      • dump      : $DUMP"
    cyan "      • evidence  : $EVIDENCE (command + stdout + dump head, for the record)"
    cyan "      • full log  : $LOG"
    cyan "      Paste $DUMP back into Claude Code to finish A5."
    exit 0
  fi
  dim "[A5] no dump from attempt $i — trying next…"
done

# No real command worked. Run smoke as a DIAGNOSTIC ONLY — this proves the
# patch+probe+dispatcher chain is wired correctly even if the CLI never
# called the dispatcher on any of our commands. Smoke output is NOT a
# substitute for real ctx and does NOT close A5.
echo
yellow "[A5] all CLI attempts bailed before policy eval."
yellow "[A5] running SMOKE TEST (DIAGNOSTIC ONLY — does not satisfy A5)…"

if [[ ! -f "$DISPATCHER" ]]; then
  red "[A5] dispatcher not found at $DISPATCHER — install layout differs."
  exit 2
fi

SMOKE_DUMP="/tmp/sentinel-smoke-ctx.json"
rm -f "$SMOKE_DUMP"
echo '{"transaction":{"chain":"solana","from":"smoke","to":"smoke","data":"00","value":"0"},"policy_config":{"scripts":["deny-transfers.mjs"]}}' \
  | (cd "$ZERION_POL_DIR" && SENTINEL_PROBE_DUMP="$SMOKE_DUMP" node run-policies.mjs) \
  >/tmp/sentinel-smoke-stdout.txt 2>/tmp/sentinel-smoke-stderr.txt || true

echo
if [[ -f "$SMOKE_DUMP" ]]; then
  yellow "═══════════════════════════════════════════════════════════════════"
  yellow " SMOKE TEST PASSED  ⚠  DIAGNOSTIC ONLY — A5 IS *NOT* CLOSED"
  yellow "═══════════════════════════════════════════════════════════════════"
  bold_red "[A5] A5 is NOT complete — smoke output is synthetic ctx, not Zerion runtime ctx."
  echo
  cyan "[A5] What smoke proves :"
  echo "       • patching deny-transfers.mjs works"
  echo "       • dispatcher loads our script and calls check(ctx)"
  echo "       • probe writes the dump on invocation"
  cyan "[A5] What smoke does NOT prove :"
  echo "       • that any real \`zerion\` command actually invokes the dispatcher"
  echo "       • the actual ctx shape Zerion sends in production runtime"
  echo
  cyan "[A5] Next steps to close A5 :"
  echo "       1) cat /tmp/sentinel-zerion-attempts.log     # see why each command bailed"
  echo "       2) zerion sign-message --help | tee /tmp/zerion-sign-help.txt"
  echo "       3) zerion send --help | tee /tmp/zerion-send-help.txt"
  echo "       4) Paste those into Claude Code; we'll pick a working command shape."
  echo "       5) If no command shape ever invokes policy in this CLI build, A5 is"
  echo "          BLOCKED by the alpha CLI surface — document with logs as evidence."
else
  red "[A5] SMOKE TEST FAILED — patch path not loaded as expected."
  red "      Inspect: cat /tmp/sentinel-smoke-stderr.txt"
  red "               head -100 $DISPATCHER"
fi

exit 2
