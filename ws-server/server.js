// server.js
import http from "http";
import crypto from "crypto";
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

function ensureWritableDir(preferredDir, fallbackDir, label) {
  const candidates = [preferredDir, fallbackDir].filter(Boolean);
  let lastError = null;

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (error) {
      lastError = error;
      console.warn(`[storage] ${label} directory ${dir} is not writable: ${error.code || error.message}`);
    }
  }

  throw lastError || new Error(`No writable ${label} directory is available`);
}

const defaultDataDir = process.env.NODE_ENV === "production" ? "/var/data" : ROOT;
const fallbackDataDir = path.join(ROOT, ".data");
const requestedDbPath = process.env.DB_PATH || path.join(defaultDataDir, "chaines.db");
const dbDir = ensureWritableDir(path.dirname(requestedDbPath), fallbackDataDir, "database");
const DB_PATH = path.join(dbDir, path.basename(requestedDbPath));
if (!process.env.DB_PATH) {
  console.warn(`[storage] DB_PATH is not set; using ${DB_PATH}. Set DB_PATH to mounted persistent storage in production.`);
}
if (DB_PATH !== requestedDbPath) {
  console.warn(`[storage] Falling back from SQLite database path ${requestedDbPath} to ${DB_PATH}.`);
}
if (process.env.NODE_ENV === "production" && !path.resolve(DB_PATH).startsWith("/var/data/")) {
  console.warn(`[storage] WARNING: production DB_PATH (${DB_PATH}) is not inside /var/data; data may be ephemeral on Render.`);
}
console.log(`[storage] SQLite database path: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
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
    post_id INTEGER,
    user_id INTEGER,
    user TEXT,
    text TEXT,
    metadata_json TEXT DEFAULT '{}',
    file TEXT,
    file_name TEXT,
    file_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    user TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user)
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    username_snapshot TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    client_mutation_id TEXT,
    deleted_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, client_mutation_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    reaction_type TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, source_type, source_id, reaction_type),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS feed_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS rewards_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    points INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id TEXT PRIMARY KEY,
    user TEXT,
    text TEXT,
    ts INTEGER,
    likes INTEGER DEFAULT 0,
    comments_json TEXT,
    category TEXT,
    listing_json TEXT,
    boosted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL,
    last_seen_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    namespace TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    data_json TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, namespace),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS user_rewards (
    user_id INTEGER PRIMARY KEY,
    points INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  `);
db.exec(`
  CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, timestamp);
  CREATE INDEX IF NOT EXISTS reactions_source_idx ON reactions(source_type, source_id);
  CREATE INDEX IF NOT EXISTS feed_entries_created_idx ON feed_entries(created_at DESC);
  CREATE INDEX IF NOT EXISTS rewards_transactions_user_idx ON rewards_transactions(user_id, created_at DESC);
`);
try { db.exec("ALTER TABLE chat_messages ADD COLUMN room TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN verified INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN category TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN listing_data TEXT"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN repost_of INTEGER"); } catch {}
try { db.exec("ALTER TABLE chat_messages ADD COLUMN repost_note TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN description TEXT"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN file TEXT"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN file_name TEXT"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN file_type TEXT"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN post_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN user_id INTEGER"); } catch {}
try { db.exec("ALTER TABLE comments ADD COLUMN metadata_json TEXT DEFAULT '{}'"); } catch {}
try {
  db.exec("CREATE INDEX IF NOT EXISTS ghost_drops_wallet_idx ON ghost_drops(wallet_address)");
} catch {}

const requestedProfileMemoryPath = process.env.PROFILE_MEMORY_PATH || path.join(dbDir, "profile_memory", "main.json");
const profileMemoryDir = ensureWritableDir(path.dirname(requestedProfileMemoryPath), path.join(fallbackDataDir, "profile_memory"), "profile memory");
const PROFILE_MEMORY_PATH = path.join(profileMemoryDir, path.basename(requestedProfileMemoryPath));
if (PROFILE_MEMORY_PATH !== requestedProfileMemoryPath) {
  console.warn(`[storage] Falling back from profile memory path ${requestedProfileMemoryPath} to ${PROFILE_MEMORY_PATH}.`);
}

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
const requestedUploadRoot = process.env.UPLOAD_DIR || (process.env.NODE_ENV === "production" ? path.join(dbDir, "uploads") : path.join(ROOT, "static", "profiles"));
const uploadRoot = ensureWritableDir(requestedUploadRoot, path.join(fallbackDataDir, "uploads"), "upload");
if (uploadRoot !== requestedUploadRoot) {
  console.warn(`[storage] Falling back from upload directory ${requestedUploadRoot} to ${uploadRoot}.`);
}
const profileDir = ensureWritableDir(path.join(uploadRoot, "profiles"), path.join(fallbackDataDir, "uploads", "profiles"), "profile upload");
const storage = multer.diskStorage({
  destination: profileDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.random().toString(36).slice(2) + ext);
  },
});
const upload = multer({ storage });
function profileUploadUrl(file) {
  if (!file) return null;
  return profileDir === path.join(ROOT, "static", "profiles")
    ? "/static/profiles/" + file.filename
    : "/uploads/" + file.filename;
}

