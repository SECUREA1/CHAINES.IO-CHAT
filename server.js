// server.js
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 10000; // Render provides PORT
const server = http.createServer((req, res) => {
  if (req.url === "/healthz") { res.writeHead(200); res.end("ok"); return; }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CHAINeS Chat WS");
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "system", text: "Connected to CHAINeS WS" }));
  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type !== "chat") return;
    msg.ts ||= Date.now();
    msg.id ||= `${msg.ts}-${Math.random().toString(36).slice(2,8)}`;
    // broadcast
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify(msg));
    }
  });
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`listening on ${PORT}`)
);
