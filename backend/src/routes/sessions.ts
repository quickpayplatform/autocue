import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Role } from "../types.js";
import PDFDocument from "pdfkit";

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

router.get("/sessions/:id/summary", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionRows = await query<{
    id: string;
    theatre_id: string;
    rig_version_id: string;
    status: string;
  }>("SELECT id, theatre_id, rig_version_id, status FROM autoque_sessions WHERE id = $1", [req.params.id]);

  const session = sessionRows[0];
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const latestRig = await query<{ id: string; name: string }>(
    "SELECT id, name FROM rig_versions WHERE theatre_id = $1 AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1",
    [session.theatre_id]
  );

  res.json({
    session,
    latestRig: latestRig[0] ?? null,
    rigMismatch: latestRig[0] ? latestRig[0].id !== session.rig_version_id : false
  });
});

router.post("/sessions/:id/generate", async (req: AuthedRequest, res) => {
  if (!req.user || !SESSION_EDITOR_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const sessions = await query<{
    id: string;
    media_asset_id: string;
    theme: Record<string, unknown>;
  }>("SELECT id, media_asset_id, theme FROM autoque_sessions WHERE id = $1", [req.params.id]);
  const session = sessions[0];
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const analysis = {
    markers: Array.from({ length: 12 }).map((_, index) => ({
      tMs: index * 5000,
      type: index % 3 === 0 ? "DROP" : "BEAT",
      confidence: 0.7
    })),
    energyCurve: Array.from({ length: 24 }).map((_, index) => ({
      tMs: index * 2500,
      value: Math.min(1, index / 24)
    }))
  };

  await query(
    "UPDATE autoque_sessions SET analysis = $1, updated_at = now() WHERE id = $2",
    [analysis, session.id]
  );

  await query("DELETE FROM cue_events WHERE session_id = $1", [session.id]);

  const palette = (session.theme as any)?.palette ?? [];
  for (let i = 0; i < analysis.markers.length; i += 1) {
    const marker = analysis.markers[i];
    await query(
      "INSERT INTO cue_events (id, session_id, t_ms, type, targets, look, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now())",
      [
        session.id,
        marker.tMs,
        marker.type === "DROP" ? "HIT" : "LOOK",
        { groupIds: [], fixtureInstanceIds: [] },
        { intensity: Math.min(1, 0.4 + i * 0.05), paletteColorRef: i % Math.max(1, palette.length) }
      ]
    );
  }

  res.json({ status: "GENERATED", markers: analysis.markers.length });
});

router.get("/sessions/:id/export.csv", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cues = await query<{
    t_ms: number;
    duration_ms: number | null;
    type: string;
    look: any;
    targets: any;
  }>(
    "SELECT t_ms, duration_ms, type, look, targets FROM cue_events WHERE session_id = $1 ORDER BY t_ms ASC",
    [req.params.id]
  );

  const lines = [
    "timecode,cueType,targetGroups,color,intensity,notes",
    ...cues.map((cue) => {
      const minutes = Math.floor(cue.t_ms / 60000).toString().padStart(2, "0");
      const seconds = Math.floor((cue.t_ms % 60000) / 1000).toString().padStart(2, "0");
      const millis = Math.floor(cue.t_ms % 1000).toString().padStart(3, "0");
      const timecode = `${minutes}:${seconds}.${millis}`;
      return [
        timecode,
        cue.type,
        (cue.targets?.groupIds ?? []).join("|"),
        cue.look?.paletteColorRef ?? "",
        cue.look?.intensity ?? "",
        ""
      ].join(",");
    })
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=autoque-cues.csv");
  res.send(lines.join("\n"));
});

router.get("/sessions/:id/export.pdf", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cues = await query<{
    t_ms: number;
    type: string;
    look: any;
  }>("SELECT t_ms, type, look FROM cue_events WHERE session_id = $1 ORDER BY t_ms ASC", [req.params.id]);

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=autoque-cues.pdf");
  doc.pipe(res);

  doc.fontSize(18).text("AutoQue Cue Sheet", { align: "left" });
  doc.moveDown();

  cues.forEach((cue, index) => {
    const minutes = Math.floor(cue.t_ms / 60000).toString().padStart(2, "0");
    const seconds = Math.floor((cue.t_ms % 60000) / 1000).toString().padStart(2, "0");
    const millis = Math.floor(cue.t_ms % 1000).toString().padStart(3, "0");
    doc.fontSize(12).text(
      `${index + 1}. ${minutes}:${seconds}.${millis} | ${cue.type} | Intensity ${cue.look?.intensity ?? ""}`
    );
  });

  doc.end();
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
