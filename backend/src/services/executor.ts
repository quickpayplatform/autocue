import { query } from "../db.js";
import { logger } from "../logger.js";
import { logAudit } from "./audit.js";
import { OscBridge, OscCommand, OscSendError } from "./osc.js";
import { config } from "../config.js";

interface CueRow {
  id: string;
  cue_number: number;
  cue_list: number;
  fade_time: number;
  notes: string | null;
}

interface ChannelRow {
  channel_number: number;
  level: number;
}

export class CueExecutor {
  private bridge: OscBridge;

  constructor() {
    this.bridge = new OscBridge();
  }

  async executeCue(cueId: string, label?: string): Promise<boolean> {
    const cueRows = await query<CueRow>(
      "SELECT id, cue_number, cue_list, fade_time, notes FROM cues WHERE id = $1",
      [cueId]
    );
    const cue = cueRows[0];
    if (!cue) {
      throw new Error("Cue not found");
    }

    const channels = await query<ChannelRow>(
      "SELECT channel_number, level FROM cue_channels WHERE cue_id = $1 ORDER BY channel_number ASC",
      [cueId]
    );

    const commands: OscCommand[] = [
      { address: "/eos/newcmd" }
    ];

    for (const channel of channels) {
      commands.push({
        address: `/eos/channel/${channel.channel_number}/at`,
        args: [channel.level]
      });
    }

    commands.push({ address: "/eos/record/cue", args: [cue.cue_number] });
    commands.push({ address: `/eos/cue/${cue.cue_number}/time`, args: [cue.fade_time] });

    const resolvedLabel = label ?? cue.notes ?? "";
    if (resolvedLabel.trim().length > 0) {
      commands.push({ address: `/eos/cue/${cue.cue_number}/label`, args: [resolvedLabel] });
    }

    await logAudit(cueId, "EXECUTE_ATTEMPT", `Attempting execution with ${commands.length} OSC commands`);

    try {
      await this.bridge.send(commands);
      await query(
        "UPDATE cues SET status = 'EXECUTED', executed_at = now(), updated_at = now() WHERE id = $1",
        [cueId]
      );
      await logAudit(cueId, "EXECUTED", "Cue executed successfully");
      return true;
    } catch (error) {
      if (error instanceof OscSendError && error.sentCount > 0) {
        logger.error({ error, cueId }, "Partial OSC execution detected");
        await query("UPDATE cues SET status = 'FAILED', updated_at = now() WHERE id = $1", [cueId]);
        await logAudit(cueId, "FAILED", "Partial OSC execution detected; no retry");
        return true;
      }

      logger.error({ error, cueId }, "OSC execution failed");
      await logAudit(cueId, "EXECUTION_ERROR", "OSC execution failed; will retry if attempts remain");
      return false;
    }
  }

  async handleApprovedCue(cueId: string, label?: string): Promise<void> {
    const attempts = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM audit_logs WHERE cue_id = $1 AND event_type = 'EXECUTE_ATTEMPT'",
      [cueId]
    );
    const attemptCount = Number(attempts[0]?.count ?? 0);

    if (attemptCount >= config.oscRetryAttempts) {
      await query("UPDATE cues SET status = 'FAILED', updated_at = now() WHERE id = $1", [cueId]);
      await logAudit(cueId, "FAILED", "Execution attempts exhausted");
      return;
    }

    const success = await this.executeCue(cueId, label);
    if (!success && attemptCount + 1 >= config.oscRetryAttempts) {
      await query("UPDATE cues SET status = 'FAILED', updated_at = now() WHERE id = $1", [cueId]);
      await logAudit(cueId, "FAILED", "Execution attempts exhausted");
    }
  }

  async processQueue(): Promise<void> {
    const approvedCues = await query<{ id: string }>(
      "SELECT id FROM cues WHERE status = 'APPROVED' ORDER BY created_at ASC"
    );

    for (const cue of approvedCues) {
      try {
        await this.handleApprovedCue(cue.id);
      } catch (error) {
        logger.error({ error, cueId: cue.id }, "Failed to process approved cue");
      }
    }
  }

  startPolling(): void {
    setInterval(() => {
      this.processQueue().catch((error) => {
        logger.error({ error }, "Queue processing failed");
      });
    }, config.oscRetryDelayMs);
  }
}
