import http from "http";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";

const app = express();

// Serve static assets if present (e.g., public/index.html, public/favicon.ico)
app.use(express.static("public"));

// Avoid favicon 404 noise if no favicon is provided
app.get("/favicon.ico", (_req, res) => res.status(204).end());

app.get("/", (_req, res) => res.send("ok"));

const PORT = Number(process.env.PORT || 3000);
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
wss.on("connection", (ws: WebSocket) => {
  ws.send("hello");
  ws.on("pong", () => ((ws as any).isAlive = true));
});

setInterval(() => {
  wss.clients.forEach((c: any) => {
    if (!c.isAlive) return c.terminate();
    c.isAlive = false;
    c.ping();
  });
}, 30000);

server.listen(PORT, "0.0.0.0", () => {
  console.log("listening", PORT);
});