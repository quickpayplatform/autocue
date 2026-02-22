import dgram from "node:dgram";
import net from "node:net";
import oscMin from "osc-min";

export type OscConfig = {
  consoleIp: string;
  oscMode: "tcp" | "udp";
  oscPort: number;
  udpLocalPort: number;
};

export class OscClient {
  private socket: net.Socket | null = null;
  private udpSocket: dgram.Socket | null = null;
  private config: OscConfig;

  constructor(config: OscConfig) {
    this.config = config;
  }

  connect() {
    if (this.config.oscMode === "tcp") {
      this.socket = new net.Socket();
      this.socket.connect(this.config.oscPort, this.config.consoleIp);
    } else {
      this.udpSocket = dgram.createSocket("udp4");
      this.udpSocket.bind(this.config.udpLocalPort);
    }
  }

  send(address: string, args: Array<string | number> = []) {
    const packet = oscMin.toBuffer({ address, args });
    if (this.config.oscMode === "tcp" && this.socket) {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(packet.length, 0);
      this.socket.write(Buffer.concat([length, packet]));
      return;
    }
    if (this.udpSocket) {
      this.udpSocket.send(packet, this.config.oscPort, this.config.consoleIp);
    }
  }

  close() {
    this.socket?.destroy();
    this.udpSocket?.close();
  }
}
