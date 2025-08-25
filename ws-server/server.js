// server.js
import http from "http";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import Database from "better-sqlite3";

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
  )
`);
try { db.exec("ALTER TABLE chat_messages ADD COLUMN room TEXT"); } catch {}

function loadHistory() {
  const rows = db
    .prepare(
      `SELECT id, user, room, message, image, file, file_name, file_type, strftime('%s', timestamp) * 1000 as ts FROM chat_messages ORDER BY id`
    )
    .all();
  return rows.map((r) => ({
    type: "chat",
    id: r.id,
    user: r.user,
    room: r.room,
    text: r.message,
    image: r.image,
    file: r.file,
    fileName: r.file_name,
    fileType: r.file_type,
    ts: r.ts,
  }));
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  // Serve chat client for root requests
  if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/" || req.url === "/index.html")) {
    try {
      const html = await readFile(path.join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      if (req.method === "GET") res.end(html); else res.end();
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Map();
const broadcasters = new Map();

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
      });
    }
  }
  const payload = JSON.stringify({ type: "users", users, count: users.length });
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
  ws.on("close", () => {
    clients.delete(ws.id);
    if (broadcasters.has(ws.id)) {
      broadcasters.delete(ws.id);
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(JSON.stringify({ type: "bye", id: ws.id }));
      }
    }
    broadcastUsers();
  });
  ws.on("message", async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type === "join") {
      ws.username = msg.user || "";
      broadcastUsers();
      return;
    }
    switch (msg?.type) {
      case "broadcaster":
        broadcasters.set(ws.id, ws);
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
          broadcastUsers();
        }
        return;
      case "watcher": {
        const host = broadcasters.get(msg.id);
        if (host && host.readyState === 1) {
          host.send(JSON.stringify({ type: "watcher", id: ws.id }));
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
    if (msg.image && msg.image.length > 1_000_000) return; // limit ~1MB per image
    if (msg.file && msg.file.length > 5_000_000) return; // limit ~5MB per file
    msg.ts ||= Date.now();
    const text = msg.text ?? msg.message ?? "";
    msg.text = text;
    const fileName = msg.file_name || msg.fileName || null;
    const fileType = msg.file_type || msg.fileType || null;
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
    if (fileName) {
      msg.file_name = fileName;
      msg.fileName = fileName;
    }
    if (fileType) {
      msg.file_type = fileType;
      msg.fileType = fileType;
    }
    // broadcast
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify(msg));
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`listening on ${PORT}`)
);
