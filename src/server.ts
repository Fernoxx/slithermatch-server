import http from "http";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";

const app = express();
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