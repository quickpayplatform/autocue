import WebSocket from "ws";
import { OscClient } from "./osc.js";

export type NodeWsConfig = {
  cloudUrl: string;
  nodeId: string;
  nodeToken: string;
  oscClient: OscClient;
  version: string;
};

export function connectNodeWs(config: NodeWsConfig) {
  const ws = new WebSocket(`${config.cloudUrl.replace("http", "ws")}/ws/nodes`, {
    headers: { Authorization: `Bearer ${config.nodeToken}` }
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({
        protocolVersion: 1,
        type: "node.hello",
        payload: { nodeId: config.nodeId, version: config.version }
      })
    );
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      if (message.type === "osc.send") {
        config.oscClient.send(message.payload.address, message.payload.args ?? []);
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            type: "command.result",
            id: message.id,
            ok: true
          })
        );
      }
    } catch {
      ws.send(
        JSON.stringify({
          protocolVersion: 1,
          type: "command.result",
          id: "unknown",
          ok: false
        })
      );
    }
  });

  return ws;
}
