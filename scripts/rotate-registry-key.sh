#!/usr/bin/env bash
#
# Generate the Ed25519 keypair the MCP registry uses to prove we own
# greencalculus.com, and install the private half as a repo secret.
#
# We publish as com.greencalculus/api — a DNS namespace. GitHub OIDC only ever
# grants io.github.<org>/*, so the release workflow authenticates with this key
# instead, and it must match the v=MCPv1 TXT record on the domain.
#
# The private key is piped straight into `gh secret set`. It is never printed,
# never written outside a temp dir, and the temp dir is removed on exit.
#
# Usage:  ./scripts/rotate-registry-key.sh
# Then:   replace the v=MCPv1 TXT record with the line this prints.

set -euo pipefail

REPO="greencalculus/greencalculus-mcp"
DOMAIN="greencalculus.com"

command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

openssl genpkey -algorithm ed25519 -out "$TMP/key.pem" 2>/dev/null

# Ed25519 DER ends with the raw 32-byte seed; the registry wants it as hex.
HEX=$(openssl pkey -in "$TMP/key.pem" -outform DER 2>/dev/null | tail -c 32 | xxd -p -c 64)
PUB=$(openssl pkey -in "$TMP/key.pem" -pubout -outform DER 2>/dev/null | tail -c 32 | base64)

[ "${#HEX}" -eq 64 ] || { echo "private key is ${#HEX} hex chars, expected 64" >&2; exit 1; }
[ "${#PUB}" -eq 44 ] || { echo "public key is ${#PUB} base64 chars, expected 44" >&2; exit 1; }

printf '%s' "$HEX" | gh secret set MCP_PRIVATE_KEY --repo "$REPO"

cat <<EOF

Secret MCP_PRIVATE_KEY is set on $REPO.

Last step — replace the existing v=MCPv1 TXT record on $DOMAIN with:

  v=MCPv1; k=ed25519; p=$PUB

Publishing stays broken until that record matches, because the registry
verifies the signature against whatever the domain currently advertises.
EOF
