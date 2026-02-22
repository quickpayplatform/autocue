import http from "http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { createNodeWebSocketServer } from "./ws/nodes.js";

const app = createApp();

const server = http.createServer(app);

const nodeWs = createNodeWebSocketServer(server);

app.set("nodeWs", nodeWs);

server.listen(config.port, () => {
  logger.info({ port: config.port }, "API listening");
});

// Execution now happens via AutoQue Node connections.
