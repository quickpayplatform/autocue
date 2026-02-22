import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const configDir = join(process.cwd(), "config");
const configPath = join(configDir, "autoque-node.json");

export type NodeConfig = {
  nodeId?: string;
  nodeToken?: string;
  pairingCode?: string;
  pairingNonce?: string;
  cloudUrl: string;
  consoleIp: string;
  oscMode: "tcp" | "udp";
  oscPort: number;
  udpLocalPort: number;
};

const defaultConfig: NodeConfig = {
  cloudUrl: "https://autoque.app",
  consoleIp: "127.0.0.1",
  oscMode: "tcp",
  oscPort: 3032,
  udpLocalPort: 8001
};

export function loadConfig(): NodeConfig {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  if (!existsSync(configPath)) {
    saveConfig(defaultConfig);
    return defaultConfig;
  }
  const raw = readFileSync(configPath, "utf-8");
  return { ...defaultConfig, ...JSON.parse(raw) };
}

export function saveConfig(config: NodeConfig) {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}
