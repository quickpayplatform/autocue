import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import bcrypt from "bcrypt";
import { query } from "../db.js";
import { logger } from "../logger.js";

interface NodeConnection {
  ws: WebSocket;
  nodeId: string;
}

const nodeConnections = new Map<string, NodeConnection>();

export function createNodeWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server, path: "/ws/nodes" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      ws.close();
      return;
    }
    const token = authHeader.slice("Bearer ".length);

    const tokenRows = await query<{ node_id: string; token_hash: string }>(
      "SELECT node_id, token_hash FROM node_tokens",
      []
    );

    let nodeId: string | null = null;
    for (const row of tokenRows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        nodeId = row.node_id;
        break;
      }
    }

    if (!nodeId) {
      ws.close();
      return;
    }

    nodeConnections.set(nodeId, { ws, nodeId });
    await query("UPDATE nodes SET status = 'online', last_seen_at = now(), updated_at = now() WHERE id = $1", [nodeId]);

    ws.on("message", async (data: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === "node.heartbeat") {
          await query(
            "UPDATE nodes SET status = 'online', last_seen_at = now(), updated_at = now(), version = $1 WHERE id = $2",
            [payload.payload?.version ?? null, nodeId]
          );
        }
      } catch (error) {
        logger.error({ error }, "WS node message error");
      }
    });

    ws.on("close", async () => {
      nodeConnections.delete(nodeId!);
      await query("UPDATE nodes SET status = 'offline', updated_at = now() WHERE id = $1", [nodeId]);
    });
  });

  return {
    sendCommand(nodeId: string, message: any) {
      const connection = nodeConnections.get(nodeId);
      if (!connection) return false;
      connection.ws.send(JSON.stringify(message));
      return true;
    }
  };
}
