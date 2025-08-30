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

const PORT = process.env.PORT || 10000; // Render provides PORT

// Locate repo root to serve the client HTML
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DB_PATH = process.env.DB_PATH || path.join(ROOT, "app.db");
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    room TEXT,
    message TEXT,
    image TEXT,
    file TEXT,
    file_name TEXT,
    file_type TEXT,
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
`);
try { db.exec("ALTER TABLE chat_messages ADD COLUMN room TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN description TEXT"); } catch {}

// express setup
const app = express();
app.use(express.json());
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

app.post("/register", upload.single("profile"), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ error: "Missing fields" });
    return;
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    let pic = null;
    if (req.file) pic = "/static/profiles/" + req.file.filename;
    db.prepare(
      "INSERT INTO users (username, password, profile_pic) VALUES (?,?,?)"
    ).run(username, hash, pic);
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
  const user = db
    .prepare("SELECT username, password, profile_pic FROM users WHERE username=?")
    .get(username);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.json({ success: true, username: user.username, profilePic: user.profile_pic });
});

app.get(["/profile.html"], (req, res) =>
  res.sendFile(path.join(ROOT, "profile.html"))
);

app.get("/profile/:username", (req, res) => {
  const viewer = req.query.viewer || "";
  const user = db
    .prepare(
      "SELECT username, profile_pic, description FROM users WHERE username=?"
    )
    .get(req.params.username);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const posts = db
    .prepare(
      "SELECT id, message, image, file, file_name, file_type, strftime('%s', timestamp) * 1000 as ts FROM chat_messages WHERE user=? ORDER BY id DESC"
    )
    .all(req.params.username);
  const followers = db
    .prepare("SELECT follower FROM follows WHERE following=?")
    .all(req.params.username)
    .map((r) => r.follower);
  const following = db
    .prepare("SELECT following FROM follows WHERE follower=?")
    .all(req.params.username)
    .map((r) => r.following);
  const isFollowing = viewer
    ? !!db
        .prepare(
          "SELECT 1 FROM follows WHERE follower=? AND following=?"
        )
        .get(viewer, req.params.username)
    : false;
  res.json({
    username: user.username,
    profilePic: user.profile_pic,
    description: user.description || null,
    posts,
    followers,
    following,
    isFollowing,
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
    res.json({ following: true });
  }
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

function loadHistory(room = null) {
  const where = room ? "c.room = ?" : "c.room IS NULL";
  const stmt = db.prepare(
    `SELECT c.id, c.user, u.profile_pic, c.room, c.message, c.image, c.file, c.file_name, c.file_type, strftime('%s', c.timestamp) * 1000 as ts FROM chat_messages c LEFT JOIN users u ON c.user = u.username WHERE ${where} ORDER BY c.id`
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
  return rows.map((r) => ({
    type: "chat",
    id: r.id,
    user: r.user,
    profilePic: r.profile_pic,
    room: r.room,
    text: r.message,
    image: r.image,
    file: r.file,
    fileName: r.file_name,
    fileType: r.file_type,
    ts: r.ts,
    likes: likes[r.id] || 0,
    comments: comments[r.id] || [],
  }));
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
          const subs = db
            .prepare("SELECT subscription FROM push_subscriptions WHERE username = ?")
            .all(follower);
          for (const { subscription } of subs) {
            try {
              webpush.sendNotification(
                JSON.parse(subscription),
                JSON.stringify({
                  title: "New Broadcast",
                  body: `${ws.username} is live`,
                })
              );
            } catch {}
          }
          db
            .prepare(
              "INSERT INTO notifications (username, type, data) VALUES (?, 'broadcast', ?)"
            )
            .run(follower, JSON.stringify({ from: ws.username || "", mode: "start" }));
        }
        const hostId = guestHosts.get(ws.id);
        if(hostId){
          const set = listeners.get(hostId);
          if(set){
            const payload = JSON.stringify({ type: "guest-start", host: hostId, id: ws.id });
            for(const wid of set){
              const watcher = clients.get(wid);
              if(watcher && watcher.readyState === 1) watcher.send(payload);
            }
          }
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
    const u = db
      .prepare("SELECT profile_pic FROM users WHERE username=?")
      .get(msg.user || "");
    msg.profilePic = u?.profile_pic || null;
    const info = db
      .prepare(
        "INSERT INTO chat_messages (user, room, message, image, file, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        msg.user || "",
        msg.room || null,
        text,
        msg.image || null,
        msg.file || null,
        fileName,
        fileType
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