const SESSION_COOKIE = "chaines_session";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const SESSION_REFRESH_MS = 10 * 60 * 1000;
const rateBuckets = new Map();
function parseCookies(header = "") { return Object.fromEntries(String(header).split(";").map(v => v.trim()).filter(Boolean).map(v => { const i=v.indexOf("="); return [decodeURIComponent(i>=0?v.slice(0,i):v), decodeURIComponent(i>=0?v.slice(i+1):"")]; })); }
function hashToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function rateLimit(name, max = 12, windowMs = 60_000) { return (req, res, next) => { const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local"; const key = `${name}:${ip}`; const now = Date.now(); const bucket = (rateBuckets.get(key) || []).filter(t => now - t < windowMs); if (bucket.length >= max) return res.status(429).json({ error: "Too many requests" }); bucket.push(now); rateBuckets.set(key, bucket); next(); }; }
function sessionCookie(value = "", expires) { return [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", process.env.NODE_ENV === "production" ? "Secure" : "", expires ? `Expires=${expires.toUTCString()}` : ""].filter(Boolean).join("; "); }
function createSession(res, userId) { const token = crypto.randomBytes(32).toString("base64url"); const now = new Date(); const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000); db.prepare("INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(userId, hashToken(token), now.toISOString(), now.toISOString(), expires.toISOString()); res.setHeader("Set-Cookie", sessionCookie(token, expires)); return { token, expires }; }
function loadSession(req) { const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE]; if (!token) return null; const row = db.prepare(`SELECT s.*, u.username, u.profile_pic, u.description FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL`).get(hashToken(token)); if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null; const last = new Date(row.last_seen_at).getTime() || 0; if (Date.now() - last > SESSION_REFRESH_MS) db.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").run(new Date().toISOString(), row.id); return { id: row.id, user: { id: row.user_id, username: row.username, profilePic: row.profile_pic || null, verified: true, description: row.description || null }, expiresAt: row.expires_at, tokenHash: row.token_hash }; }
function attachSession(req, _res, next) { req.session = loadSession(req); next(); }
function requireSession(req, res, next) { if (!req.session) return res.status(401).json({ error: "Authentication required" }); next(); }
function publicSession(req) { return req.session ? { user: req.session.user, expiresAt: req.session.expiresAt } : null; }
function validNamespace(ns="") { return /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(ns)); }
function safeMemoryPayload(body = {}) { const json = JSON.stringify(body ?? {}); if (json.length > 65536) throw new Error("Memory payload too large"); return json; }
function parseJsonField(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function rewardAccount(userId) {
  db.prepare("INSERT OR IGNORE INTO user_rewards (user_id, points, data_json) VALUES (?, 0, '{}')").run(userId);
  const row = db.prepare("SELECT points, data_json, updated_at FROM user_rewards WHERE user_id=?").get(userId);
  const data = parseJsonField(row?.data_json, {});
  const history = db.prepare("SELECT action, points, idempotency_key, metadata_json, created_at FROM rewards_transactions WHERE user_id=? ORDER BY id DESC LIMIT 120").all(userId);
  return { points: Number(row?.points || 0), updatedAt: row?.updated_at || null, flags: data.flags || {}, history: history.map(h => ({ action: h.action, points: h.points, idempotencyKey: h.idempotency_key, metadata: parseJsonField(h.metadata_json, {}), createdAt: h.created_at })) };
}
function awardReward(userId, action, points, key, metadata = {}) {
  try {
    db.prepare("INSERT INTO rewards_transactions (user_id, action, points, idempotency_key, metadata_json) VALUES (?, ?, ?, ?, ?)").run(userId, action, points, key, JSON.stringify(metadata || {}));
    db.prepare("INSERT INTO user_rewards (user_id, points, data_json, updated_at) VALUES (?, ?, '{}', CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET points=points+excluded.points, updated_at=CURRENT_TIMESTAMP").run(userId, points);
  } catch (e) {
    if (!String(e.message || "").includes("UNIQUE")) throw e;
    db.prepare("INSERT OR IGNORE INTO user_rewards (user_id, points, data_json) VALUES (?, 0, '{}')").run(userId);
  }
  return rewardAccount(userId);
}
function normalizeComment(row = {}) {
  return { id: row.id, postId: row.post_id, userId: row.user_id, username: row.user || row.username_snapshot, text: row.text || "", metadata: parseJsonField(row.metadata_json, {}), createdAt: row.timestamp || row.created_at };
}
function normalizePost(row = {}, includeComments = true) {
  const metadata = parseJsonField(row.metadata_json, {});
  const comments = includeComments ? db.prepare("SELECT * FROM comments WHERE post_id=? ORDER BY id").all(row.id).map(normalizeComment) : [];
  const reactions = db
    .prepare("SELECT reaction_type, COUNT(*) AS count FROM reactions WHERE source_type='post' AND source_id=? GROUP BY reaction_type ORDER BY reaction_type")
    .all(row.id)
    .map((reaction) => ({ type: reaction.reaction_type, count: reaction.count }));
  const likeCount = reactions.find((reaction) => reaction.type === "like")?.count || 0;
  const media = {
    image: metadata.image || null,
    file: metadata.file || null,
    fileName: metadata.fileName || metadata.file_name || null,
    fileType: metadata.fileType || metadata.file_type || null,
  };
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username_snapshot || row.username,
    profilePic: row.profile_pic || null,
    body: row.body || "",
    text: row.body || "",
    message: row.body || "",
    ts: row.created_at ? Date.parse(row.created_at) : null,
    metadata,
    comments,
    reactions,
    likeCount,
    clientMutationId: row.client_mutation_id || null,
    media,
    image: media.image,
    file: media.file,
    fileName: media.fileName,
    file_name: media.fileName,
    fileType: media.fileType,
    file_type: media.fileType,
    category: metadata.category || null,
    listing: metadata.listing || null,
    marketplace: metadata.marketplace || metadata.listing || null,
    repost: metadata.repost || null,
    repostOf: metadata.repostOf || metadata.repost_of || null,
    quotePost: metadata.quotePost || metadata.quote || null,
    rewards: metadata.rewards || null,
    ownerId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
  };
}
function postRowById(id) {
  return db.prepare(`SELECT p.*, u.profile_pic FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(id);
}

app.use(attachSession);
app.use("/static", express.static(path.join(ROOT, "static")));
app.use("/uploads", express.static(profileDir));
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
        JSON.stringify({ title, body, url: opts.url || "/" })
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

function addUserNotification(username = "", type = "", data = {}, pushTitle = "", pushBody = "", pushOpts = {}) {
  const target = sanitizeUsername(username);
  if (!target || !type) return false;
  db.prepare(
    "INSERT INTO notifications (username, type, data) VALUES (?, ?, ?)"
  ).run(target, String(type).slice(0, 48), JSON.stringify(data || {}));
  if (pushTitle && pushBody) {
    sendPush(target, pushTitle, pushBody, pushOpts);
  }
  return true;
}

function sanitizeUsername(name = "") {
  return String(name).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24);
}

const ADMIN_ACCOUNT = Object.freeze({
  username: sanitizeUsername(process.env.ADMIN_USERNAME || "admin"),
  password: process.env.ADMIN_PASSWORD || "",
});
const DEFAULT_RECEIPT_EMAIL = (process.env.DELIVERY_RECEIPT_EMAIL || "chadslondonrentals@gmail.com").trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || "").trim();
const RECEIPT_FROM_EMAIL = (process.env.RECEIPT_FROM_EMAIL || "CHAINeS Delivery <onboarding@resend.dev>").trim();

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

function ensureAdminAccount() {
  const username = sanitizeUsername(ADMIN_ACCOUNT.username);
  if (!username || !ADMIN_ACCOUNT.password) {
    console.warn("[admin] ADMIN_PASSWORD is not set; delivery admin bootstrap skipped.");
    return;
  }

  const hash = bcrypt.hashSync(ADMIN_ACCOUNT.password, 10);
  const dbUser = db
    .prepare("SELECT username, password, profile_pic, description FROM users WHERE username=?")
    .get(username);

  if (!dbUser) {
    try {
      db.prepare(
        "INSERT INTO users (username, password, profile_pic, description) VALUES (?,?,?,?)"
      ).run(username, hash, null, "System admin account for routed delivery orders.");
    } catch {}
  } else {
    const currentHash = dbUser.password || "";
    const validHash = currentHash && bcrypt.compareSync(ADMIN_ACCOUNT.password, currentHash);
    if (!validHash) {
      try {
        db.prepare("UPDATE users SET password=? WHERE username=?").run(hash, username);
      } catch {}
    }
  }

  const mem = profiles[username] || {};
  profiles[username] = {
    ...mem,
    profilePic: mem.profilePic ?? dbUser?.profile_pic ?? null,
    description:
      mem.description ??
      dbUser?.description ??
      "System admin account for routed delivery orders.",
  };
  saveProfiles();
}

function buildReceiptText(request = {}) {
  const itemSummary = Array.isArray(request.items)
    ? request.items.map((item) => `${Number(item?.qty || 1)}x ${String(item?.name || "Item").trim()}`).join(", ")
    : "";
  return [
    "CHAINeS Delivery Receipt",
    `Receipt ID: ${request.id || `DLV-${Date.now().toString(36).toUpperCase()}`}`,
    `Created: ${request.createdAt || new Date().toISOString()}`,
    `Customer: ${request.customer?.name || ""}`,
    `Phone: ${request.customer?.phone || ""}`,
    `Pickup: ${request.route?.pickup || ""}`,
    `Dropoff: ${request.route?.dropoff || ""}`,
    `Service: ${request.service?.name || "Custom request"} (${request.service?.category || "General"})`,
    `Delivery Type: ${request.service?.deliveryType || "meal"}`,
    `Type Details: ${request.deliveryTypeDetails || "N/A"}`,
    `Partner Tier: ${request.partnerTier?.name || ""}`,
    `Speed: ${request.speed || "standard"}`,
    `Tip: $${Number(request.tip || 0).toFixed(2)}`,
    `Budget: $${Number(request.budget || 0).toFixed(2)}`,
    `Total: $${Number(request.total || 0).toFixed(2)}`,
    `Items: ${itemSummary || "No items listed"}`,
    `Receipt Comment: ${request.receiptComment || "None"}`,
    `Notes: ${request.notes || "None"}`,
  ].join("\n");
}

async function sendDeliveryReceiptEmail(request = {}, to = DEFAULT_RECEIPT_EMAIL) {
  const target = String(to || DEFAULT_RECEIPT_EMAIL).trim() || DEFAULT_RECEIPT_EMAIL;
  if (!RESEND_API_KEY) {
    console.warn(`[delivery-receipt] RESEND_API_KEY missing. Receipt ${request.id || "N/A"} queued for ${target}.`);
    return { success: false, queued: true, reason: "missing_resend_api_key", to: target };
  }
  const subject = `Delivery Receipt ${request.id || `DLV-${Date.now().toString(36).toUpperCase()}`}`;
  const text = buildReceiptText(request);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RECEIPT_FROM_EMAIL,
        to: [target],
        subject,
        text,
      }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.error(`[delivery-receipt] Email failed ${response.status}: ${details}`);
      return { success: false, queued: false, status: response.status, to: target };
    }
    return { success: true, to: target };
  } catch (error) {
    console.error(`[delivery-receipt] Email error for ${target}:`, error);
    return { success: false, queued: true, reason: "network_error", to: target };
  }
}

ensureAdminAccount();

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
app.get(["/delivery-services", "/delivery-services.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "delivery-services.html"))
);
app.get(["/private-chat", "/private-chat.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "private-chat.html"))
);
app.get(["/profile", "/profile.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "profile.html"))
);
app.get(["/rewards-program", "/rewards-program.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "rewards-program.html"))
);
app.get(["/chaines-ar-collectibles", "/chaines-ar-collectibles.html", "/ar-player"], (req, res) =>
  res.sendFile(path.join(ROOT, "chaines-ar-collectibles.html"))
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

app.post("/register", rateLimit("register", 5), upload.single("profile"), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  const cleanUsername = sanitizeUsername(username);
  const existingUser = db.prepare("SELECT 1 FROM users WHERE username=?").get(cleanUsername);
  if (!cleanUsername || existingUser) {
    res.status(400).json({ error: "User exists" });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    let pic = null;
    if (req.file) pic = profileUploadUrl(req.file);
    const info = db.prepare(
      "INSERT INTO users (username, password, profile_pic) VALUES (?,?,?)"
    ).run(cleanUsername, hash, pic);
    profiles[cleanUsername] = { profilePic: pic, description: null };
    saveProfiles();
    const session = createSession(res, Number(info.lastInsertRowid));
    res.json({ success: true, session: { user: { id: Number(info.lastInsertRowid), username: cleanUsername, profilePic: pic, verified: true }, expiresAt: session.expires.toISOString() } });
  } catch (e) {
    res.status(400).json({ error: "User exists" });
  }
});

app.post("/login", rateLimit("login", 8), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  if (sanitizeUsername(username) === ADMIN_ACCOUNT.username) {
    ensureAdminAccount();
  }
  const dbUser = db
    .prepare("SELECT id, username, password, profile_pic FROM users WHERE username=?")
    .get(sanitizeUsername(username));
  const memUser = profiles[sanitizeUsername(username)];
  const hash = dbUser?.password;
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
  profiles[dbUser.username] = { ...(memUser || {}), profilePic };
  saveProfiles();
  const session = createSession(res, dbUser.id);
  res.json({ success: true, username: dbUser.username, profilePic, session: { user: { id: dbUser.id, username: dbUser.username, profilePic, verified: true }, expiresAt: session.expires.toISOString() } });
});


app.get("/api/session", (req, res) => {
  const session = publicSession(req);
  if (!session) return res.status(401).json({ error: "No valid session" });
  res.json(session);
});
app.get("/api/users/me/profile", requireSession, (req, res) => {
  const row = db.prepare("SELECT id, username, profile_pic, description FROM users WHERE id=?").get(req.session.user.id);
  res.json({ profile: { userId: row.id, username: row.username, displayName: row.username, profilePic: row.profile_pic || null, description: row.description || "", bio: row.description || "" } });
});
app.put("/api/users/me/profile", requireSession, upload.single("profile"), (req, res) => {
  const description = String(req.body?.description ?? req.body?.bio ?? "").slice(0, 2000);
  let pic = req.body?.profilePic ? String(req.body.profilePic).slice(0, 4096) : null;
  if (req.file) pic = profileUploadUrl(req.file);
  const current = db.prepare("SELECT profile_pic FROM users WHERE id=?").get(req.session.user.id);
  db.prepare("UPDATE users SET description=?, profile_pic=? WHERE id=?").run(description || null, pic || current?.profile_pic || null, req.session.user.id);
  const row = db.prepare("SELECT id, username, profile_pic, description FROM users WHERE id=?").get(req.session.user.id);
  const profile = { userId: row.id, username: row.username, displayName: row.username, profilePic: row.profile_pic || null, description: row.description || "", bio: row.description || "" };
  broadcastJson({ type: "profile:updated", profile });
  res.json({ profile });
});
app.post("/api/session/refresh", rateLimit("session-refresh", 20), requireSession, (req, res) => {
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare("UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?").run(new Date().toISOString(), expires.toISOString(), req.session.id);
  res.setHeader("Set-Cookie", sessionCookie(parseCookies(req.headers.cookie || "")[SESSION_COOKIE], expires));
  res.json({ user: req.session.user, expiresAt: expires.toISOString() });
});
app.post("/logout", (req, res) => {
  if (req.session) db.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").run(new Date().toISOString(), req.session.id);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ success: true });
});
app.get("/api/memory", requireSession, (req, res) => {
  const rows = db.prepare("SELECT namespace, schema_version, data_json, updated_at FROM user_memory WHERE user_id=?").all(req.session.user.id);
  res.json({ namespaces: Object.fromEntries(rows.map(r => [r.namespace, { schemaVersion: r.schema_version, updatedAt: r.updated_at, data: JSON.parse(r.data_json || '{}') }])) });
});
app.get("/api/memory/:namespace", requireSession, (req, res) => {
  const ns = req.params.namespace; if (!validNamespace(ns)) return res.status(400).json({ error: "Invalid namespace" });
  const row = db.prepare("SELECT schema_version, data_json, updated_at FROM user_memory WHERE user_id=? AND namespace=?").get(req.session.user.id, ns);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ namespace: ns, schemaVersion: row.schema_version, updatedAt: row.updated_at, data: JSON.parse(row.data_json || '{}') });
});
app.put("/api/memory/:namespace", requireSession, (req, res) => {
  const ns = req.params.namespace; if (!validNamespace(ns)) return res.status(400).json({ error: "Invalid namespace" });
  let json; try { json = safeMemoryPayload(req.body?.data ?? req.body ?? {}); } catch(e) { return res.status(413).json({ error: e.message }); }
  const ver = Math.max(1, Number(req.body?.schemaVersion || 1));
  const now = new Date().toISOString();
  db.prepare("INSERT INTO user_memory (user_id, namespace, schema_version, data_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, namespace) DO UPDATE SET schema_version=excluded.schema_version, data_json=excluded.data_json, updated_at=excluded.updated_at").run(req.session.user.id, ns, ver, json, now);
  res.json({ namespace: ns, schemaVersion: ver, updatedAt: now, data: JSON.parse(json) });
});
app.patch("/api/memory/:namespace", requireSession, (req, res) => {
  const ns = req.params.namespace; if (!validNamespace(ns)) return res.status(400).json({ error: "Invalid namespace" });
  const row = db.prepare("SELECT data_json, schema_version FROM user_memory WHERE user_id=? AND namespace=?").get(req.session.user.id, ns);
  const base = row ? JSON.parse(row.data_json || '{}') : {};
  const next = { ...base, ...(req.body?.data ?? req.body ?? {}) };
  let json; try { json = safeMemoryPayload(next); } catch(e) { return res.status(413).json({ error: e.message }); }
  const now = new Date().toISOString();
  db.prepare("INSERT INTO user_memory (user_id, namespace, schema_version, data_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, namespace) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at").run(req.session.user.id, ns, row?.schema_version || 1, json, now);
  res.json({ namespace: ns, schemaVersion: row?.schema_version || 1, updatedAt: now, data: next });
});
app.delete("/api/memory/:namespace", requireSession, (req, res) => { const ns=req.params.namespace; if (!validNamespace(ns)) return res.status(400).json({ error: "Invalid namespace" }); db.prepare("DELETE FROM user_memory WHERE user_id=? AND namespace=?").run(req.session.user.id, ns); res.json({ success: true }); });

app.get("/api/rewards/account", requireSession, (req, res) => {
  res.json({ account: rewardAccount(req.session.user.id) });
});

app.get("/api/feeds/global", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const before = Number(req.query.before || 0);
  const rows = db.prepare(`
    SELECT p.*, u.profile_pic
    FROM posts p
    JOIN users u ON u.id=p.user_id
    ${before ? "WHERE p.id < ? AND p.deleted_at IS NULL" : "WHERE p.deleted_at IS NULL"}
    ORDER BY p.id DESC
    LIMIT ?
  `).all(...(before ? [before, limit] : [limit]));
  res.json({ posts: rows.map(r => normalizePost(r)), nextBefore: rows.length ? rows[rows.length - 1].id : null });
});

app.post("/api/posts", requireSession, (req, res) => {
  const body = String(req.body?.body ?? req.body?.message ?? req.body?.text ?? "").trim();
  const clientMutationId = String(req.body?.clientMutationId || crypto.randomUUID()).slice(0, 128);
  if (!body) return res.status(400).json({ error: "Post body required" });
  if (body.length > 5000) return res.status(400).json({ error: "Post body too long" });
  const metadataJson = safeMemoryPayload(req.body?.metadata || {});
  const tx = db.transaction(() => {
    let postId;
    const existing = db.prepare("SELECT id FROM posts WHERE user_id=? AND client_mutation_id=?").get(req.session.user.id, clientMutationId);
    if (existing) {
      postId = existing.id;
    } else {
      const info = db.prepare("INSERT INTO posts (user_id, username_snapshot, body, metadata_json, client_mutation_id) VALUES (?, ?, ?, ?, ?)").run(req.session.user.id, req.session.user.username, body, metadataJson, clientMutationId);
      postId = Number(info.lastInsertRowid);
      db.prepare("INSERT OR IGNORE INTO feed_entries (post_id) VALUES (?)").run(postId);
    }
    const account = awardReward(req.session.user.id, "post_created", 10, `post_created:${req.session.user.id}:${postId}`, { postId });
    return { post: normalizePost(postRowById(postId)), rewards: account };
  });
  const payload = tx();
  broadcastJson({ type: "feed:post-created", post: payload.post, rewards: payload.rewards });
  res.status(201).json(payload);
});

app.patch("/api/posts/:id", requireSession, (req, res) => {
  const row = postRowById(req.params.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: "Post not found" });
  if (row.user_id !== req.session.user.id) return res.status(403).json({ error: "Cannot edit another user's post" });
  const body = String(req.body?.body ?? "").trim();
  if (!body) return res.status(400).json({ error: "Post body required" });
  db.prepare("UPDATE posts SET body=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(body, row.id);
  const post = normalizePost(postRowById(row.id));
  broadcastJson({ type: "feed:post-updated", post });
  res.json({ post });
});

app.delete("/api/posts/:id", requireSession, (req, res) => {
  const row = postRowById(req.params.id);
  if (!row || row.deleted_at) return res.status(404).json({ error: "Post not found" });
  if (row.user_id !== req.session.user.id) return res.status(403).json({ error: "Cannot delete another user's post" });
  db.prepare("UPDATE posts SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  broadcastJson({ type: "feed:post-deleted", postId: row.id });
  res.json({ success: true, postId: row.id });
});

app.post("/api/posts/:id/comments", requireSession, (req, res) => {
  const post = postRowById(req.params.id);
  if (!post || post.deleted_at) return res.status(404).json({ error: "Post not found" });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Comment text required" });
  const metadataJson = safeMemoryPayload(req.body?.metadata || {});
  const tx = db.transaction(() => {
    const info = db.prepare("INSERT INTO comments (post_id, user_id, user, text, metadata_json) VALUES (?, ?, ?, ?, ?)").run(post.id, req.session.user.id, req.session.user.username, text, metadataJson);
    const comment = normalizeComment(db.prepare("SELECT * FROM comments WHERE id=?").get(Number(info.lastInsertRowid)));
    const rewards = awardReward(req.session.user.id, "comment_created", 2, `comment_created:${req.session.user.id}:${comment.id}`, { postId: post.id, commentId: comment.id });
    return { comment, post: normalizePost(postRowById(post.id)), rewards };
  });
  const payload = tx();
  broadcastJson({ type: "feed:comment-created", comment: payload.comment, post: payload.post });
  res.status(201).json(payload);
});

app.post("/api/posts/:id/reactions", requireSession, (req, res) => {
  const post = postRowById(req.params.id);
  if (!post || post.deleted_at) return res.status(404).json({ error: "Post not found" });
  const reactionType = String(req.body?.reactionType || "like").replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "like";
  const tx = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO reactions (user_id, source_type, source_id, reaction_type) VALUES (?, 'post', ?, ?)").run(req.session.user.id, post.id, reactionType);
    const rewards = awardReward(req.session.user.id, "reaction", 1, `reaction:${req.session.user.id}:${post.id}:${reactionType}`, { postId: post.id, reactionType });
    return { post: normalizePost(postRowById(post.id)), rewards };
  });
  const payload = tx();
  broadcastJson({ type: "feed:reaction-updated", post: payload.post });
  res.json(payload);
});

app.delete("/api/posts/:id/reactions", requireSession, (req, res) => {
  const post = postRowById(req.params.id);
  if (!post || post.deleted_at) return res.status(404).json({ error: "Post not found" });
  const reactionType = String(req.body?.reactionType || req.query.reactionType || "like").replace(/[^a-z0-9_-]/gi, "").slice(0, 24) || "like";
  db.prepare("DELETE FROM reactions WHERE user_id=? AND source_type='post' AND source_id=? AND reaction_type=?").run(req.session.user.id, post.id, reactionType);
  const normalized = normalizePost(postRowById(post.id));
  broadcastJson({ type: "feed:reaction-updated", post: normalized });
  res.json({ post: normalized, rewards: rewardAccount(req.session.user.id) });
});

app.post("/delivery-orders", requireSession, (req, res) => {
  ensureAdminAccount();
  const adminUsername = ADMIN_ACCOUNT.username;
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const deliveryId = String(payload.id || `DLV-${Date.now().toString(36).toUpperCase()}`);
  const customerName = String(payload.customer?.name || "Customer").trim() || "Customer";
  const serviceName = String(payload.service?.name || "Delivery request").trim() || "Delivery request";
  const deliveryType = String(payload.service?.deliveryType || "meal").trim() || "meal";
  const routeSummary = `${String(payload.route?.pickup || "Pickup TBD").trim()} → ${String(payload.route?.dropoff || "Dropoff TBD").trim()}`;
  const itemSummary = Array.isArray(payload.items)
    ? payload.items
        .slice(0, 8)
        .map((item) => `${Number(item?.qty || 1)}x ${String(item?.name || "Item").trim()}`)
        .join(", ")
    : "";
  const message = `Delivery ${deliveryId} | ${customerName} | ${serviceName} (${deliveryType}) | ${routeSummary}${itemSummary ? ` | ${itemSummary}` : ""}`;

  const notifPayload = {
    id: deliveryId,
    customer: payload.customer || {},
    route: payload.route || {},
    service: payload.service || {},
    items: Array.isArray(payload.items) ? payload.items : [],
    createdAt: payload.createdAt || new Date().toISOString(),
  };

  const notifResult = db
    .prepare("INSERT INTO notifications (username, type, data) VALUES (?, 'delivery-order', ?)")
    .run(adminUsername, JSON.stringify(notifPayload));
  const messageResult = db
    .prepare("INSERT INTO chat_messages (user, message, category, listing_data, room) VALUES (?, ?, ?, ?, ?)")
    .run(
      adminUsername,
      message,
      "meal-delivery",
      JSON.stringify({
        category: "meal-delivery",
        serviceType: "delivery-order",
        subcategory: deliveryType,
        condition: serviceName,
      }),
      "main"
    );

  sendPush(adminUsername, "New delivery order", `${customerName} placed ${deliveryId}`, {
    requireLive: true,
    url: "/delivery-services.html",
  });

  const receiptTargetEmail = String(payload.receiptEmail || DEFAULT_RECEIPT_EMAIL || "").trim() || DEFAULT_RECEIPT_EMAIL;
  console.log(`[delivery-orders] ${deliveryId} confirmed and routed to @admin. Receipt target: ${receiptTargetEmail}`);
  sendDeliveryReceiptEmail({ ...payload, id: deliveryId }, receiptTargetEmail).catch(() => {});

  res.json({
    success: true,
    adminUsername,
    notificationId: notifResult.lastInsertRowid,
    messageId: messageResult.lastInsertRowid,
    receiptTargetEmail,
  });
});

app.post("/receipt-email", async (req, res) => {
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const requestData = payload.request && typeof payload.request === "object" ? payload.request : {};
  const to = String(payload.to || DEFAULT_RECEIPT_EMAIL).trim() || DEFAULT_RECEIPT_EMAIL;
  const result = await sendDeliveryReceiptEmail(requestData, to);
  res.status(result.success ? 200 : 202).json({
    success: Boolean(result.success),
    queued: Boolean(result.queued),
    to: result.to || to,
  });
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
      "SELECT id, username, profile_pic, description FROM users WHERE username=?"
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
          `SELECT p.*, u.profile_pic
           FROM posts p
           JOIN users u ON u.id=p.user_id
           WHERE p.user_id=? AND p.deleted_at IS NULL
           ORDER BY p.id DESC`
        )
        .all(dbUser.id)
        .map((post) => normalizePost(post))
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

app.post("/profile/:username", requireSession, upload.single("profile"), (req, res) => {
  if (req.session.user.username !== req.params.username) return res.status(403).json({ error: "Cannot edit another profile" });
  const { description } = req.body || {};
  let pic = null;
  if (req.file) pic = profileUploadUrl(req.file);
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
      `${follower} started following you`,
      { url: `/profile.html?user=${encodeURIComponent(follower)}` }
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
    sendPush(target, "New Dating Like", `${actor} liked your dating profile`, { url: "/marketplace.html?tab=dating" });
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
      sendPush(actor, "Dating Match", `You and ${target} liked each other`, { url: `/profile.html?user=${encodeURIComponent(target)}` });
      sendPush(target, "Dating Match", `You and ${actor} liked each other`, { url: `/profile.html?user=${encodeURIComponent(actor)}` });
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

app.post("/notifications/emit", (req, res) => {
  const actor = sanitizeUsername(req.body?.actor || "");
  const target = sanitizeUsername(req.body?.target || "");
  const type = String(req.body?.type || "").trim().toLowerCase();
  const messageId = String(req.body?.messageId || "").trim().slice(0, 64);
  const allowedTypes = new Set(["marketplace-like", "marketplace-comment", "marketplace-contact", "delivery-request"]);
  if (!actor || !target || !type || actor === target || !allowedTypes.has(type)) {
    res.status(400).json({ error: "Invalid notification payload" });
    return;
  }
  const bodyMap = {
    "marketplace-like": `${actor} liked your marketplace listing`,
    "marketplace-comment": `${actor} commented on your marketplace listing`,
    "marketplace-contact": `${actor} sent you a marketplace contact message`,
    "delivery-request": `${actor} sent a delivery request linked to your listing`,
  };
  const urlMap = {
    "marketplace-like": "/marketplace.html",
    "marketplace-comment": "/marketplace.html",
    "marketplace-contact": "/marketplace.html",
    "delivery-request": "/delivery-services.html",
  };
  addUserNotification(
    target,
    type,
    { from: actor, messageId, text: String(req.body?.text || "").trim().slice(0, 280) },
    "CHAINeS Notification",
    bodyMap[type],
    { url: urlMap[type] || "/" }
  );
  res.json({ success: true });
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

const MARKETPLACE_ALLOWED_CATEGORIES = new Set([
  "general",
  "jobs",
  "for-sale",
  "clothes",
  "tech",
  "energy",
  "appliances",
  "kitchen-supplies",
  "needs-bath",
  "toys",
  "services",
  "meal-delivery",
  "housing",
  "community",
  "dating",
  "ads",
]);

function normalizeMarketplaceListingPayload(payload = {}, fallbackCategory = "general") {
  const categoryCandidate = String(payload.category || fallbackCategory || "general").trim().toLowerCase();
  const category = MARKETPLACE_ALLOWED_CATEGORIES.has(categoryCandidate) ? categoryCandidate : "general";
  const media = Array.isArray(payload.media)
    ? payload.media
        .filter((item) => item && item.url && item.type)
        .map((item) => ({
          url: String(item.url || "").trim(),
          type: String(item.type || "").trim(),
          name: String(item.name || "").trim(),
          size: Number(item.size) || 0,
        }))
        .filter((item) => item.url && item.type)
    : [];
  return {
    category,
    price: String(payload.price || "").trim(),
    location: String(payload.location || "").trim(),
    condition: String(payload.condition || "").trim(),
    serviceType: String(payload.serviceType || "").trim(),
    subcategory: String(payload.subcategory || "").trim(),
    jobLocation: String(payload.jobLocation || "").trim(),
    credentials: String(payload.credentials || "").trim(),
    contactInfo: String(payload.contactInfo || "").trim(),
    availability: String(payload.availability || "").trim(),
    interests: String(payload.interests || "").trim(),
    age: Number.isFinite(Number(payload.age)) ? Number(payload.age) : null,
    gender: String(payload.gender || "").trim(),
    lookingFor: String(payload.lookingFor || "").trim(),
    datingIntent: String(payload.datingIntent || "").trim(),
    firstDate: String(payload.firstDate || "").trim(),
    datingLikes: String(payload.datingLikes || "").trim(),
    datingDislikes: String(payload.datingDislikes || "").trim(),
    datingBio: String(payload.datingBio || "").trim(),
    media,
  };
}

function normalizeMarketplaceItem(item = {}) {
  const now = Date.now();
  const listing = normalizeMarketplaceListingPayload(item.listing || {}, item.category || "general");
  const comments = Array.isArray(item.comments)
    ? item.comments
        .map((comment) => ({
          user: String((comment && comment.user) || "anon").trim().slice(0, 24) || "anon",
          text: String((comment && comment.text) || "").trim().slice(0, 240),
          ts: Number(comment && comment.ts) || now,
        }))
        .filter((comment) => comment.text)
    : [];
  return {
    id: String(item.id || `${now}-${Math.random().toString(36).slice(2, 8)}`),
    user: String(item.user || "anon").trim().slice(0, 24) || "anon",
    text: String(item.text || "").trim().slice(0, 800),
    ts: Number(item.ts) || now,
    likes: Math.max(0, Number(item.likes || 0)),
    comments,
    category: listing.category,
    listing,
    boostedAt: item.boostedAt ? Number(item.boostedAt) : null,
  };
}

app.get("/api/marketplace/listings", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, user, text, ts, likes, comments_json, category, listing_json, boosted_at
       FROM marketplace_listings
       ORDER BY ts ASC`
    )
    .all();
  const items = rows.map((row) => {
    let listing = {};
    let comments = [];
    try {
      listing = row.listing_json ? JSON.parse(row.listing_json) : {};
    } catch {}
    try {
      comments = row.comments_json ? JSON.parse(row.comments_json) : [];
    } catch {}
    return normalizeMarketplaceItem({
      id: row.id,
      user: row.user,
      text: row.text,
      ts: row.ts,
      likes: row.likes,
      comments,
      category: row.category,
      listing,
      boostedAt: row.boosted_at,
    });
  });
  res.json({ items });
});

app.put("/api/marketplace/listings", (req, res) => {
  const payloadItems = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!payloadItems) {
    res.status(400).json({ error: "items array is required" });
    return;
  }
  if (payloadItems.length > 600) {
    res.status(400).json({ error: "Too many listings in one sync request" });
    return;
  }
  const cleaned = payloadItems.map((item) => normalizeMarketplaceItem(item));
  const writeTxn = db.transaction((items) => {
    db.prepare("DELETE FROM marketplace_listings").run();
    const insert = db.prepare(
      `INSERT INTO marketplace_listings (id, user, text, ts, likes, comments_json, category, listing_json, boosted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insert.run(
        item.id,
        item.user,
        item.text,
        item.ts,
        item.likes,
        JSON.stringify(item.comments || []),
        item.category,
        JSON.stringify(item.listing || {}),
        item.boostedAt || null
      );
    }
  });
  writeTxn(cleaned);
  res.json({ ok: true, count: cleaned.length });
});

const MARKETPLACE_CATEGORIES = new Set([
  "general",
  "jobs",
  "for-sale",
  "clothes",
  "tech",
  "energy",
  "appliances",
  "kitchen-supplies",
  "needs-bath",
  "toys",
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
      `SELECT id, message_id, user, text, file, file_name, file_type, strftime('%s', timestamp) * 1000 as ts FROM comments ORDER BY id`
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
      file: c.file,
      fileName: c.file_name,
      fileType: c.file_type,
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
const guestApprovedByHost = new Map(); // hostId -> approved guestId
const guestHosts = new Map(); // guestId -> hostId
const micGuests = new Set(); // audio-only broadcasters
const broadcastRooms = new Map(); // roomId -> authoritative room/stage state

function broadcastJson(payload = {}) {
  const encoded = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(encoded); } catch {}
    }
  }
}

function normalizeLiveSignal(message = {}){
  return {
    ...message,
    fromParticipantId: message.fromParticipantId || message.from || message.senderId || message.id,
    toParticipantId: message.toParticipantId || message.targetId || message.to,
    roomId: message.roomId || message.hostId || message.room
  };
}
function logLiveSignal(signal = {}){
  console.debug('[live-signal]', {
    type: signal.type,
    roomId: signal.roomId,
    from: signal.fromParticipantId,
    to: signal.toParticipantId,
    legacyId: signal.id
  });
}
function ensureBroadcastRoom(roomId, hostId = roomId){
  if(!broadcastRooms.has(roomId)){
    broadcastRooms.set(roomId, { roomId, hostId, stageMembers: new Map(), audienceMembers: new Map(), stageRequests: new Map(), connectionGeneration: 0 });
  }
  return broadcastRooms.get(roomId);
}
function serializeBroadcastRoom(room){
  return { type: 'room-state', roomId: room.roomId, hostId: room.hostId, stageMembers: Array.from(room.stageMembers.values()), audienceMembers: Array.from(room.audienceMembers.values()), stageRequests: Array.from(room.stageRequests.values()), connectionGeneration: room.connectionGeneration };
}
function sendRoomState(roomId){
  const room = broadcastRooms.get(roomId);
  if(!room) return;
  const payload = JSON.stringify(serializeBroadcastRoom(room));
  const targets = new Set([room.hostId, ...room.stageMembers.keys(), ...room.audienceMembers.keys(), ...(listeners.get(roomId) || [])]);
  for(const id of targets){ const client = clients.get(id); if(client && client.readyState === 1) client.send(payload); }
}
const secureLiveParticipants = new Map(); // ws.id -> { id, user }
const secureLivePresence = new Map(); // ws.id -> lastSeenMs
const SECURE_LIVE_ACTIVE_WINDOW_MS = 35000;

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

function activeSecureLiveCount() {
  const now = Date.now();
  for (const [id, lastSeen] of secureLivePresence.entries()) {
    if (now - Number(lastSeen || 0) > SECURE_LIVE_ACTIVE_WINDOW_MS) {
      secureLivePresence.delete(id);
    }
  }
  let count = 0;
  for (const id of secureLiveParticipants.keys()) {
    const lastSeen = secureLivePresence.get(id) || 0;
    if (now - Number(lastSeen) <= SECURE_LIVE_ACTIVE_WINDOW_MS) count += 1;
  }
  return count;
}

function broadcastSecureLiveActiveCount() {
  const payload = JSON.stringify({ type: "secure-live-active-count", count: activeSecureLiveCount() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

setInterval(() => {
  broadcastSecureLiveActiveCount();
}, 12000);

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
    secureLivePresence.delete(ws.id);
    if (secureLiveParticipants.delete(ws.id)) {
      broadcastSecureLiveUsers();
      broadcastSecureLiveActiveCount();
    }
    if (broadcasters.has(ws.id)) {
      broadcasters.delete(ws.id);
      micGuests.delete(ws.id);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(JSON.stringify({ type: "bye", id: ws.id }));
      }
      guestApprovedByHost.delete(ws.id);
      for (const [hostId, guestId] of guestApprovedByHost.entries()) {
        if (guestId === ws.id) guestApprovedByHost.delete(hostId);
      }
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
        broadcasters.set(ws.id, ws);
        const ownRoom = ensureBroadcastRoom(ws.id, ws.id);
        ownRoom.stageMembers.set(ws.id, { id: ws.id, user: ws.username || '', role: 'host', media: { audio: true, video: true }, muted: false, live: true });
        sendRoomState(ws.id);
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
            { requireLive: true, url: "/?tab=broadcast" }
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
        const micRoomId = guestHosts.get(ws.id) || ws.id;
        const micRoom = ensureBroadcastRoom(micRoomId, micRoomId);
        micRoom.stageMembers.set(ws.id, { id: ws.id, user: ws.username || '', role: 'speaker', media: { audio: true, video: false }, muted: false, live: true });
        sendRoomState(micRoomId);
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
          guestApprovedByHost.delete(ws.id);
      for (const [hostId, guestId] of guestApprovedByHost.entries()) {
        if (guestId === ws.id) guestApprovedByHost.delete(hostId);
      }
          if(listeners.has(ws.id)){
            listeners.delete(ws.id);
            sendListenerCount(ws.id);
          }
          broadcastUsers();
        }
        return;
      case "join-request": {
        const host = broadcasters.get(msg.id);
        if (msg.id && guestApprovedByHost.get(msg.id)) {
          ws.send(JSON.stringify({ type: "join-denied" }));
          return;
        }
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
            `${ws.username || "Someone"} requested to join your broadcast`,
            { url: "/?tab=broadcast" }
          );
        } else {
          ws.send(JSON.stringify({ type: "join-denied" }));
        }
        return;
      }
      case "stage-request": {
        const roomId = msg.roomId || msg.id;
        const room = ensureBroadcastRoom(roomId, roomId);
        const requestId = String(msg.requestId || `${ws.id}-${Date.now()}`);
        if(!room.stageRequests.has(requestId)){
          const request = { requestId, id: ws.id, user: ws.username || msg.user || '', requestedRole: msg.requestedRole || 'speaker', media: msg.media || { audio: true, video: false }, state: 'pending', ts: Date.now() };
          room.stageRequests.set(requestId, request);
          const host = clients.get(room.hostId);
          if(host && host.readyState === 1) host.send(JSON.stringify({ type: 'stage-request', roomId, ...request }));
          sendRoomState(roomId);
        }
        return;
      }
      case "mic-request": {
        const host = broadcasters.get(msg.id);
        if (host && host.readyState === 1) {
          host.send(
            JSON.stringify({ type: "mic-request", id: ws.id, user: ws.username, requestId: msg.requestId || null, roomId: msg.roomId || msg.id })
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
            `${ws.username || "Someone"} requested to join via mic`,
            { url: "/?tab=broadcast" }
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
        if (guestApprovedByHost.get(ws.id)) return;
        const guest = clients.get(msg.id);
        if (guest && broadcasters.has(ws.id)) {
          guestApprovedByHost.set(ws.id, msg.id);
          guestHosts.set(msg.id, ws.id);
          const room = ensureBroadcastRoom(ws.id, ws.id);
          room.stageMembers.set(msg.id, { id: msg.id, user: guest.username || '', role: 'guest', media: { audio: true, video: true }, muted: false, live: false });
          room.connectionGeneration += 1;
          sendRoomState(ws.id);
          guest.send(JSON.stringify({ type: "join-approved", roomId: ws.id, fromParticipantId: ws.id, toParticipantId: msg.id, connectionGeneration: room.connectionGeneration }));
        }
        return;
      }
      case "approve-mic": {
        const guest = clients.get(msg.id);
        if (guest && broadcasters.has(ws.id)) {
          const room = ensureBroadcastRoom(ws.id, ws.id);
          const request = Array.from(room.stageRequests.values()).find(item => item.id === msg.id && item.state === 'pending');
          if(request) request.state = 'approved';
          room.stageMembers.set(msg.id, { id: msg.id, user: guest.username || '', role: 'speaker', media: { audio: true, video: false }, muted: false, live: false });
          room.connectionGeneration += 1;
          sendRoomState(ws.id);
          guest.send(JSON.stringify({ type: "mic-approved", roomId: ws.id, fromParticipantId: ws.id, toParticipantId: msg.id, requestId: msg.requestId || request?.requestId || null, connectionGeneration: room.connectionGeneration }));
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
        const signal = normalizeLiveSignal(msg);
        const roomId = signal.roomId || signal.toParticipantId || signal.id;
        const hostId = signal.toParticipantId || signal.id || roomId;
        logLiveSignal({ ...signal, type: 'watcher', fromParticipantId: ws.id, toParticipantId: hostId, roomId });
        const host = broadcasters.get(hostId);
        if (host && host.readyState === 1) {
          const room = ensureBroadcastRoom(roomId, hostId);
          room.audienceMembers.set(ws.id, { id: ws.id, user: ws.username || '', role: 'audience', live: true });
          ws.send(JSON.stringify(serializeBroadcastRoom(room)));
          host.send(JSON.stringify({ type: "watcher", id: ws.id, roomId, fromParticipantId: ws.id, toParticipantId: hostId, connectionGeneration: room.connectionGeneration }));
          if(!listeners.has(roomId)) listeners.set(roomId, new Set());
          listeners.get(roomId).add(ws.id);
          if(!watching.has(ws.id)) watching.set(ws.id, new Set());
          watching.get(ws.id).add(roomId);
          sendListenerCount(roomId);
          const history = loadHistory(roomId);
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
        const text = String(msg.text || "").trim();
        const file = typeof msg.file === "string" ? msg.file : null;
        const fileName = msg.file_name || msg.fileName || null;
        const fileType = msg.file_type || msg.fileType || null;
        if (!msg.messageId || (!text && !file)) return;
        if (file && file.length > 50_000_000) return;
        const info = db
          .prepare(
            "INSERT INTO comments (message_id, user, text, file, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(msg.messageId, msg.user || "", text, file, fileName, fileType);
        const out = {
          type: "comment",
          id: info.lastInsertRowid,
          messageId: msg.messageId,
          user: msg.user || "",
          text,
          file,
          fileName,
          fileType,
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
              `${msg.user || "Someone"} liked your post #${msg.messageId}`,
              { url: `/?focus=${encodeURIComponent(String(msg.messageId))}` }
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
        const quoteText = String(msg.quoteText || "").trim().slice(0, 280);
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
            quoteText ? `Quoted by @${actor}: ${quoteText}` : `Reposted by @${actor}`
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
          repostNote: quoteText ? `Quoted by @${actor}: ${quoteText}` : `Reposted by @${actor}`,
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
            `${actor} reposted your post #${source.id}`,
            { url: `/?focus=${encodeURIComponent(String(source.id))}` }
          );
        }
        return;
      }
      case "offer":
      case "answer":
      case "candidate":
      case "bye": {
        const signal = normalizeLiveSignal(msg);
        const destinationId = signal.toParticipantId || signal.id || signal.targetId;
        const dest = clients.get(destinationId);
        if (dest && dest.readyState === 1) {
          const roomId = signal.roomId || guestHosts.get(ws.id) || guestHosts.get(destinationId) || destinationId || ws.id;
          const room = broadcastRooms.get(roomId);
          if(room && ![room.hostId, ...room.stageMembers.keys(), ...room.audienceMembers.keys(), ...(listeners.get(roomId) || [])].includes(ws.id)) return;
          const payload = { ...msg, type: msg.type, id: ws.id, roomId, fromParticipantId: ws.id, toParticipantId: destinationId };
          if(room && msg.connectionGeneration) payload.connectionGeneration = msg.connectionGeneration;
          else if(room) payload.connectionGeneration = room.connectionGeneration;
          logLiveSignal(payload);
          dest.send(JSON.stringify(payload));
        }
        return;
      }
      case "secure-live-join": {
        const user = (msg.user || ws.username || "").toString().trim() || `secure-${ws.id}`;
        secureLiveParticipants.set(ws.id, { id: ws.id, user });
        secureLivePresence.set(ws.id, Date.now());
        broadcastSecureLiveUsers();
        broadcastSecureLiveActiveCount();
        return;
      }
      case "secure-live-presence": {
        if (!secureLiveParticipants.has(ws.id)) {
          const user = (msg.user || ws.username || "").toString().trim() || `secure-${ws.id}`;
          secureLiveParticipants.set(ws.id, { id: ws.id, user });
          broadcastSecureLiveUsers();
        }
        secureLivePresence.set(ws.id, Date.now());
        broadcastSecureLiveActiveCount();
        return;
      }
      case "secure-live-leave": {
        secureLivePresence.delete(ws.id);
        if (secureLiveParticipants.delete(ws.id)) {
          broadcastSecureLiveUsers();
          broadcastSecureLiveActiveCount();
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
            `${from} sent you a private encrypted message`,
            { url: `/private-chat.html?user=${encodeURIComponent(from)}` }
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
    const normalizedRoom = (() => {
      const room = (msg.room || "").toString().trim().toLowerCase();
      if (!room || room === "cloud") return null;
      return msg.room;
    })();
    if (!msg.file && msg.video) {
      msg.file = msg.video;
    }
    const inferredFileType =
      (typeof msg.file === "string" && (msg.file.match(/^data:([^;]+);/i) || [])[1]) ||
      null;
    const fileName = msg.file_name || msg.fileName || (msg.file ? "attachment" : null);
    const fileType =
      msg.file_type ||
      msg.fileType ||
      inferredFileType ||
      (msg.file ? "application/octet-stream" : null);
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
        normalizedRoom,
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
    msg.room = normalizedRoom;
    if (normalizedRoom) {
      const targets = new Set();
      const host = broadcasters.get(normalizedRoom);
      if (host && host.readyState === 1) targets.add(host);
      const set = listeners.get(normalizedRoom);
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
        if (client.readyState === 1) {
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
          `Your post #${msg.id} self-destructed`,
          { url: "/?tab=feed" }
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
