import osc from "node-osc";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type OscCommand = {
  address: string;
  args?: Array<string | number>;
};

export class OscSendError extends Error {
  sentCount: number;
  cause?: Error;

  constructor(message: string, sentCount: number, cause?: Error) {
    super(message);
    this.sentCount = sentCount;
    this.cause = cause;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OscBridge {
  private client: osc.Client;

  constructor() {
    if (config.oscIpWhitelist.length > 0 && !config.oscIpWhitelist.includes(config.oscIp)) {
      throw new Error("OSC_IP not in whitelist");
    }
    this.client = new osc.Client(config.oscIp, config.oscPort);
  }

  async send(commands: OscCommand[]): Promise<void> {
    let sentCount = 0;
    for (const command of commands) {
      try {
        await this.sendCommand(command);
        sentCount += 1;
      } catch (error) {
        throw new OscSendError("Failed to send OSC command sequence", sentCount, error as Error);
      }
      await delay(config.oscRateMs);
    }
  }

  private sendCommand(command: OscCommand): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = command.args ?? [];
      const message = new osc.Message(command.address, ...args);
      this.client.send(message, (err: Error | null) => {
        if (err) {
          logger.error({ err, command }, "OSC command failed");
          reject(err);
          return;
        }
        logger.info({ command }, "OSC command sent");
        resolve();
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
