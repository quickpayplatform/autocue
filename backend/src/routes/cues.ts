import { Router } from "express";
import { cueApprovalSchema, cueCreateSchema } from "../validation/cues.js";
import { AuthedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { cueSubmissionLimiter } from "../middleware/rateLimit.js";
import { pool, query } from "../db.js";
import { logAudit } from "../services/audit.js";
import { CueExecutor } from "../services/executor.js";
import { config } from "../config.js";
import { Role } from "../types.js";

const router = Router();
const executor = new CueExecutor();

const OPERATOR_ROLES: Role[] = ["OPERATOR", "ADMIN"];

router.post("/", cueSubmissionLimiter, async (req: AuthedRequest, res) => {
  const parsed = cueCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { cueNumber, cueList, fadeTime, notes, channels } = parsed.data;
  if (config.lockedCueNumbers.includes(cueNumber)) {
    res.status(403).json({ error: "Cue number is locked" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cueResult = await client.query<{ id: string }>(
      "INSERT INTO cues (id, cue_number, cue_list, fade_time, notes, status, submitted_by, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING', $5, now(), now()) RETURNING id",
      [cueNumber, cueList, fadeTime, notes, req.user.userId]
    );
    const cueId = cueResult.rows[0].id;

    for (const channel of channels) {
      await client.query(
        "INSERT INTO cue_channels (id, cue_id, channel_number, level) VALUES (gen_random_uuid(), $1, $2, $3)",
        [cueId, channel.channelNumber, channel.level]
      );
    }

    await client.query("COMMIT");
    await logAudit(cueId, "SUBMITTED", `Cue submitted by ${req.user.userId}`);

    res.status(201).json({ id: cueId });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Failed to submit cue" });
  } finally {
    client.release();
  }
});

router.get("/", async (_req, res) => {
  const req = _req as AuthedRequest;
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const baseQuery =
    "SELECT id, cue_number, cue_list, fade_time, notes, status, submitted_by, approved_by, executed_at, created_at, updated_at FROM cues";
  const orderBy = " ORDER BY created_at DESC";

  const cues =
    req.user.role === "SUBMITTER"
      ? await query(`${baseQuery} WHERE submitted_by = $1${orderBy}`, [req.user.userId])
      : await query(`${baseQuery}${orderBy}`);
  res.json(cues);
});

router.get("/:id", async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!authedReq.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query(
    "SELECT id, cue_number, cue_list, fade_time, notes, status, submitted_by, approved_by, executed_at, created_at, updated_at FROM cues WHERE id = $1",
    [req.params.id]
  );

  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }

  if (authedReq.user.role === "SUBMITTER" && cue.submitted_by !== authedReq.user.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const channels = await query(
    "SELECT id, channel_number, level FROM cue_channels WHERE cue_id = $1 ORDER BY channel_number ASC",
    [req.params.id]
  );

  res.json({ ...cue, channels });
});

router.get("/:id/logs", async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!authedReq.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{ submitted_by: string }>(
    "SELECT submitted_by FROM cues WHERE id = $1",
    [req.params.id]
  );
  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }

  if (authedReq.user.role === "SUBMITTER" && cue.submitted_by !== authedReq.user.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const logs = await query(
    "SELECT id, event_type, message, created_at FROM audit_logs WHERE cue_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(logs);
});

router.patch("/:id/approve", requireRole(OPERATOR_ROLES), async (req: AuthedRequest, res) => {
  const parsed = cueApprovalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{ cue_number: number; cue_list: number; status: string }>(
    "SELECT cue_number, cue_list, status FROM cues WHERE id = $1",
    [req.params.id]
  );
  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }
  if (cue.status !== "PENDING") {
    res.status(409).json({ error: "Cue is not pending" });
    return;
  }
  if (config.lockedCueNumbers.includes(cue.cue_number)) {
    res.status(403).json({ error: "Cue number is locked" });
    return;
  }

  const duplicates = await query<{ id: string }>(
    "SELECT id FROM cues WHERE cue_number = $1 AND cue_list = $2 AND status IN ('APPROVED', 'EXECUTED')",
    [cue.cue_number, cue.cue_list]
  );
  if (duplicates.length > 0 && !parsed.data.confirmDuplicate) {
    res.status(409).json({ error: "Duplicate cue number requires confirmation" });
    return;
  }

  await query(
    "UPDATE cues SET status = 'APPROVED', approved_by = $1, updated_at = now() WHERE id = $2",
    [req.user.userId, req.params.id]
  );

  await logAudit(req.params.id, "APPROVED", `Cue approved by ${req.user.userId}`);

  executor.handleApprovedCue(req.params.id, parsed.data.label).catch(() => undefined);

  res.json({ status: "APPROVED" });
});

router.patch("/:id/reject", requireRole(OPERATOR_ROLES), async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{ status: string }>(
    "SELECT status FROM cues WHERE id = $1",
    [req.params.id]
  );
  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }
  if (cue.status !== "PENDING") {
    res.status(409).json({ error: "Cue is not pending" });
    return;
  }

  await query(
    "UPDATE cues SET status = 'REJECTED', approved_by = $1, updated_at = now() WHERE id = $2",
    [req.user.userId, req.params.id]
  );

  await logAudit(req.params.id, "REJECTED", `Cue rejected by ${req.user.userId}`);

  res.json({ status: "REJECTED" });
});

export default router;
