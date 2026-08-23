#!/bin/sh
# Basic auth is OPTIONAL. If BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are both
# set, hash the password (plain, from .env) into the bcrypt hash Caddy's
# basic_auth directive requires and write the auth snippet. If they are unset
# or empty, write an empty snippet and serve the site with no auth — for
# private/locked-down deployments set both vars (see DEPLOY.md).
set -eu

AUTH_SNIPPET=/etc/caddy/auth.caddy

if [ -n "${BASIC_AUTH_USER:-}" ] && [ -n "${BASIC_AUTH_PASSWORD:-}" ]; then
	export BASIC_AUTH_PASSWORD_HASH="$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")"
	printf 'basic_auth {\n\t{$BASIC_AUTH_USER} {$BASIC_AUTH_PASSWORD_HASH}\n}\n' > "$AUTH_SNIPPET"
	echo "caddy: basic auth enabled for user \${BASIC_AUTH_USER}"
else
	: > "$AUTH_SNIPPET"
	echo "caddy: BASIC_AUTH_USER/PASSWORD not set — serving with NO authentication."
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
