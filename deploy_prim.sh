#!/usr/bin/env bash
# Deploiement du site prim.net (Cloudflare Pages, projet `prim`) avec le binaire local wrangler.
set -euo pipefail

SECRETS=/home/hermes/migration/secrets.env
TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN_PRIM=' "$SECRETS" | cut -d= -f2- | tr -d '"'"'"'')
if [ -z "$TOKEN" ]; then echo "ERREUR: token PRIM introuvable"; exit 1; fi

export CLOUDFLARE_API_TOKEN="$TOKEN"
export CLOUDFLARE_ACCOUNT_ID=3388543392cfb84433c27998f292c732

cd /home/hermes/migration/prim-site
exec ./node_modules/.bin/wrangler pages deploy dist --project-name prim --branch main --commit-dirty=true
