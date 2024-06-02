import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server);

io.on("connection", (socket) => {
  console.log("A new user has connected. Socket_id : ", socket.id);
  const userId = socket.handshake.query.user_id;
  console.log("handshake", userId);
});

export { app, server, io };
