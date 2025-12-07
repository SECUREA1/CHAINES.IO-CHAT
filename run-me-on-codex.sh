#!/usr/bin/env bash
set -euo pipefail
# run-me-on-codex.sh - non-interactive wrapper for Codex
# Usage:
#   ./run-me-on-codex.sh /absolute/path/to/workdir "addr_test1...."
#
# This will:
# - copy .env.template -> .env (replace WORKING_DIR_EXTERNAL and SELLER_ADDRESS)
# - run setup.sh to create nft-source and keys (if cardano-cli installed)
# - print final instructions.

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 /absolute/path/to/workdir SELLER_ADDRESS"
  exit 1
fi

WORKDIR=$(realpath "$1")
SELLER_ADDRESS="$2"

# copy env template
if [ ! -f .env.template ]; then
  echo ".env.template not found. Aborting."
  exit 1
fi

cp .env.template .env
# replace placeholders
sed -i.bak "s|WORKING_DIR_EXTERNAL=/absolute/path/to/nft-dropper-work|WORKING_DIR_EXTERNAL=${WORKDIR}|g" .env
sed -i.bak "s|SELLER_ADDRESS=addr_test1...REPLACE_WITH_YOUR_ADDRESS|SELLER_ADDRESS=${SELLER_ADDRESS}|g" .env
rm -f .env.bak

# run setup.sh
chmod +x setup.sh
./setup.sh "$WORKDIR"

echo ""
echo "Now start the stack:"
echo "  sudo docker-compose up -d"
echo ""
echo "Follow logs:"
echo "  sudo docker-compose logs -f nft-dropper"
echo ""
echo "If cardano-cli was present, keys were created in $WORKDIR."
echo "Make sure $WORKDIR is the same path configured in .env as WORKING_DIR_EXTERNAL."
