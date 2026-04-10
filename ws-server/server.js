// server.js
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";
import webpush from "web-push";
import { bech32 } from "bech32";
import fetch from "node-fetch";
import {
  isDirectVendorEnabled,
  vendGhostTokenDirect,
} from "./hologhostVendor.js";

const PORT = process.env.PORT || 10000; // Render provides PORT

const NFT_DROPPER_SOURCE_DIR =
  (process.env.NFT_DROPPER_SOURCE_DIR || "").trim();
const NFT_DROPPER_API_URL = (process.env.NFT_DROPPER_API_URL || "").trim();

// Locate repo root to serve the client HTML
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "app.db");
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    verified INTEGER DEFAULT 0,
    room TEXT,
    message TEXT,
    image TEXT,
    file TEXT,
    file_name TEXT,
    file_type TEXT,
    category TEXT,
    listing_data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    user TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    user TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user)
  );
  CREATE TABLE IF NOT EXISTS reposts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user TEXT NOT NULL,
    repost_message_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    profile_pic TEXT,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower TEXT,
    following TEXT,
    PRIMARY KEY (follower, following)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    type TEXT,
    data TEXT,
    read INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    subscription TEXT
  );
  CREATE TABLE IF NOT EXISTS notification_settings (
    username TEXT PRIMARY KEY,
    push INTEGER DEFAULT 1,
    live INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS dating_likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liker TEXT NOT NULL,
    liked TEXT NOT NULL,
    message_id TEXT,
    matched INTEGER DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(liker, liked, message_id)
  );
  CREATE TABLE IF NOT EXISTS ghost_drops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_address TEXT NOT NULL,
    tx_id TEXT,
    policy_id TEXT,
    asset_name_hex TEXT,
    success INTEGER DEFAULT 0,
    vendor_status INTEGER,
    vendor_response TEXT,
    dispensed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS nft_mints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT,
    file_type TEXT,
    stored_path TEXT,
    metadata TEXT,
    dropper_address TEXT,
    dropper_tokens_left INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `);
try { db.exec("ALTER TABLE chat_messages ADD COLUMN room TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN verified INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN category TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN listing_data TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN repost_of INTEGER"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN repost_note TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN description TEXT"); } catch {}
try {
  db.exec("CREATE INDEX IF NOT EXISTS ghost_drops_wallet_idx ON ghost_drops(wallet_address)");
} catch {}

const PROFILE_MEMORY_PATH = path.join(ROOT, "profile_memory", "main.json");

function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILE_MEMORY_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveProfiles() {
  fs.mkdirSync(path.dirname(PROFILE_MEMORY_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_MEMORY_PATH, JSON.stringify(profiles, null, 2));
}

let profiles = loadProfiles();

// express setup
const app = express();
app.use(express.json({ limit: "75mb" }));
app.use(express.urlencoded({ limit: "75mb", extended: true }));
const profileDir = path.join(ROOT, "static", "profiles");
fs.mkdirSync(profileDir, { recursive: true });
const storage = multer.diskStorage({
  destination: profileDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + ext);
  },
});
const upload = multer({ storage });

app.use("/static", express.static(path.join(ROOT, "static")));
app.get("/sw.js", (req, res) => res.sendFile(path.join(ROOT, "sw.js")));

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:example@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

function getNotifSettings(username) {
  const row = db
    .prepare("SELECT push, live FROM notification_settings WHERE username = ?")
    .get(username);
  return { push: row?.push ?? 1, live: row?.live ?? 1 };
}

function setNotifSettings(username, vals = {}) {
  const cur = getNotifSettings(username);
  const next = {
    push: "push" in vals ? (vals.push ? 1 : 0) : cur.push,
    live: "live" in vals ? (vals.live ? 1 : 0) : cur.live,
  };
  db.prepare(
    "INSERT INTO notification_settings (username, push, live) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET push=excluded.push, live=excluded.live"
  ).run(username, next.push, next.live);
  return next;
}

function sendPush(username, title, body, opts = {}) {
  const settings = getNotifSettings(username);
  if (!settings.push) return;
  if (opts.requireLive && !settings.live) return;
  const subs = db
    .prepare("SELECT subscription FROM push_subscriptions WHERE username = ?")
    .all(username);
  for (const { subscription } of subs) {
    webpush
      .sendNotification(
        JSON.parse(subscription),
        JSON.stringify({ title, body })
      )
      .catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          try {
            db
              .prepare(
                "DELETE FROM push_subscriptions WHERE subscription = ?"
              )
              .run(subscription);
          } catch {}
        }
      });
  }
}

function sanitizeUsername(name = "") {
  return String(name).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24);
}

function ensureUserProfile(username = "") {
  const clean = sanitizeUsername(username);
  if (!clean) return "";
  const existing = db
    .prepare("SELECT username FROM users WHERE username=?")
    .get(clean);
  if (!existing) {
    try {
      db.prepare(
        "INSERT INTO users (username, password, profile_pic, description) VALUES (?, NULL, NULL, NULL)"
      ).run(clean);
    } catch {}
  }
  if (!profiles[clean]) {
    profiles[clean] = { profilePic: null, description: null };
    saveProfiles();
  }
  return clean;
}

app.get("/favicon.ico", (req, res) => res.redirect(301, "/favicon.svg"));
app.get("/favicon.svg", (req, res) =>
  res
    .type("image/svg+xml")
    .sendFile(path.join(ROOT, "static", "logo.svg"))
);

app.get("/healthz", (req, res) => res.send("ok"));
app.get(["/", "/index.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "index.html"))
);
app.get(["/secure", "/secure.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "secure.html"))
);
app.get(["/marketplace", "/marketplace.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "marketplace.html"))
);
app.get(["/private-chat", "/private-chat.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "private-chat.html"))
);
app.get(["/profile", "/profile.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "profile.html"))
);
app.get("/omconsole_render_single.html", (req, res) =>
  res.sendFile(path.join(ROOT, "omconsole_render_single.html"))
);
app.get("/omconsole_render_single_games_ROUTING.html", (req, res) =>
  res.sendFile(path.join(ROOT, "omconsole_render_single_games_ROUTING.html"))
);
app.get("/push/key", (req, res) => res.json({ key: VAPID_PUBLIC_KEY }));
app.post("/push/subscribe", (req, res) => {
  const { username, subscription } = req.body || {};
  if (!username || !subscription) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  db.prepare(
    "INSERT INTO push_subscriptions (username, subscription) VALUES (?, ?)"
  ).run(username, JSON.stringify(subscription));
  res.json({ success: true });
});
app.post("/push/unsubscribe", (req, res) => {
  const { username } = req.body || {};
  if (!username) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  db.prepare("DELETE FROM push_subscriptions WHERE username = ?").run(username);
  res.json({ success: true });
});

function normalizeHex(hex = "") {
  const trimmed = (hex || "").toString().trim();
  const normalized = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (normalized.length === 0) {
    throw new Error("Hex value is required.");
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Value must be a valid hexadecimal string.");
  }
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex value must contain an even number of characters.");
  }
  return normalized.toLowerCase();
}

function addressHexToBech32(addressHex) {
  const normalized = normalizeHex(addressHex);
  const bytes = Buffer.from(normalized, "hex");
  if (bytes.length === 0) {
    throw new Error("Wallet address payload is empty.");
  }
  const header = bytes[0];
  const addressType = header >> 4;
  const networkId = header & 0x0f;
  const isReward = addressType >= 14;
  let hrpBase = isReward ? "stake" : "addr";
  const hrp = networkId === 1 ? hrpBase : `${hrpBase}_test`;
  const words = bech32.toWords(Uint8Array.from(bytes));
  return bech32.encode(hrp, words, 128);
}

function recordGhostDrop({
  walletAddress,
  txId,
  policyId,
  assetNameHex,
  success,
  vendorStatus,
  vendorResponse,
}) {
  db.prepare(
    "INSERT INTO ghost_drops (wallet_address, tx_id, policy_id, asset_name_hex, success, vendor_status, vendor_response) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    walletAddress,
    txId || null,
    policyId || null,
    assetNameHex || null,
    success ? 1 : 0,
    Number.isFinite(vendorStatus) ? vendorStatus : null,
    vendorResponse != null ? JSON.stringify(vendorResponse) : null
  );
}

function getGhostDropCount(walletAddress) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM ghost_drops WHERE wallet_address = ? AND success = 1"
    )
    .get(walletAddress);
  return row?.count ?? 0;
}

function parseDataUrl(dataUrl = "") {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!match) {
    throw new Error("Invalid file data. Expected a base64 data URL.");
  }
  const [, mime, b64] = match;
  return { mime, buffer: Buffer.from(b64, "base64") };
}

function sanitizeFileName(name = "") {
  const base = path.basename(name || "asset");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || `asset-${Date.now().toString(36)}`;
}

function ensureUniqueFileName(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext) || "asset";
  let candidate = fileName;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

function loadDropperMetadata(targetDir) {
  const metaPath = path.join(targetDir, "metadata.json");
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDropperMetadata(targetDir, metadata) {
  const metaPath = path.join(targetDir, "metadata.json");
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 4));
  return metaPath;
}

async function fetchDropperRemoteInfo() {
  if (!NFT_DROPPER_API_URL) return null;
  const base = NFT_DROPPER_API_URL.replace(/\/$/, "");
  const makeUrl = (suffix) => `${base}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
  const [addrRes, tokensRes] = await Promise.all([
    fetch(makeUrl("/api/address")).catch((err) => ({ error: err })),
    fetch(makeUrl("/api/tokensLeft")).catch((err) => ({ error: err })),
  ]);

  const address = addrRes?.ok ? await addrRes.text() : null;
  let tokensLeft = null;
  if (tokensRes?.ok) {
    const text = await tokensRes.text();
    const num = Number(text);
    tokensLeft = Number.isFinite(num) ? num : null;
  }

  return {
    address: address || null,
    tokensLeft,
    reachable: Boolean(addrRes?.ok || tokensRes?.ok),
  };
}

