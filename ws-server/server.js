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
    message TEXT,
    image TEXT,
    file TEXT,
    file_name TEXT,
    file_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

function loadHistory(limit = 200) {
  const rows = db
    .prepare(
      `SELECT id, user, message, image, file, file_name as fileName, file_type as fileType, strftime('%s', timestamp) * 1000 as ts FROM chat_messages ORDER BY id DESC LIMIT ?`
    )
    .all(limit)
    .reverse();
  return rows.map((r) => ({ type: "chat", ...r }));
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
let broadcaster = null;

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
        live: client === broadcaster,
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
  if (broadcaster && broadcaster.readyState === 1 && ws !== broadcaster) {
    ws.send(JSON.stringify({ type: "broadcaster", id: broadcaster.id }));
  }
  broadcastUsers();
  ws.on("close", () => {
    clients.delete(ws.id);
    if (ws === broadcaster) {
      broadcaster = null;
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
        broadcaster = ws;
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({ type: "broadcaster", id: ws.id }));
          }
        }
        return;
      case "end-broadcast":
        if (ws === broadcaster) {
          for (const client of wss.clients) {
            if (client.readyState === 1 && client !== ws) {
              client.send(JSON.stringify({ type: "bye", id: ws.id }));
            }
          }
          broadcaster = null;
          broadcastUsers();
        }
        return;
      case "watcher":
        if (broadcaster && broadcaster.readyState === 1) {
          broadcaster.send(JSON.stringify({ type: "watcher", id: ws.id }));
        }
        return;
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
    const info = db
      .prepare(
        "INSERT INTO chat_messages (user, message, image, file, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        msg.user || "",
        text,
        msg.image || null,
        msg.file || null,
        msg.fileName || null,
        msg.fileType || null
      );
    msg.id = info.lastInsertRowid;
    msg.message = text;
    // broadcast
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify(msg));
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`listening on ${PORT}`)
);
