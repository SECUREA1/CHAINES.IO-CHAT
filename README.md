# CHAINeS Composer

Single-page chat client for chaines.io with optional WebSocket backend and
persistent chat history.

## Deploying on Render

1. **Static site**
   - Type: *Static Site*
   - Build Command: *(leave blank)*
   - Publish Directory: `.`

2. **WebSocket server** (optional)
   - Type: *Web Service*
   - Build Command: `npm ci`
   - Start Command: `node server.js`
   - Health Check Path: `/healthz`

The WebSocket endpoint will be available at `wss://<service-name>.onrender.com/ws`.
Configure this URL in the client via the "configure" button on the welcome screen.

### Persistent chat history

Chat messages, including attachments, are stored in the `app.db` SQLite
database. The server sends the full history to new connections and broadcasts
the number of currently connected users so the client can display a live online
count.

### Attachments

Chat messages can include images, videos, or other files. Uploads are stored in
the database along with the original filename and MIME type so the full post and
its metadata are available to other users and when reloading the chat.

### Captions

Video broadcasts and uploads now include a **CC** button by default. Users can
customize caption appearance with adjustable fonts and colors to suit personal
readability preferences. Caption tracks ship in multiple languages including
English, Portuguese/English bilingual, Korean, and Arabic/English bilingual for
improved accuracy.

### Voice-to-text captions

Live video broadcasts automatically generate captions using the browser's
SpeechRecognition API. When you start broadcasting, your spoken audio is
transcribed into caption cues shown on the stream, adapting to the language
configured for the page.

### Screen sharing

Use the screen button in the header to broadcast either your entire screen or a specific window. You can trigger it while live to replace your camera feed, and click the button again to stop sharing and return to the camera. After choosing a surface, a thumbnail is captured and the stream begins broadcasting to other users.

### File-type backups

Run `python backup.py` to copy repository files into the `backups/` directory.
The script uses the same backup process for every file type, storing each
extension in its own subdirectory and preserving metadata so all files retain
their information.

## Hologhost vending

Wallet-connected users can request Hologhost tokens directly from the Cardano
pool via the built-in vending flow. Configure the following environment
variables on the WebSocket server service:

- `HOLOGHOST_VENDING_URL` – HTTPS endpoint that accepts vending requests in the
  form `{ "address": "addr...", "policyId": "...", "assetNameHex": "..." }`.
- `HOLOGHOST_VENDING_API_KEY` – Optional bearer token sent as the
  `Authorization` header.

When the vending URL is unset the server operates in simulation mode unless a
direct Cardano vending configuration is provided. Transfers are recorded locally
and surfaced to the UI but no blockchain calls are made.

### Direct on-chain vending

You can vend Hologhost tokens straight from a custodial wallet without relying
on an external HTTPS vending API. Provide the following environment variables to
enable live transfers:

- `BLOCKFROST_PROJECT_ID` – Blockfrost project ID for the selected network.
- `CARDANO_NETWORK` – Network name (`Mainnet`, `Preprod`, or `Preview`). Defaults
  to `Mainnet`.
- `HOLOGHOST_VENDING_PAYMENT_SKEY` – Payment signing key (CBOR hex or bech32
  string) that controls the vending wallet. Provide an enterprise payment key
  derived for the vending address.
- `HOLOGHOST_VENDING_MIN_ADA` – Optional lovelace value to include with each
  transfer (defaults to `2000000`).
- `HOLOGHOST_VENDING_AWAIT_CONFIRMATION` – Set to `true` to wait for chain
  confirmation before responding.

With these variables configured the server crafts and submits transactions using
`lucid-cardano`, ensuring the requested policy ID and asset name are delivered
directly to the requesting wallet address.

The client exposes `GhostWallet.grantGhostToken()` and
`GhostWallet.refreshGhostTokenCount()` helpers for integrating custom UI flows.
Both endpoints are also available directly:

- `POST /api/hologhosts/dispense` – Initiates a transfer to the provided
  Cardano address.
- `POST /api/hologhosts/status` – Returns the number of successful transfers
  recorded for the address.

## NFT dropper integration

Files shared through the chat composer can also be staged for minting with
[`nft-dropper-composed`](https://github.com/SECUREA1/nft-dropper-composed).
When a file is attached the UI offers a choice to send normally or stage it for
minting. On successful staging a chat message is posted with the mint address
and tokens-remaining information from the dropper service.

Configure the WebSocket server with:

- `NFT_DROPPER_SOURCE_DIR` – Path to the dropper's `nft-source` directory where
  assets and `metadata.json` should be written.
- `NFT_DROPPER_API_URL` – Optional base URL of a running dropper instance. When
  set, the server queries `/api/address` and `/api/tokensLeft` to surface mint
  instructions in the UI.

REST endpoints provided by the chat server:

- `GET /api/nft-dropper/info` – Returns dropper configuration status and remote
  address/token counts when available.
- `POST /api/nft-dropper/mint` – Accepts `{ fileDataUrl, fileName, fileType,
  metadata }`, writes the file and metadata into `NFT_DROPPER_SOURCE_DIR`, and
  echoes dropper status for the client UI.

## Secure sessions and CHAINeS Memory Bank

CHAINeS now uses a server-backed authenticated session and a per-user Memory Bank.

- Authentication endpoints: `POST /register`, `POST /login`, `GET /api/session`, `POST /api/session/refresh`, and `POST /logout`.
- Session identifiers are cryptographically random. Only a SHA-256 hash is stored in SQLite; the original identifier is sent in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` is enabled when `NODE_ENV=production`).
- User-scoped memory endpoints: `GET /api/memory`, `GET/PUT/PATCH/DELETE /api/memory/:namespace`.
- Client pages load `/static/session-client.js`, `/static/memory-bank.js`, and `/static/memory-autosave.js` to resolve the active server session before restoring drafts or preferences.
- Browser storage is a versioned cache under `chaines_memory_v2`; it is not authentication proof and must not contain passwords, session tokens, private keys, stream keys, or wallet secrets.

See `docs/memory-bank-audit.md` for the page audit, namespace mapping, legacy-key migration plan, and required environment variables.
