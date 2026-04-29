#!/usr/bin/env bash
# Decrypt an age-encrypted secrets file into the systemd EnvironmentFile
# location, then exec the next argv. Designed to be the entrypoint of the
# owl.service unit on Proxmox.
#
#   Usage:
#     scripts/age-decrypt-env.sh <ciphertext> <out-env> <identity> -- <cmd ...>
#
#   - ciphertext: armored or binary age file containing KEY=value lines
#   - out-env:    target file. Written 0600 with the decrypted contents.
#                 Removed on exit.
#   - identity:   path to the age private key (X25519). Kept outside the repo.
set -euo pipefail

if [ "$#" -lt 5 ]; then
  echo "usage: $0 <ciphertext> <out-env> <identity> -- <cmd ...>" >&2
  exit 64
fi

CIPHER="$1"; OUT="$2"; IDENT="$3"; shift 3
if [ "$1" != "--" ]; then
  echo "expected '--' separator before command" >&2
  exit 64
fi
shift

if [ ! -r "$CIPHER" ]; then
  echo "ciphertext not readable: $CIPHER" >&2
  exit 66
fi
if [ ! -r "$IDENT" ]; then
  echo "identity not readable: $IDENT" >&2
  exit 66
fi
if ! command -v age >/dev/null 2>&1; then
  echo "age binary missing" >&2
  exit 69
fi

umask 077
TMP="$(mktemp "${OUT}.XXXXXX")"
trap 'rm -f "$TMP" "$OUT"' EXIT
age --decrypt -i "$IDENT" -o "$TMP" "$CIPHER"
mv -f "$TMP" "$OUT"
chmod 600 "$OUT"

# Load decrypted env into our own environment for exec.
set -a
# shellcheck disable=SC1090
source "$OUT"
set +a

exec "$@"
