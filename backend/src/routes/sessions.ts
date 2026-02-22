import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Role } from "../types.js";

const router = Router();

const mediaSchema = z.object({
  theatreId: z.string().uuid().optional(),
  type: z.enum(["AUDIO", "VIDEO"]),
  url: z.string().url(),
  durationMs: z.number().int().positive()
});

const themeSchema = z.object({
  palette: z.array(z.object({ name: z.string(), hex: z.string() })).min(1),
  constraints: z.object({
    warmCoolBias: z.enum(["WARM", "COOL", "NEUTRAL"]).default("NEUTRAL"),
    saturationLimit: z.number().min(0).max(1).default(1),
    allowStrobe: z.boolean().default(false),
    maxIntensity: z.number().min(0).max(1).default(1),
    movementSpeedLimit: z.number().min(0).max(1).default(1),
    skinSafeFrontlight: z.boolean().default(false)
  })
});

const sessionSchema = z.object({
  theatreId: z.string().uuid(),
  rigVersionId: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
  theme: themeSchema
});

const cueEventSchema = z.object({
  tMs: z.number().int().min(0),
  durationMs: z.number().int().min(0).optional(),
  type: z.enum(["LOOK", "BUMP", "CHASE", "SWEEP", "BLACKOUT", "HIT"]),
  targets: z.object({
    groupIds: z.array(z.string().uuid()).default([]),
    fixtureInstanceIds: z.array(z.string().uuid()).default([])
  }),
  look: z.object({
    intensity: z.number().min(0).max(1),
    paletteColorRef: z.union([z.number().int(), z.string()]),
    movement: z.object({ pan: z.number(), tilt: z.number(), speed: z.number() }).optional(),
    strobe: z.object({ enabled: z.boolean(), rateHz: z.number() }).optional(),
    beam: z.object({ zoom: z.number(), iris: z.number() }).optional()
  })
});

const SESSION_EDITOR_ROLES: Role[] = ["CLIENT", "DESIGNER", "THEATRE_ADMIN", "THEATRE_TECH", "ADMIN"];

async function hasTheatreAccess(userId: string, theatreId: string): Promise<boolean> {
  const rows = await query<{ role: string }>(
    "SELECT role FROM venue_users WHERE venue_id = $1 AND user_id = $2",
    [theatreId, userId]
  );
  return rows.length > 0;
}

router.post("/media-assets", async (req: AuthedRequest, res) => {
  const parsed = mediaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (parsed.data.theatreId) {
    const allowed = await hasTheatreAccess(req.user.userId, parsed.data.theatreId);
    if (!allowed && req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Not a theatre member" });
      return;
    }
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO media_assets (id, uploaded_by_user_id, theatre_id, type, url, duration_ms, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now()) RETURNING id",
    [req.user.userId, parsed.data.theatreId ?? null, parsed.data.type, parsed.data.url, parsed.data.durationMs]
  );

  res.status(201).json({ id: rows[0].id });
});

router.post("/sessions", async (req: AuthedRequest, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const allowed = await hasTheatreAccess(req.user.userId, parsed.data.theatreId);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const analysis = {
    markers: [],
    energyCurve: []
  };

  const rows = await query<{ id: string }>(
    "INSERT INTO autoque_sessions (id, theatre_id, rig_version_id, created_by_user_id, status, media_asset_id, theme, analysis, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'DRAFT', $4, $5, $6, now(), now()) RETURNING id",
    [parsed.data.theatreId, parsed.data.rigVersionId, req.user.userId, parsed.data.mediaAssetId, parsed.data.theme, analysis]
  );

  res.status(201).json({ id: rows[0].id });
});

router.post("/sessions/:id/cues", async (req: AuthedRequest, res) => {
  const parsed = cueEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO cue_events (id, session_id, t_ms, duration_ms, type, targets, look, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now()) RETURNING id",
    [req.params.id, parsed.data.tMs, parsed.data.durationMs ?? null, parsed.data.type, parsed.data.targets, parsed.data.look]
  );

  res.status(201).json({ id: rows[0].id });
});

router.get("/sessions/:id/cues", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await query(
    "SELECT id, t_ms, duration_ms, type, targets, look, created_at, updated_at FROM cue_events WHERE session_id = $1 ORDER BY t_ms ASC",
    [req.params.id]
  );
  res.json(rows);
});

router.patch("/sessions/:id/submit", async (req: AuthedRequest, res) => {
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await query(
    "UPDATE autoque_sessions SET status = 'SUBMITTED_TO_THEATRE', updated_at = now() WHERE id = $1",
    [req.params.id]
  );

  res.json({ status: "SUBMITTED_TO_THEATRE" });
});

router.patch("/sessions/:id/approve", async (req: AuthedRequest, res) => {
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await query(
    "UPDATE autoque_sessions SET status = 'APPROVED', updated_at = now() WHERE id = $1",
    [req.params.id]
  );

  res.json({ status: "APPROVED" });
});

router.patch("/sessions/:id/reject", async (req: AuthedRequest, res) => {
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await query(
    "UPDATE autoque_sessions SET status = 'REJECTED', updated_at = now() WHERE id = $1",
    [req.params.id]
  );

  res.json({ status: "REJECTED" });
});

export default router;
