#!/bin/sh
# Hash BASIC_AUTH_PASSWORD (plain, from .env per CLAUDE.md's contract) into
# the bcrypt hash Caddy's basic_auth directive actually requires, then hand
# off to the real caddy entrypoint. Runs on every container start — cheap,
# and keeps the plaintext password out of the Caddyfile and image layers.
set -eu

if [ -z "${BASIC_AUTH_USER:-}" ] || [ -z "${BASIC_AUTH_PASSWORD:-}" ]; then
	echo "caddy: BASIC_AUTH_USER and BASIC_AUTH_PASSWORD must be set in .env — refusing to start with the UI unprotected." >&2
	exit 1
fi

export BASIC_AUTH_PASSWORD_HASH="$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")"

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
