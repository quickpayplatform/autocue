import { query } from "../db.js";
import { logger } from "../logger.js";

export async function logAudit(cueId: string | null, eventType: string, message: string): Promise<void> {
  try {
    await query(
      "INSERT INTO audit_logs (id, cue_id, event_type, message, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())",
      [cueId, eventType, message]
    );
  } catch (error) {
    logger.error({ error }, "Failed to write audit log");
  }
}