async function getDropperStatus() {
  const sourceDirReady =
    NFT_DROPPER_SOURCE_DIR && fs.existsSync(NFT_DROPPER_SOURCE_DIR);
  const remote = await fetchDropperRemoteInfo().catch(() => null);
  return {
    sourceDir: NFT_DROPPER_SOURCE_DIR || null,
    sourceDirReady,
    apiUrl: NFT_DROPPER_API_URL || null,
    dropper: remote,
  };
}

app.get("/api/nft-dropper/info", async (req, res) => {
  const status = await getDropperStatus();
  res.json({ success: true, ...status });
});

app.post("/api/nft-dropper/mint", async (req, res) => {
  if (!NFT_DROPPER_SOURCE_DIR) {
    res
      .status(400)
      .json({
        success: false,
        error:
          "NFT dropper source directory is not configured. Set NFT_DROPPER_SOURCE_DIR to continue.",
      });
    return;
  }

  const { fileDataUrl, fileName, fileType, metadata } = req.body || {};
  if (!fileDataUrl || !fileName) {
    res
      .status(400)
      .json({ success: false, error: "fileDataUrl and fileName are required." });
    return;
  }

  let parsed;
  try {
    parsed = parseDataUrl(fileDataUrl);
  } catch (err) {
    res.status(400).json({ success: false, error: err?.message || "Invalid file." });
    return;
  }

  if (parsed.buffer.length > 50_000_000) {
    res
      .status(413)
      .json({ success: false, error: "File exceeds 50MB limit for minting." });
    return;
  }

  const safeName = ensureUniqueFileName(
    NFT_DROPPER_SOURCE_DIR,
    sanitizeFileName(fileName)
  );

  try {
    fs.mkdirSync(NFT_DROPPER_SOURCE_DIR, { recursive: true });
    const targetPath = path.join(NFT_DROPPER_SOURCE_DIR, safeName);
    fs.writeFileSync(targetPath, parsed.buffer);

    const dropperMeta = loadDropperMetadata(NFT_DROPPER_SOURCE_DIR);
    const baseName = path.basename(safeName, path.extname(safeName)) || "asset";
    const mergedMeta = {
      name: metadata?.name || baseName,
      description:
        metadata?.description || "Minted via CHAINeS Composer and NFT Dropper.",
      mediaType: metadata?.mediaType || fileType || parsed.mime,
    };

    if (metadata?.properties && typeof metadata.properties === "object") {
      mergedMeta.Properties = metadata.properties;
    }

    if (metadata?.attributes && typeof metadata.attributes === "object") {
      mergedMeta.attributes = metadata.attributes;
    }

    dropperMeta[safeName] = { ...(dropperMeta[safeName] || {}), ...mergedMeta };
    saveDropperMetadata(NFT_DROPPER_SOURCE_DIR, dropperMeta);

    const dropper = await fetchDropperRemoteInfo().catch(() => null);

    db.prepare(
      "INSERT INTO nft_mints (file_name, file_type, stored_path, metadata, dropper_address, dropper_tokens_left) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      safeName,
      fileType || parsed.mime,
      targetPath,
      metadata ? JSON.stringify(metadata) : null,
      dropper?.address || null,
      Number.isFinite(dropper?.tokensLeft) ? dropper.tokensLeft : null
    );

    res.json({
      success: true,
      fileName: safeName,
      storedPath: targetPath,
      dropper,
    });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, error: err?.message || "Mint preparation failed." });
  }
});

