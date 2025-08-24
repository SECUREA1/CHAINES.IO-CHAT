// server.js
import http from "http";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000; // Render provides PORT

// Locate repo root to serve the client HTML
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HISTORY_FILE = path.join(ROOT, "chat-history.json");
let history = [];
try {
  history = JSON.parse(await readFile(HISTORY_FILE, "utf8"));
} catch {
  history = [];
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
    if (client.readyState === 1 && client.username) users.push(client.username);
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
  ws.send(JSON.stringify({ type: "history", messages: history }));
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
    msg.ts ||= Date.now();
    msg.id ||= `${msg.ts}-${Math.random().toString(36).slice(2,8)}`;
    history.push(msg);
    if (history.length > 200) history.shift();
    try { await writeFile(HISTORY_FILE, JSON.stringify(history)); } catch {}
    // broadcast
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify(msg));
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`listening on ${PORT}`)
);
