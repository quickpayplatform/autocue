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
      if (message.type === "cue.execute") {
        const commands = message.payload.commands ?? [];
        commands.forEach((command: any) => {
          config.oscClient.send(command.address, command.args ?? []);
        });
        await fetch(`${config.cloudUrl}/api/nodes/${config.nodeId}/cues/${message.payload.cueId}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.nodeToken}` },
          body: JSON.stringify({ ok: true })
        });
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
