import express from "express";
import { loadConfig, saveConfig } from "./config.js";
import { OscClient } from "./osc.js";
import { connectNodeWs } from "./ws.js";

const app = express();
app.use(express.json());

let config = loadConfig();
let oscClient = new OscClient(config);
oscClient.connect();
let ws = null as any;

async function ensurePairing() {
  if (config.nodeId && config.nodeToken) {
    return;
  }
  const response = await fetch(`${config.cloudUrl}/api/node-pair/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await response.json();
  config.pairingCode = data.code;
  config.pairingNonce = data.nonce;
  saveConfig(config);
}

async function connectCloud() {
  if (!config.nodeId || !config.nodeToken) return;
  ws = connectNodeWs({
    cloudUrl: config.cloudUrl,
    nodeId: config.nodeId,
    nodeToken: config.nodeToken,
    oscClient,
    version: "0.1.0"
  });
}

setInterval(async () => {
  if (!config.nodeId || !config.nodeToken) return;
  ws?.send(
    JSON.stringify({
      protocolVersion: 1,
      type: "node.heartbeat",
      payload: {
        nodeId: config.nodeId,
        version: "0.1.0",
        os: process.platform,
        status: "online",
        console: {
          ip: config.consoleIp,
          osc: { mode: config.oscMode, port: config.oscPort }
        }
      }
    })
  );
}, 15000);

app.get("/", (_req, res) => {
  res.sendFile(new URL("../public/index.html", import.meta.url));
});

app.get("/api/config", (_req, res) => {
  res.json(config);
});

app.post("/api/config", (req, res) => {
  config = { ...config, ...req.body };
  saveConfig(config);
  oscClient.close();
  oscClient = new OscClient(config);
  oscClient.connect();
  res.json({ status: "ok" });
});

app.post("/api/pair/check", async (_req, res) => {
  if (!config.pairingCode || !config.pairingNonce) {
    res.status(400).json({ error: "No pairing in progress" });
    return;
  }
  const response = await fetch(`${config.cloudUrl}/api/node-pair/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: config.pairingCode, nonce: config.pairingNonce })
  });
  const data = await response.json();
  if (data.nodeId && data.nodeToken && data.nodeToken !== "REDACTED") {
    config.nodeId = data.nodeId;
    config.nodeToken = data.nodeToken;
    saveConfig(config);
    await connectCloud();
    res.json({ status: "paired" });
    return;
  }
  res.json({ status: "pending" });
});

app.post("/api/test", (_req, res) => {
  oscClient.send("/eos/newcmd", []);
  res.json({ status: "sent" });
});

app.listen(4580, async () => {
  await ensurePairing();
  await connectCloud();
  console.log("AutoQue Node running at http://localhost:4580");
});
