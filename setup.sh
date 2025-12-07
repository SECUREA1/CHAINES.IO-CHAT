#!/usr/bin/env bash
set -euo pipefail
# setup.sh - prepares nft-source, placeholder images, and optionally generates cardano keys
#
# Usage:
#   ./setup.sh /absolute/path/to/workdir
# If no arg provided, uses ./work in the repo.

WORKDIR_ARG=${1:-./work}
WORKDIR=$(realpath "$WORKDIR_ARG")
echo "WORKDIR will be: $WORKDIR"

# 1) create nft-source and metadata.json (fixed)
mkdir -p nft-source
cat > nft-source/metadata.json <<'JSON'
{
  "NFT_0001.jpg": {
    "name": "CryptoPeep #01",
    "artist": "Benzega",
    "homepage": "https://www.cryptopeeps.io",
    "Properties": {
      "Expression": "Grin",
      "Facial Hair": "Amish"
    },
    "description": "One-of-a-kind pop art pixel peep living on the blockchain!",
    "mediaType": "image/jpeg"
  },
  "NFT_0002.jpg": {
    "name": "CryptoPeep #02",
    "artist": "Benzega",
    "homepage": "https://www.cryptopeeps.io",
    "Properties": {
      "Expression": "Grin",
      "Facial Hair": "Amish"
    },
    "description": "One-of-a-kind pop art pixel peep living on the blockchain!",
    "mediaType": "image/jpeg"
  },
  "NFT_0003.jpg": {
    "name": "CryptoPeep #03",
    "artist": "Benzega",
    "homepage": "https://www.cryptopeeps.io",
    "Properties": {
      "Expression": "Grin",
      "Facial Hair": "Amish"
    },
    "description": "One-of-a-kind pop art pixel peep living on the blockchain!",
    "mediaType": "image/jpeg"
  },
  "NFT_0004.jpg": {
    "name": "CryptoPeep #04",
    "artist": "Benzega",
    "homepage": "https://www.cryptopeeps.io",
    "Properties": {
      "Expression": "Grin",
      "Facial Hair": "Amish"
    },
    "description": "One-of-a-kind pop art pixel peep living on the blockchain!",
    "mediaType": "image/jpeg"
  }
}
JSON

# 2) Create placeholder images if none exist
if command -v convert >/dev/null 2>&1; then
  echo "Using ImageMagick to create placeholder JPEGs."
  for i in 1 2 3 4; do
    filename="nft-source/NFT_000${i}.jpg"
    if [ ! -f "$filename" ]; then
      convert -size 1024x1024 xc:navy -gravity center -pointsize 72 -fill white \
        -annotate +0+0 "NFT_000${i}" "$filename"
      echo "Created $filename"
    fi
  done
else
  echo "ImageMagick convert not found — trying Python PIL"
  python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
import os
os.makedirs("nft-source", exist_ok=True)
for i in range(1,5):
    fn=f"nft-source/NFT_000{i}.jpg"
    if not os.path.exists(fn):
        img=Image.new("RGB",(1024,1024),(10,10,80))
        d=ImageDraw.Draw(img)
        try:
            f=ImageFont.truetype("DejaVuSans-Bold.ttf",72)
        except:
            f=None
        text=f"NFT_000{i}"
        w,h=d.textsize(text,font=f)
        d.text(((1024-w)/2,(1024-h)/2),text,fill=(255,255,255),font=f)
        img.save(fn,"JPEG")
        print("Created",fn)
PY
fi

# 3) Create workdir skeleton
mkdir -p "$WORKDIR"
echo "Created workdir skeleton: $WORKDIR"

# 4) Optionally generate keys with cardano-cli if available
if command -v cardano-cli >/dev/null 2>&1; then
  echo "cardano-cli found — generating keys"
  pushd "$WORKDIR" >/dev/null
  # Payment key
  cardano-cli address key-gen \
    --verification-key-file payment.vkey \
    --signing-key-file payment.skey
  # Policy key
  cardano-cli address key-gen \
    --verification-key-file policy.vkey \
    --signing-key-file policy.skey
  # Policy key hash and script
  POLICY_KEY_HASH=$(cardano-cli address key-hash --payment-verification-key-file policy.vkey)
  cat > policy.script <<EOT
{
  "type": "sig",
  "keyHash": "${POLICY_KEY_HASH}"
}
EOT
  cardano-cli transaction policyid --script-file policy.script > policy.id
  echo "Generated keys and policy in $WORKDIR"
  popd >/dev/null
else
  echo "cardano-cli not found — skipping key generation. You must generate keys manually or in a container with cardano-cli."
fi

echo ""
echo "NEXT STEPS:"
echo "1) Copy or set WORKING_DIR_EXTERNAL in .env to: $WORKDIR"
echo "2) Start the compose stack: sudo docker-compose up -d"
echo "3) Check nft-dropper logs: sudo docker-compose logs -f nft-dropper"
echo ""
echo "Files created:"
ls -la "$WORKDIR" || true
ls -la nft-source || true
