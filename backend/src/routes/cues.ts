import { Router } from "express";
import crypto from "node:crypto";
import { cueApprovalSchema, cueCreateSchema, cueUpdateSchema } from "../validation/cues.js";
import { AuthedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { cueSubmissionLimiter } from "../middleware/rateLimit.js";
import { pool, query } from "../db.js";
import { logAudit } from "../services/audit.js";
import { config } from "../config.js";
import { Role } from "../types.js";

const router = Router();

const OPERATOR_ROLES: Role[] = ["OPERATOR", "ADMIN", "THEATRE_ADMIN", "THEATRE_TECH"];
const SUBMITTER_ROLES: Role[] = ["SUBMITTER", "CLIENT", "DESIGNER"];

async function getVenueContext(userId: string, venueId: string) {
  const rows = await query<{
    venue_id: string;
    venue_name: string;
    patch_range_min: number;
    patch_range_max: number;
    locked_cue_numbers: number[];
    role: "SUBMITTER" | "OPERATOR" | "ADMIN";
  }>(
    `SELECT v.id as venue_id, v.name as venue_name, v.patch_range_min, v.patch_range_max, v.locked_cue_numbers, vu.role
     FROM venues v
     JOIN venue_users vu ON vu.venue_id = v.id
     WHERE v.id = $1 AND vu.user_id = $2`,
    [venueId, userId]
  );
  return rows[0] ?? null;
}

async function getVenueSettings(venueId: string) {
  const rows = await query<{
    id: string;
    patch_range_min: number;
    patch_range_max: number;
    locked_cue_numbers: number[];
  }>(
    "SELECT id, patch_range_min, patch_range_max, locked_cue_numbers FROM venues WHERE id = $1",
    [venueId]
  );
  return rows[0] ?? null;
}

async function sendCueToNode(app: any, venueId: string, payload: any) {
  const nodes = await query<{ id: string }>(
    "SELECT id FROM nodes WHERE venue_id = $1 AND status = 'online' ORDER BY last_seen_at DESC LIMIT 1",
    [venueId]
  );
  const node = nodes[0];
  if (!node) {
    return false;
  }
  const nodeWs = app.get("nodeWs");
  return nodeWs?.sendCommand?.(node.id, payload) ?? false;
}

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

  const { venueId, cueNumber, cueList, fadeTime, notes, channels } = parsed.data;
  const venue = await getVenueContext(req.user.userId, venueId);
  if (!venue) {
    res.status(403).json({ error: "Not a member of this venue" });
    return;
  }

  if (venue.locked_cue_numbers.includes(cueNumber) || config.lockedCueNumbers.includes(cueNumber)) {
    res.status(403).json({ error: "Cue number is locked" });
    return;
  }

  const invalidChannel = channels.find(
    (channel) =>
      channel.channelNumber < venue.patch_range_min ||
      channel.channelNumber > venue.patch_range_max
  );
  if (invalidChannel) {
    res.status(400).json({ error: "Channel outside of venue patch range" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cueResult = await client.query<{ id: string }>(
      "INSERT INTO cues (id, cue_number, cue_list, fade_time, notes, status, venue_id, submitted_by, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PENDING', $5, $6, now(), now()) RETURNING id",
      [cueNumber, cueList, fadeTime, notes, venueId, req.user.userId]
    );
    const cueId = cueResult.rows[0].id;

    for (const channel of channels) {
      await client.query(
        "INSERT INTO cue_channels (id, cue_id, channel_number, level) VALUES (gen_random_uuid(), $1, $2, $3)",
        [cueId, channel.channelNumber, channel.level]
      );
    }

    await client.query("COMMIT");
    await logAudit(cueId, venueId, "SUBMITTED", `Cue submitted by ${req.user.userId}`);

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

  const venueId = req.query.venueId as string | undefined;
  if (!venueId) {
    res.status(400).json({ error: "venueId is required" });
    return;
  }

  const venue = await getVenueContext(req.user.userId, venueId);
  if (!venue && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a member of this venue" });
    return;
  }

  const cues = await query(
    "SELECT id, cue_number, cue_list, fade_time, notes, status, submitted_by, approved_by, executed_at, created_at, updated_at FROM cues WHERE venue_id = $1 ORDER BY created_at DESC",
    [venueId]
  );
  res.json(cues);
});

router.get("/:id", async (req, res) => {
  const authedReq = req as AuthedRequest;
  if (!authedReq.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{
    id: string;
    cue_number: number;
    cue_list: number;
    fade_time: number;
    notes: string | null;
    status: string;
    submitted_by: string;
    approved_by: string | null;
    executed_at: string | null;
    created_at: string;
    updated_at: string;
    venue_id: string;
  }>(
    "SELECT id, cue_number, cue_list, fade_time, notes, status, submitted_by, approved_by, executed_at, created_at, updated_at, venue_id FROM cues WHERE id = $1",
    [req.params.id]
  );

  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }

  const venue = await getVenueContext(authedReq.user.userId, cue.venue_id);
  if (!venue && authedReq.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (SUBMITTER_ROLES.includes(authedReq.user.role) && cue.submitted_by !== authedReq.user.userId) {
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

  const cueRows = await query<{ submitted_by: string; venue_id: string }>(
    "SELECT submitted_by, venue_id FROM cues WHERE id = $1",
    [req.params.id]
  );
  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }

  const venue = await getVenueContext(authedReq.user.userId, cue.venue_id);
  if (!venue && authedReq.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (SUBMITTER_ROLES.includes(authedReq.user.role) && cue.submitted_by !== authedReq.user.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const logs = await query(
    "SELECT id, event_type, message, created_at FROM audit_logs WHERE cue_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  res.json(logs);
});

router.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = cueUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{
    id: string;
    status: string;
    submitted_by: string;
    venue_id: string;
    cue_number: number;
  }>("SELECT id, status, submitted_by, venue_id, cue_number FROM cues WHERE id = $1", [req.params.id]);

  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }
  if (cue.status !== "PENDING") {
    res.status(409).json({ error: "Only pending cues can be edited" });
    return;
  }

  const venue = await getVenueContext(req.user.userId, cue.venue_id);
  const venueSettings = venue ?? (req.user.role === "ADMIN" ? await getVenueSettings(cue.venue_id) : null);
  if (!venueSettings) {
    res.status(403).json({ error: "Not a member of this venue" });
    return;
  }

  if (SUBMITTER_ROLES.includes(req.user.role) && cue.submitted_by !== req.user.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const update = parsed.data;
  if (update.cueNumber && venueSettings.locked_cue_numbers.includes(update.cueNumber)) {
    res.status(403).json({ error: "Cue number is locked" });
    return;
  }

  if (update.channels) {
    const invalidChannel = update.channels.find(
      (channel) =>
        channel.channelNumber < venueSettings.patch_range_min ||
        channel.channelNumber > venueSettings.patch_range_max
    );
    if (invalidChannel) {
      res.status(400).json({ error: "Channel outside of venue patch range" });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE cues
       SET cue_number = COALESCE($1, cue_number),
           cue_list = COALESCE($2, cue_list),
           fade_time = COALESCE($3, fade_time),
           notes = COALESCE($4, notes),
           updated_at = now()
       WHERE id = $5`,
      [update.cueNumber, update.cueList, update.fadeTime, update.notes, req.params.id]
    );

    if (update.channels) {
      await client.query("DELETE FROM cue_channels WHERE cue_id = $1", [req.params.id]);
      for (const channel of update.channels) {
        await client.query(
          "INSERT INTO cue_channels (id, cue_id, channel_number, level) VALUES (gen_random_uuid(), $1, $2, $3)",
          [req.params.id, channel.channelNumber, channel.level]
        );
      }
    }

    await client.query("COMMIT");
    await logAudit(req.params.id, cue.venue_id, "UPDATED", `Cue updated by ${req.user.userId}`);
    res.json({ status: "UPDATED" });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Failed to update cue" });
  } finally {
    client.release();
  }
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

  const cueRows = await query<{ cue_number: number; cue_list: number; status: string; venue_id: string; fade_time: number }>(
    "SELECT cue_number, cue_list, status, venue_id, fade_time FROM cues WHERE id = $1",
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
  const venue = await getVenueContext(req.user.userId, cue.venue_id);
  const venueSettings = venue ?? (req.user.role === "ADMIN" ? await getVenueSettings(cue.venue_id) : null);
  if (!venueSettings) {
    res.status(403).json({ error: "Not a member of this venue" });
    return;
  }

  if (
    (venueSettings.locked_cue_numbers?.includes(cue.cue_number) ?? false) ||
    config.lockedCueNumbers.includes(cue.cue_number)
  ) {
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

  await logAudit(req.params.id, cue.venue_id, "APPROVED", `Cue approved by ${req.user.userId}`);

  const channels = await query(
    "SELECT channel_number, level FROM cue_channels WHERE cue_id = $1 ORDER BY channel_number ASC",
    [req.params.id]
  );
  const commands = [
    { address: "/eos/newcmd", args: [] },
    ...channels.map((channel: any) => ({
      address: `/eos/channel/${channel.channel_number}/at`,
      args: [channel.level]
    })),
    { address: "/eos/record/cue", args: [cue.cue_number] },
    { address: `/eos/cue/${cue.cue_number}/time`, args: [cue.fade_time] }
  ];

  if (parsed.data.label) {
    commands.push({ address: `/eos/cue/${cue.cue_number}/label`, args: [parsed.data.label] });
  }

  const sent = await sendCueToNode(req.app, cue.venue_id, {
    protocolVersion: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    type: "cue.execute",
    payload: {
      cueId: req.params.id,
      commands
    }
  });

  await logAudit(req.params.id, cue.venue_id, "NODE_SEND", sent ? "Sent to node" : "No online node available");

  res.json({ status: "APPROVED" });
});

router.patch("/:id/reject", requireRole(OPERATOR_ROLES), async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cueRows = await query<{ status: string; venue_id: string }>(
    "SELECT status, venue_id FROM cues WHERE id = $1",
    [req.params.id]
  );
  const cue = cueRows[0];
  if (!cue) {
    res.status(404).json({ error: "Cue not found" });
    return;
  }
  const venue = await getVenueContext(req.user.userId, cue.venue_id);
  if (!venue && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a member of this venue" });
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

  await logAudit(req.params.id, cue.venue_id, "REJECTED", `Cue rejected by ${req.user.userId}`);

  res.json({ status: "REJECTED" });
});

export default router;