app.post("/api/hologhosts/status", (req, res) => {
  try {
    const { addressHex } = req.body || {};
    if (!addressHex) {
      res.status(400).json({ success: false, error: "addressHex is required." });
      return;
    }
    const bechAddress = addressHexToBech32(addressHex);
    const count = getGhostDropCount(bechAddress);
    res.json({ success: true, address: bechAddress, count });
  } catch (err) {
    res
      .status(400)
      .json({ success: false, error: err?.message || "Unable to resolve wallet address." });
  }
});

app.post("/api/hologhosts/dispense", async (req, res) => {
  const { addressHex, policyId, assetNameHex } = req.body || {};
  if (!addressHex) {
    res.status(400).json({ success: false, error: "addressHex is required." });
    return;
  }
  if (!policyId) {
    res.status(400).json({ success: false, error: "policyId is required." });
    return;
  }
  if (!assetNameHex) {
    res.status(400).json({ success: false, error: "assetNameHex is required." });
    return;
  }

  let bechAddress;
  try {
    bechAddress = addressHexToBech32(addressHex);
  } catch (err) {
    res
      .status(400)
      .json({ success: false, error: err?.message || "Unable to resolve wallet address." });
    return;
  }

  const vendingUrl = process.env.HOLOGHOST_VENDING_URL || "";
  const apiKey = process.env.HOLOGHOST_VENDING_API_KEY || "";
  const vendorPayload = {
    address: bechAddress,
    policyId,
    assetNameHex,
  };

  let vendorResponse = null;
  let vendorStatus = null;
  let txId = null;
  let message = "Ghost token transfer initiated.";
  const trimmedVendingUrl = vendingUrl.trim();
  const hasExternalVendor = trimmedVendingUrl.length > 0;
  const useDirectVendor = !hasExternalVendor && isDirectVendorEnabled();
  const useSimulation = !hasExternalVendor && !useDirectVendor;

  if (hasExternalVendor) {
    try {
      const response = await fetch(trimmedVendingUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(vendorPayload),
      });
      vendorStatus = response.status;
      const bodyText = await response.text();
      try {
        vendorResponse = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        vendorResponse = { raw: bodyText };
      }
      if (!response.ok) {
        const errorMessage = vendorResponse?.error || `Vending request failed with status ${response.status}`;
        recordGhostDrop({
          walletAddress: bechAddress,
          txId: null,
          policyId,
          assetNameHex,
          success: false,
          vendorStatus,
          vendorResponse,
        });
        res.status(502).json({ success: false, error: errorMessage });
        return;
      }
      txId = vendorResponse?.txId || vendorResponse?.tx_id || null;
      message = vendorResponse?.message || message;
    } catch (err) {
      recordGhostDrop({
        walletAddress: bechAddress,
        txId: null,
        policyId,
        assetNameHex,
        success: false,
        vendorStatus,
        vendorResponse: { error: err?.message || "Unexpected vending error." },
      });
      res.status(502).json({ success: false, error: err?.message || "Ghost token transfer failed." });
      return;
    }
  } else if (useDirectVendor) {
    try {
      const directResult = await vendGhostTokenDirect({
        address: bechAddress,
        policyId,
        assetNameHex,
      });
      txId = directResult?.txId || null;
      vendorStatus = directResult?.vendorStatus ?? 200;
      vendorResponse = directResult?.vendorResponse || null;
      message = directResult?.message || message;
    } catch (err) {
      vendorStatus = Number.isFinite(err?.statusCode)
        ? err.statusCode
        : 500;
      recordGhostDrop({
        walletAddress: bechAddress,
        txId: null,
        policyId,
        assetNameHex,
        success: false,
        vendorStatus,
        vendorResponse: { error: err?.message || "Unexpected vending error." },
      });
      res.status(502).json({ success: false, error: err?.message || "Ghost token transfer failed." });
      return;
    }
  } else {
    vendorStatus = 200;
    vendorResponse = {
      simulated: true,
      message: "Simulation mode: no live vending endpoint configured.",
    };
    txId = `sim-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    message = "Simulation: ghost token recorded locally.";
  }

  recordGhostDrop({
    walletAddress: bechAddress,
    txId,
    policyId,
    assetNameHex,
    success: true,
    vendorStatus,
    vendorResponse,
  });

  const count = getGhostDropCount(bechAddress);

  res.json({
    success: true,
    address: bechAddress,
    count,
    txId,
    message,
    simulated: useSimulation,
    vendorStatus,
  });
});

app.get("/notification-settings/:username", (req, res) => {
  res.json(getNotifSettings(req.params.username));
});

app.post("/notification-settings/:username", (req, res) => {
  const settings = setNotifSettings(req.params.username, req.body || {});
  res.json(settings);
});

app.post("/register", upload.single("profile"), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  if (profiles[username]) {
    res.status(400).json({ error: "User exists" });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    let pic = null;
    if (req.file) pic = "/static/profiles/" + req.file.filename;
    db.prepare(
      "INSERT INTO users (username, password, profile_pic) VALUES (?,?,?)"
    ).run(username, hash, pic);
    profiles[username] = { password: hash, profilePic: pic, description: null };
    saveProfiles();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: "User exists" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const dbUser = db
    .prepare("SELECT username, password, profile_pic FROM users WHERE username=?")
    .get(username);
  const memUser = profiles[username];
  const hash = dbUser?.password || memUser?.password;
  if (!hash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const profilePic = dbUser?.profile_pic || memUser?.profilePic || null;
  if (!dbUser) {
    try {
      db.prepare("INSERT INTO users (username, password, profile_pic) VALUES (?,?,?)").run(username, hash, profilePic);
    } catch {}
  }
  profiles[username] = { ...(memUser || {}), password: hash, profilePic };
  saveProfiles();
  res.json({ success: true, username, profilePic });
});

app.get(["/profile.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "profile.html"))
);
app.get(["/private-chat.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "private-chat.html"))
);

app.get("/profile/:username", (req, res) => {
  const viewer = req.query.viewer || "";
  const dbUser = db
    .prepare(
      "SELECT username, profile_pic, description FROM users WHERE username=?"
    )
    .get(req.params.username);
  const memUser = profiles[req.params.username] || {};
  if (!dbUser && !memUser.password) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const posts = dbUser
    ? db
        .prepare(
          "SELECT id, message, image, file, file_name, file_type, strftime('%s', timestamp) * 1000 as ts FROM chat_messages WHERE user=? ORDER BY id DESC"
        )
        .all(req.params.username)
    : [];
  const followers = dbUser
    ? db
        .prepare("SELECT follower FROM follows WHERE following=?")
        .all(req.params.username)
        .map((r) => r.follower)
    : [];
  const following = dbUser
    ? db
        .prepare("SELECT following FROM follows WHERE follower=?")
        .all(req.params.username)
        .map((r) => r.following)
    : [];
  const isFollowing = viewer
    ? dbUser
      ? !!db
          .prepare(
            "SELECT 1 FROM follows WHERE follower=? AND following=?"
          )
          .get(viewer, req.params.username)
      : false
    : false;
  const datingLikes = dbUser
    ? db
        .prepare("SELECT liked, matched FROM dating_likes WHERE liker=? ORDER BY id DESC")
        .all(req.params.username)
    : [];
  const datingLikedUsers = datingLikes.map((row) => row.liked);
  const datingMatchedUsers = [...new Set(datingLikes.filter((row) => row.matched).map((row) => row.liked))];
  res.json({
    username: req.params.username,
    profilePic: dbUser?.profile_pic || memUser.profilePic || null,
    description: dbUser?.description || memUser.description || null,
    posts,
    followers,
    following,
    isFollowing,
    stats: {
      posts: posts.length,
      followers: followers.length,
      following: following.length,
      datingLikesSent: datingLikedUsers.length,
      datingMatches: datingMatchedUsers.length,
    },
    dating: {
      likedUsers: datingLikedUsers,
      matchedUsers: datingMatchedUsers,
    },
  });
});

app.post("/profile/:username", upload.single("profile"), (req, res) => {
  const { description } = req.body || {};
  let pic = null;
  if (req.file) pic = "/static/profiles/" + req.file.filename;
  if (pic) {
    db.prepare(
      "UPDATE users SET description=?, profile_pic=? WHERE username=?"
    ).run(description || null, pic, req.params.username);
  } else {
    db.prepare("UPDATE users SET description=? WHERE username=?").run(
      description || null,
      req.params.username
    );
    const row = db
      .prepare("SELECT profile_pic FROM users WHERE username=?")
      .get(req.params.username);
    pic = row?.profile_pic || null;
  }
  const mem = profiles[req.params.username] || {};
  profiles[req.params.username] = {
    ...mem,
    description: description || null,
    profilePic: pic,
    password: mem.password,
  };
  saveProfiles();
  res.json({ success: true, profilePic: pic });
});

app.post("/profile/:username/follow", (req, res) => {
  const { follower } = req.body || {};
  if (!follower) {
    res.status(400).json({ error: "Missing follower" });
    return;
  }
  const exists = db
    .prepare("SELECT 1 FROM follows WHERE follower=? AND following=?")
    .get(follower, req.params.username);
  if (exists) {
    db
      .prepare("DELETE FROM follows WHERE follower=? AND following=?")
      .run(follower, req.params.username);
    res.json({ following: false });
  } else {
    db
      .prepare("INSERT INTO follows (follower, following) VALUES (?, ?)")
      .run(follower, req.params.username);
    db
      .prepare(
        "INSERT INTO notifications (username, type, data) VALUES (?, 'follow', ?)"
      )
      .run(
        req.params.username,
        JSON.stringify({ from: follower })
      );
    sendPush(
      req.params.username,
      "New Follower",
      `${follower} started following you`
    );
    res.json({ following: true });
  }
});

app.post("/dating/interactions/toggle-like", (req, res) => {
  const actor = ensureUserProfile(req.body?.actor || "");
  const target = ensureUserProfile(req.body?.target || "");
  const messageId = String(req.body?.messageId || "").trim().slice(0, 64);
  const liked = !!req.body?.liked;
  if (!actor || !target || !messageId) {
    res.status(400).json({ error: "Missing actor, target, or messageId" });
    return;
  }
  if (actor === target) {
    res.status(400).json({ error: "Cannot like your own profile" });
    return;
  }

  let matched = false;
  if (liked) {
    db.prepare(
      "INSERT OR IGNORE INTO dating_likes (liker, liked, message_id, matched) VALUES (?, ?, ?, 0)"
    ).run(actor, target, messageId);
    db.prepare(
      "INSERT INTO notifications (username, type, data) VALUES (?, 'dating-like', ?)"
    ).run(
      target,
      JSON.stringify({ from: actor, messageId })
    );
    sendPush(target, "New Dating Like", `${actor} liked your dating profile`);
    const reciprocal = db
      .prepare("SELECT id FROM dating_likes WHERE liker=? AND liked=? LIMIT 1")
      .get(target, actor);
    if (reciprocal) {
      db.prepare(
        "UPDATE dating_likes SET matched=1 WHERE (liker=? AND liked=?) OR (liker=? AND liked=?)"
      ).run(actor, target, target, actor);
      matched = true;
      db.prepare(
        "INSERT INTO notifications (username, type, data) VALUES (?, 'dating-match', ?)"
      ).run(
        actor,
        JSON.stringify({ with: target, messageId })
      );
      db.prepare(
        "INSERT INTO notifications (username, type, data) VALUES (?, 'dating-match', ?)"
      ).run(
        target,
        JSON.stringify({ with: actor, messageId })
      );
      sendPush(actor, "Dating Match", `You and ${target} liked each other`);
      sendPush(target, "Dating Match", `You and ${actor} liked each other`);
    }
  } else {
    db.prepare(
      "DELETE FROM dating_likes WHERE liker=? AND liked=? AND message_id=?"
    ).run(actor, target, messageId);
    db.prepare(
      "UPDATE dating_likes SET matched=0 WHERE (liker=? AND liked=?) OR (liker=? AND liked=?)"
    ).run(actor, target, target, actor);
  }
  const likedRows = db
    .prepare("SELECT liked, matched FROM dating_likes WHERE liker=? ORDER BY id DESC")
    .all(actor);
  const matchRows = likedRows.filter((row) => row.matched).map((row) => row.liked);
  res.json({
    success: true,
    liked,
    matched,
    likedUsers: likedRows.map((row) => row.liked),
    matchedUsers: [...new Set(matchRows)],
  });
});

app.get("/notifications/:username", (req, res) => {
  const rows = db
    .prepare(
      "SELECT id, type, data, read, strftime('%s', timestamp) * 1000 as ts FROM notifications WHERE username=? ORDER BY id DESC"
    )
    .all(req.params.username)
    .map((r) => ({
      id: r.id,
      type: r.type,
      data: JSON.parse(r.data || "{}"),
      read: !!r.read,
      ts: r.ts,
    }));
  res.json(rows);
});

app.post("/notifications/:username/read", (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE username=?").run(
    req.params.username
  );
  res.json({ success: true });
});

const server = http.createServer(app);

function dmChannelId(userA = "", userB = "") {
  return [String(userA).toLowerCase(), String(userB).toLowerCase()].sort().join("|");
}

const MARKETPLACE_CATEGORIES = new Set([
  "general",
  "jobs",
  "for-sale",
  "services",
  "housing",
  "community",
]);

function normalizeListingPayload(payload = {}, fallbackCategory = "general") {
  const categoryCandidate = String(payload.category || fallbackCategory || "general").trim();
  const category = MARKETPLACE_CATEGORIES.has(categoryCandidate) ? categoryCandidate : "general";
  return {
    category,
    price: String(payload.price || "").trim(),
    location: String(payload.location || "").trim(),
    condition: String(payload.condition || "").trim(),
  };
}

function loadDirectHistory(userA = "", userB = "") {
  const cleanA = String(userA || "").trim();
  const cleanB = String(userB || "").trim();
  if (!cleanA || !cleanB) return [];
  return db
    .prepare(
      `SELECT id, sender, recipient, ciphertext, iv, strftime('%s', timestamp) * 1000 as ts
       FROM private_messages
       WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
       ORDER BY id ASC`
    )
    .all(cleanA, cleanB, cleanB, cleanA)
    .map((row) => ({
      id: row.id,
      from: row.sender,
      to: row.recipient,
      ciphertext: row.ciphertext,
      iv: row.iv,
      ts: row.ts || Date.now(),
      channel: dmChannelId(row.sender, row.recipient),
    }));
}

function loadHistory(room = null) {
  const where = room ? "c.room = ?" : "c.room IS NULL";
  const stmt = db.prepare(
    `SELECT c.id, c.user, c.verified, u.profile_pic, c.room, c.message, c.image, c.file, c.file_name, c.file_type, c.category, c.listing_data, c.repost_of, c.repost_note, o.user as repost_original_user, strftime('%s', c.timestamp) * 1000 as ts FROM chat_messages c LEFT JOIN users u ON c.user = u.username LEFT JOIN chat_messages o ON c.repost_of = o.id WHERE ${where} ORDER BY c.id`
  );
  const rows = room ? stmt.all(room) : stmt.all();
  const commentRows = db
    .prepare(
      `SELECT id, message_id, user, text, strftime('%s', timestamp) * 1000 as ts FROM comments ORDER BY id`
    )
    .all();
  const likeRows = db
    .prepare(`SELECT message_id, COUNT(*) as c FROM likes GROUP BY message_id`)
    .all();
  const comments = {};
  for (const c of commentRows) {
    (comments[c.message_id] ||= []).push({
      id: c.id,
      user: c.user,
      text: c.text,
      ts: c.ts,
    });
  }
  const likes = {};
  for (const l of likeRows) likes[l.message_id] = l.c;
  return rows.map((r) => {
    const listing = normalizeListingPayload(
      (() => {
        try {
          return r.listing_data ? JSON.parse(r.listing_data) : {};
        } catch {
          return {};
        }
      })(),
      r.category || "general"
    );
    return {
      type: "chat",
      id: r.id,
      user: r.user,
      verified: !!r.verified,
      profilePic: r.profile_pic,
      room: r.room,
      text: r.message,
      image: r.image,
      file: r.file,
      fileName: r.file_name,
      fileType: r.file_type,
      category: listing.category,
      listing,
      ts: r.ts,
      likes: likes[r.id] || 0,
      comments: comments[r.id] || [],
      repostOf: r.repost_of || null,
      repostNote: r.repost_note || "",
      repostOriginalUser: r.repost_original_user || "",
    };
  });
}

const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Map();
const broadcasters = new Map();
const thumbnails = new Map();
// track viewers per broadcaster
const listeners = new Map(); // hostId -> Set of watcherIds
const watching = new Map();  // watcherId -> Set of hostIds
let guestApproved = null; // currently approved guest broadcaster
const guestHosts = new Map(); // guestId -> hostId
const micGuests = new Set(); // audio-only broadcasters
const secureLiveParticipants = new Map(); // ws.id -> { id, user }

function uid(){
  return Math.random().toString(36).slice(2,9);
}

function broadcastUsers() {
  const users = [];
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.username) {
      users.push({
        name: client.username,
        id: client.id,
        live: broadcasters.has(client.id),
        mic: micGuests.has(client.id),
        profilePic: client.profilePic || null,
      });
    }
  }
  const payload = JSON.stringify({ type: "users", users, count: users.length });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function sendListenerCount(id){
  const count = listeners.get(id)?.size || 0;
  const payload = JSON.stringify({ type: "listeners", id, count });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastSecureLiveUsers() {
  const users = Array.from(secureLiveParticipants.values());
  const payload = JSON.stringify({ type: "secure-live-users", users });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on("connection", (ws) => {
  ws.id = uid();
  clients.set(ws.id, ws);
  ws.send(JSON.stringify({ type: "system", text: "Connected to CHAINeS WS" }));
  ws.send(JSON.stringify({ type: "history", messages: loadHistory() }));
  ws.send(JSON.stringify({ type: "id", id: ws.id }));
  broadcastUsers();
  for(const [id, thumb] of thumbnails.entries()){
    ws.send(JSON.stringify({ type: "thumb", id, thumb }));
  }
  ws.on("close", () => {
    clients.delete(ws.id);
    if (secureLiveParticipants.delete(ws.id)) {
      broadcastSecureLiveUsers();
    }
    if (broadcasters.has(ws.id)) {
      broadcasters.delete(ws.id);
      micGuests.delete(ws.id);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(JSON.stringify({ type: "bye", id: ws.id }));
      }
      if (guestApproved === ws.id || broadcasters.size <= 1) guestApproved = null;
      if(listeners.has(ws.id)){
        listeners.delete(ws.id);
        sendListenerCount(ws.id);
      }
      thumbnails.delete(ws.id);
    }
    const watched = watching.get(ws.id);
    if(watched){
      for(const hostId of watched){
        const set = listeners.get(hostId);
        if(set){
          set.delete(ws.id);
          if(set.size === 0) listeners.delete(hostId);
          sendListenerCount(hostId);
        }
      }
      watching.delete(ws.id);
    }
    for(const [g,h] of guestHosts.entries()){
      if(g === ws.id || h === ws.id) guestHosts.delete(g);
    }
    broadcastUsers();
  });
  ws.on("message", async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type === "join") {
      ws.username = msg.user || "";
      const u = db
        .prepare("SELECT profile_pic FROM users WHERE username=?")
        .get(ws.username);
      ws.profilePic = u?.profile_pic || null;
      broadcastUsers();
      return;
    }
    switch (msg?.type) {
      case "broadcaster":
        if (broadcasters.size > 0 && ws.id !== guestApproved) {
          ws.send(JSON.stringify({ type: "join-denied" }));
          return;
        }
        broadcasters.set(ws.id, ws);
        broadcastUsers();
        const followers = db
          .prepare("SELECT follower FROM follows WHERE following = ?")
          .all(ws.username || "");
        for (const { follower } of followers) {
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'broadcast', ?)"
            )
            .run(follower, JSON.stringify({ from: ws.username || "", mode: "start" }));
          sendPush(
            follower,
            "New Broadcast",
            `${ws.username} is live`,
            { requireLive: true }
          );
        }
        const hostId = guestHosts.get(ws.id);
        if(hostId){
          const payload = JSON.stringify({ type: "guest-start", host: hostId, id: ws.id });
          const set = listeners.get(hostId);
          if(set){
            for(const wid of set){
              const watcher = clients.get(wid);
              if(watcher && watcher.readyState === 1) watcher.send(payload);
            }
          }
          const host = clients.get(hostId);
          if(host && host.readyState === 1) host.send(payload);
        }
        return;
      case "mic-broadcaster":
        broadcasters.set(ws.id, ws);
        micGuests.add(ws.id);
        broadcastUsers();
        return;
      case "end-broadcast":
        if (broadcasters.has(ws.id)) {
          for (const client of wss.clients) {
            if (client.readyState === 1 && client !== ws) {
              client.send(JSON.stringify({ type: "bye", id: ws.id }));
            }
          }
          broadcasters.delete(ws.id);
          micGuests.delete(ws.id);
          thumbnails.delete(ws.id);
          if (guestApproved === ws.id || broadcasters.size <= 1) guestApproved = null;
          if(listeners.has(ws.id)){
            listeners.delete(ws.id);
            sendListenerCount(ws.id);
          }
          broadcastUsers();
        }
        return;
      case "join-request": {
        if (guestApproved) {
          ws.send(JSON.stringify({ type: "join-denied" }));
          return;
        }
        const host = broadcasters.get(msg.id);
        if (host && host.readyState === 1) {
          host.send(
            JSON.stringify({ type: "join-request", id: ws.id, user: ws.username })
          );
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'broadcast', ?)"
            )
            .run(
              host.username || "",
              JSON.stringify({ from: ws.username || "", mode: "join" })
            );
          sendPush(
            host.username || "",
            "Broadcast Request",
            `${ws.username || "Someone"} requested to join your broadcast`
          );
        } else {
          ws.send(JSON.stringify({ type: "join-denied" }));
        }
        return;
      }
      case "mic-request": {
        const host = broadcasters.get(msg.id);
        if (host && host.readyState === 1) {
          host.send(
            JSON.stringify({ type: "mic-request", id: ws.id, user: ws.username })
          );
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'broadcast', ?)"
            )
            .run(
              host.username || "",
              JSON.stringify({ from: ws.username || "", mode: "mic" })
            );
          sendPush(
            host.username || "",
            "Broadcast Request",
            `${ws.username || "Someone"} requested to join via mic`
          );
        }
        return;
      }
      case "invite": {
        if (msg.target) {
          const guest = clients.get(msg.target);
          if (guest && guest.readyState === 1) {
            guest.send(
              JSON.stringify({ type: "invite", id: ws.id, mode: msg.mode, user: ws.username })
            );
          }
        } else {
          const set = listeners.get(ws.id);
          if (set) {
            for (const wid of set) {
              const guest = clients.get(wid);
              if (guest && guest.readyState === 1) {
                guest.send(
                  JSON.stringify({ type: "invite", id: ws.id, mode: msg.mode, user: ws.username })
                );
              }
            }
          }
        }
        return;
      }
      case "approve-join": {
        if (guestApproved) return;
        const guest = clients.get(msg.id);
        if (guest && broadcasters.has(ws.id)) {
          guestApproved = msg.id;
          guestHosts.set(msg.id, ws.id);
          guest.send(JSON.stringify({ type: "join-approved" }));
        }
        return;
      }
      case "approve-mic": {
        const guest = clients.get(msg.id);
        if (guest && broadcasters.has(ws.id)) {
          guest.send(JSON.stringify({ type: "mic-approved" }));
        }
        return;
      }
      case "deny-join": {
        const guest = clients.get(msg.id);
        if (guest) guest.send(JSON.stringify({ type: "join-denied" }));
        return;
      }
      case "deny-mic": {
        const guest = clients.get(msg.id);
        if (guest) guest.send(JSON.stringify({ type: "mic-denied" }));
        return;
      }
      case "watcher": {
        const host = broadcasters.get(msg.id);
        if (host && host.readyState === 1) {
          host.send(JSON.stringify({ type: "watcher", id: ws.id }));
          if(!listeners.has(msg.id)) listeners.set(msg.id, new Set());
          listeners.get(msg.id).add(ws.id);
          if(!watching.has(ws.id)) watching.set(ws.id, new Set());
          watching.get(ws.id).add(msg.id);
          sendListenerCount(msg.id);
          const history = loadHistory(msg.id);
          if(history.length) ws.send(JSON.stringify({ type: "history", messages: history }));
        }
        return;
      }
      case "unwatcher": {
        const set = listeners.get(msg.id);
        if(set){
          set.delete(ws.id);
          if(set.size === 0) listeners.delete(msg.id);
          sendListenerCount(msg.id);
        }
        const list = watching.get(ws.id);
        if(list){
          list.delete(msg.id);
          if(list.size === 0) watching.delete(ws.id);
        }
        return;
      }
      case "thumb": {
        if (typeof msg.thumb === "string") {
          thumbnails.set(ws.id, msg.thumb);
          const payload = JSON.stringify({ type: "thumb", id: ws.id, thumb: msg.thumb });
          for (const client of wss.clients) {
            if (client.readyState === 1) client.send(payload);
          }
        }
        return;
      }
      case "caption": {
        if(!msg.text) return;
        const watchersSet = listeners.get(ws.id);
        if(watchersSet){
          const payload = JSON.stringify({ type: "caption", id: ws.id, text: msg.text });
          for(const watcherId of watchersSet){
            const watcher = clients.get(watcherId);
            if(watcher && watcher.readyState === 1) watcher.send(payload);
          }
        }
        return;
      }
      case "comment": {
        if (!msg.messageId || !msg.text) return;
        const info = db
          .prepare(
            "INSERT INTO comments (message_id, user, text) VALUES (?, ?, ?)"
          )
          .run(msg.messageId, msg.user || "", msg.text);
        const out = {
          type: "comment",
          id: info.lastInsertRowid,
          messageId: msg.messageId,
          user: msg.user || "",
          text: msg.text,
          ts: Date.now(),
        };
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(JSON.stringify(out));
        }
        return;
      }
      case "like": {
        if (!msg.messageId) return;
        const info = db
          .prepare(
            "INSERT OR IGNORE INTO likes (message_id, user) VALUES (?, ?)"
          )
          .run(msg.messageId, msg.user || "");
        if (info.changes) {
          const owner = db
            .prepare("SELECT user FROM chat_messages WHERE id=?")
            .get(msg.messageId)?.user;
          if (owner && owner !== (msg.user || "")) {
            db
              .prepare(
                "INSERT INTO notifications (username, type, data) VALUES (?, 'like', ?)"
              )
              .run(
                owner,
                JSON.stringify({ from: msg.user || "", messageId: msg.messageId })
              );
            sendPush(
              owner,
              "New Like",
              `${msg.user || "Someone"} liked your post #${msg.messageId}`
            );
          }
        }
        const count = db
          .prepare("SELECT COUNT(*) as c FROM likes WHERE message_id = ?")
          .get(msg.messageId).c;
        const payload = { type: "like", messageId: msg.messageId, count };
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(JSON.stringify(payload));
        }
        return;
      }
      case "repost": {
        if (!msg.messageId) return;
        const actor = sanitizeUsername(msg.user || ws.username || "");
        if (!actor) return;
        const source = db
          .prepare(
            `SELECT id, user, verified, room, message, image, file, file_name, file_type, category, listing_data
             FROM chat_messages WHERE id = ?`
          )
          .get(msg.messageId);
        if (!source) return;
        if (source.room) {
          ws.send(
            JSON.stringify({
              type: "system",
              text: "Only public feed posts can be reposted.",
            })
          );
          return;
        }
        const existing = db
          .prepare("SELECT id FROM reposts WHERE message_id = ? AND user = ?")
          .get(msg.messageId, actor);
        if (existing) {
          ws.send(
            JSON.stringify({
              type: "system",
              text: "You can repost this post only once.",
            })
          );
          return;
        }
        const created = db
          .prepare(
            `INSERT INTO chat_messages
             (user, verified, room, message, image, file, file_name, file_type, category, listing_data, repost_of, repost_note)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            actor,
            ws.verified ? 1 : 0,
            source.message,
            source.image,
            source.file,
            source.file_name,
            source.file_type,
            source.category,
            source.listing_data,
            source.id,
            `Reposted by @${actor}`
          );
        const repostMessageId = created.lastInsertRowid;
        db.prepare(
          "INSERT INTO reposts (message_id, user, repost_message_id) VALUES (?, ?, ?)"
        ).run(source.id, actor, repostMessageId);
        const actorProfilePic = db
          .prepare("SELECT profile_pic FROM users WHERE username=?")
          .get(actor)?.profile_pic || null;
        const reposted = {
          type: "chat",
          id: repostMessageId,
          user: actor,
          verified: !!ws.verified,
          profilePic: actorProfilePic,
          room: null,
          text: source.message,
          image: source.image,
          file: source.file,
          fileName: source.file_name,
          fileType: source.file_type,
          category: source.category || "general",
          listing: normalizeListingPayload(
            (() => {
              try {
                return source.listing_data ? JSON.parse(source.listing_data) : {};
              } catch {
                return {};
              }
            })(),
            source.category || "general"
          ),
          ts: Date.now(),
          likes: 0,
          comments: [],
          repostOf: source.id,
          repostNote: `Reposted by @${actor}`,
          repostOriginalUser: source.user || "",
        };
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(JSON.stringify(reposted));
        }
        if (source.user && source.user !== actor) {
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'repost', ?)"
            )
            .run(
              source.user,
              JSON.stringify({ from: actor, messageId: source.id, repostMessageId })
            );
          sendPush(
            source.user,
            "New Repost",
            `${actor} reposted your post #${source.id}`
          );
        }
        return;
      }
      case "offer":
      case "answer":
      case "candidate":
      case "bye": {
        const dest = clients.get(msg.id);
        if (dest && dest.readyState === 1) {
          const payload = { type: msg.type, id: ws.id };
          if (msg.sdp) payload.sdp = msg.sdp;
          if (msg.candidate) payload.candidate = msg.candidate;
          dest.send(JSON.stringify(payload));
        }
        return;
      }
      case "secure-live-join": {
        const user = (msg.user || ws.username || "").toString().trim() || `secure-${ws.id}`;
        secureLiveParticipants.set(ws.id, { id: ws.id, user });
        broadcastSecureLiveUsers();
        return;
      }
      case "secure-live-leave": {
        if (secureLiveParticipants.delete(ws.id)) {
          broadcastSecureLiveUsers();
        }
        return;
      }
      case "dm-history": {
        const user = ws.username || msg.user || "";
        const peer = (msg.with || "").toString().trim();
        if (!user || !peer) return;
        ws.send(
          JSON.stringify({
            type: "dm-history",
            channel: dmChannelId(user, peer),
            with: peer,
            messages: loadDirectHistory(user, peer),
          })
        );
        return;
      }
      case "dm": {
        const from = ws.username || msg.from || "";
        const to = (msg.to || "").toString().trim();
        const ciphertext = (msg.ciphertext || "").toString();
        const iv = (msg.iv || "").toString();
        if (!from || !to || !ciphertext || !iv) return;
        const info = db
          .prepare(
            "INSERT INTO private_messages (sender, recipient, ciphertext, iv) VALUES (?, ?, ?, ?)"
          )
          .run(from, to, ciphertext, iv);
        if (from !== to) {
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'dm', ?)"
            )
            .run(
              to,
              JSON.stringify({
                from,
                preview: "Sent you a private encrypted message",
              })
            );
          sendPush(
            to,
            "New Private Message",
            `${from} sent you a private encrypted message`
          );
        }
        const payload = JSON.stringify({
          type: "dm",
          id: info.lastInsertRowid,
          from,
          to,
          ciphertext,
          iv,
          ts: Date.now(),
          channel: dmChannelId(from, to),
        });
        for (const client of wss.clients) {
          if (
            client.readyState === 1 &&
            client.username &&
            (client.username === from || client.username === to)
          ) {
            client.send(payload);
          }
        }
        return;
      }
    }
    if (msg?.type !== "chat") return;
    // Allow larger uploads so mobile devices can share photos and videos
    // Data URLs grow ~33% over the original binary size, so these limits are
    // higher than the desired byte thresholds.
    if (msg.image && msg.image.length > 20_000_000) return; // limit ~15MB per image
    if (msg.file && msg.file.length > 50_000_000) return; // limit ~35MB per file
    msg.ts ||= Date.now();
    const text = msg.text ?? msg.message ?? "";
    msg.text = text;
    const fileName = msg.file_name || msg.fileName || null;
    const fileType = msg.file_type || msg.fileType || null;
    const listing = normalizeListingPayload(msg.listing || {}, msg.category || "general");
    msg.category = listing.category;
    msg.listing = listing;
    const u = db
      .prepare("SELECT profile_pic FROM users WHERE username=?")
      .get(msg.user || "");
    msg.profilePic = u?.profile_pic || null;
    const info = db
      .prepare(
        "INSERT INTO chat_messages (user, verified, room, message, image, file, file_name, file_type, category, listing_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        msg.user || "",
        msg.verified ? 1 : 0,
        msg.room || null,
        text,
        msg.image || null,
        msg.file || null,
        fileName,
        fileType,
        listing.category,
        JSON.stringify(listing)
    );
    msg.id = info.lastInsertRowid;
    msg.message = text;
    msg.likes = 0;
    msg.comments = [];
    if (fileName) {
      msg.file_name = fileName;
      msg.fileName = fileName;
    }
    if (fileType) {
      msg.file_type = fileType;
      msg.fileType = fileType;
    }
    // broadcast
    if (msg.room) {
      const targets = new Set();
      const host = broadcasters.get(msg.room);
      if (host && host.readyState === 1) targets.add(host);
      const set = listeners.get(msg.room);
      if (set) {
        for (const id of set) {
          const c = clients.get(id);
          if (c && c.readyState === 1) targets.add(c);
        }
      }
      if (ws.readyState === 1) targets.add(ws);
      for (const c of targets) c.send(JSON.stringify(msg));
    } else {
      for (const client of wss.clients) {
        if (client.readyState === 1 && !watching.has(client.id)) {
          client.send(JSON.stringify(msg));
        }
      }
    }
    if (msg.selfDestruct) {
      setTimeout(() => {
        db.prepare("DELETE FROM chat_messages WHERE id = ?").run(msg.id);
        db.prepare("DELETE FROM comments WHERE message_id = ?").run(msg.id);
        db.prepare("DELETE FROM likes WHERE message_id = ?").run(msg.id);
        const payload = JSON.stringify({ type: "delete", id: msg.id });
        for (const client of wss.clients) {
          if (client.readyState === 1) client.send(payload);
        }
        db
          .prepare(
            "INSERT INTO notifications (username, type, data) VALUES (?, 'self-destruct', ?)"
          )
          .run(msg.user || "", JSON.stringify({ messageId: msg.id }));
        sendPush(
          msg.user || "",
          "Message Removed",
          `Your post #${msg.id} self-destructed`
        );
        for (const client of wss.clients) {
          if (client.readyState === 1 && client.username === (msg.user || "")) {
            client.send(
              JSON.stringify({
                type: "self-destruct",
                messageId: msg.id,
              })
            );
          }
        }
      }, msg.selfDestruct);
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`listening on ${PORT}`)
);
