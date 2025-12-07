# NFT Dropper — Minting Setup & Run Guide

This document explains how to prepare the repo to mint tokens using the nft-dropper stack (docker-compose). It includes the fixed metadata file, env template, helper scripts, and run instructions.

---

## Files included (automatically prepared)
- `nft-source/metadata.json` — fixed (no trailing comma)
- `.env.template` — template for runtime env vars
- `.gitignore` — ignores keys and workdir
- `setup.sh` — creates placeholders and optionally generates keys
- `run-me-on-codex.sh` — wrapper for non-interactive setup

---

## Steps to prepare & run

1. **Edit .env**
   - Copy `.env.template` to `.env`
   - Set `WORKING_DIR_EXTERNAL` to an absolute host path (e.g., `/home/ubuntu/nft-dropper-work`)
   - Set `SELLER_ADDRESS` to your receiving ADA address (testnet or mainnet per `NETWORK`)
   - Save `.env` (do not commit)

2. **Prepare keys & nft-source**
   - Run `./run-me-on-codex.sh /absolute/path/to/workdir YOUR_SELLER_ADDRESS`
     - This runs `setup.sh` to create `nft-source` and placeholders and will generate keys if `cardano-cli` is installed.
   - If you do not have `cardano-cli`, generate keys in a machine/container that does and place:
     - `payment.vkey`, `payment.skey`
     - `policy.vkey`, `policy.skey`, `policy.script`, `policy.id`
     - into the host `WORKING_DIR_EXTERNAL` path

3. **Start the docker stack**
   ```bash
   sudo docker-compose up -d
   sudo docker-compose logs -f nft-dropper
   ```

* The UI will be available at `http://<host>:8080/`
* `static/scripts/scripts.js` polls `api/tokensLeft` and `api/address` to display state.

4. **Test the mint**

   * Ensure `ipfs` container is up.
   * Send buyer ADA to the `SELLER_ADDRESS` shown on UI with correct `TOKEN_PRICE * quantity`.
   * The dropper watches db-sync, builds and signs mint tx with `policy.skey` and `payment.skey`, and submits it.

---

## Troubleshooting & tips

* **JSON parse error**: If dropper logs show JSON errors, re-check `nft-source/metadata.json`.
* **IPFS connectivity**: Confirm `ipfs` container is up and reachable at `/dns4/ipfs/tcp/5001`.
* **db-sync not synced**: `cardano-db-sync` can take hours to sync on testnet; if unsynced vending will not occur.
* **File permissions**: Ensure the `nft-dropper` container can read keys in `WORKING_DIR_EXTERNAL`.
* **Security**: Never commit `.skey` or `.env` to git. Keep policy signing key offline in production, or use a secure signing flow.

---

## Security note

Treat `payment.skey` and `policy.skey` as secrets. Do not commit to repo or share. For production, use a hardware signing approach or secured signing service.
