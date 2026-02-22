import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Role } from "../types.js";

const router = Router();

const THEATRE_ROLES: Role[] = ["THEATRE_ADMIN", "THEATRE_TECH", "ADMIN"];

const rigSchema = z.object({
  theatreId: z.string().uuid(),
  name: z.string().min(2),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  notes: z.string().optional()
});

const positionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["FOH", "ELECTRIC", "BOOM", "BOX_BOOM", "FLOOR", "PRACTICAL", "OTHER"]),
  orderIndex: z.number().int().min(0).default(0)
});

const fixtureTypeSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  category: z.enum(["DIMMER", "LED", "MOVING_LIGHT", "PRACTICAL", "EFFECT", "OTHER"]),
  capabilities: z.record(z.any())
});

const fixtureInstanceSchema = z.object({
  fixtureTypeId: z.string().uuid(),
  positionId: z.string().uuid(),
  label: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  orientation: z.record(z.any()).optional()
});

const groupSchema = z.object({
  name: z.string().min(1),
  fixtureInstanceIds: z.array(z.string().uuid()).default([])
});

const stageBackgroundSchema = z.object({
  imageUrl: z.string().url(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  cameraNotes: z.string().optional(),
  calibration: z.record(z.any())
});

const placementSchema = z.object({
  fixtureInstanceId: z.string().uuid(),
  stageX: z.number(),
  stageY: z.number(),
  height: z.number().optional(),
  photoXpx: z.number().optional(),
  photoYpx: z.number().optional()
});

async function requireTheatreRole(userId: string, theatreId: string): Promise<boolean> {
  const rows = await query<{ role: string }>(
    "SELECT role FROM venue_users WHERE venue_id = $1 AND user_id = $2",
    [theatreId, userId]
  );
  return rows.length > 0;
}

router.post("/", async (req: AuthedRequest, res) => {
  const parsed = rigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, parsed.data.theatreId);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO rig_versions (id, theatre_id, name, status, created_by_user_id, notes, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now()) RETURNING id",
    [parsed.data.theatreId, parsed.data.name, parsed.data.status, req.user.userId, parsed.data.notes ?? null]
  );
  res.status(201).json({ id: rows[0].id });
});

router.get("/", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const theatreId = req.query.theatreId as string | undefined;
  if (!theatreId) {
    res.status(400).json({ error: "theatreId is required" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, theatreId);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const rows = await query(
    "SELECT id, theatre_id, name, status, created_by_user_id, notes, created_at, updated_at FROM rig_versions WHERE theatre_id = $1 ORDER BY created_at DESC",
    [theatreId]
  );
  res.json(rows);
});

router.get("/:id/detail", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rigRows = await query<{ id: string; theatre_id: string; name: string; status: string }>(
    "SELECT id, theatre_id, name, status FROM rig_versions WHERE id = $1",
    [req.params.id]
  );
  const rig = rigRows[0];
  if (!rig) {
    res.status(404).json({ error: "Rig not found" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, rig.theatre_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const positions = await query(
    "SELECT id, name, type, order_index FROM positions WHERE rig_version_id = $1 ORDER BY order_index ASC",
    [rig.id]
  );
  const fixtures = await query(
    "SELECT id, fixture_type_id, position_id, label, quantity, orientation FROM fixture_instances WHERE rig_version_id = $1",
    [rig.id]
  );
  const fixtureTypes = await query(
    "SELECT id, manufacturer, model, category, capabilities FROM fixture_types"
  );
  const groups = await query(
    "SELECT id, name FROM groups WHERE rig_version_id = $1",
    [rig.id]
  );
  const groupFixtures = await query(
    "SELECT group_id, fixture_instance_id FROM group_fixtures WHERE group_id IN (SELECT id FROM groups WHERE rig_version_id = $1)",
    [rig.id]
  );
  const stageBackgrounds = await query(
    "SELECT id, image_url, width_px, height_px, camera_notes, calibration FROM stage_backgrounds WHERE rig_version_id = $1 ORDER BY created_at DESC",
    [rig.id]
  );
  const placements = await query(
    "SELECT id, fixture_instance_id, stage_x, stage_y, height, photo_x_px, photo_y_px FROM fixture_placements WHERE fixture_instance_id IN (SELECT id FROM fixture_instances WHERE rig_version_id = $1)",
    [rig.id]
  );

  res.json({
    rig,
    positions,
    fixtures,
    fixtureTypes,
    groups,
    groupFixtures,
    stageBackgrounds,
    placements
  });
});

router.post("/:id/positions", async (req: AuthedRequest, res) => {
  const parsed = positionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rigRows = await query<{ theatre_id: string }>(
    "SELECT theatre_id FROM rig_versions WHERE id = $1",
    [req.params.id]
  );
  const rig = rigRows[0];
  if (!rig) {
    res.status(404).json({ error: "Rig not found" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, rig.theatre_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO positions (id, rig_version_id, name, type, order_index, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id",
    [req.params.id, parsed.data.name, parsed.data.type, parsed.data.orderIndex]
  );
  res.status(201).json({ id: rows[0].id });
});

router.post("/:id/groups", async (req: AuthedRequest, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await query<{ theatre_id: string }>(
    "SELECT theatre_id FROM rig_versions WHERE id = $1",
    [req.params.id]
  );
  const rig = rows[0];
  if (!rig) {
    res.status(404).json({ error: "Rig not found" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, rig.theatre_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const groupRows = await query<{ id: string }>(
    "INSERT INTO groups (id, rig_version_id, name, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id",
    [req.params.id, parsed.data.name]
  );

  for (const fixtureId of parsed.data.fixtureInstanceIds) {
    await query(
      "INSERT INTO group_fixtures (id, group_id, fixture_instance_id, created_at) VALUES (gen_random_uuid(), $1, $2, now()) ON CONFLICT (group_id, fixture_instance_id) DO NOTHING",
      [groupRows[0].id, fixtureId]
    );
  }

  res.status(201).json({ id: groupRows[0].id });
});

router.post("/:id/stage-background", async (req: AuthedRequest, res) => {
  const parsed = stageBackgroundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rigRows = await query<{ theatre_id: string }>(
    "SELECT theatre_id FROM rig_versions WHERE id = $1",
    [req.params.id]
  );
  const rig = rigRows[0];
  if (!rig) {
    res.status(404).json({ error: "Rig not found" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, rig.theatre_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO stage_backgrounds (id, rig_version_id, image_url, width_px, height_px, camera_notes, calibration, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now()) RETURNING id",
    [
      req.params.id,
      parsed.data.imageUrl,
      parsed.data.widthPx,
      parsed.data.heightPx,
      parsed.data.cameraNotes ?? null,
      parsed.data.calibration
    ]
  );

  res.status(201).json({ id: rows[0].id });
});

router.post("/:id/placements", async (req: AuthedRequest, res) => {
  const parsed = placementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO fixture_placements (id, fixture_instance_id, stage_x, stage_y, height, photo_x_px, photo_y_px, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now()) RETURNING id",
    [
      parsed.data.fixtureInstanceId,
      parsed.data.stageX,
      parsed.data.stageY,
      parsed.data.height ?? null,
      parsed.data.photoXpx ?? null,
      parsed.data.photoYpx ?? null
    ]
  );

  res.status(201).json({ id: rows[0].id });
});

router.post("/fixture-types", async (req: AuthedRequest, res) => {
  const parsed = fixtureTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO fixture_types (id, manufacturer, model, category, capabilities, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id",
    [parsed.data.manufacturer, parsed.data.model, parsed.data.category, parsed.data.capabilities]
  );

  res.status(201).json({ id: rows[0].id });
});

router.get("/fixture-types", async (_req, res) => {
  const rows = await query(
    "SELECT id, manufacturer, model, category, capabilities, created_at, updated_at FROM fixture_types ORDER BY manufacturer, model"
  );
  res.json(rows);
});

router.post("/:id/fixtures", async (req: AuthedRequest, res) => {
  const parsed = fixtureInstanceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !THEATRE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rigRows = await query<{ theatre_id: string }>(
    "SELECT theatre_id FROM rig_versions WHERE id = $1",
    [req.params.id]
  );
  const rig = rigRows[0];
  if (!rig) {
    res.status(404).json({ error: "Rig not found" });
    return;
  }

  const allowed = await requireTheatreRole(req.user.userId, rig.theatre_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Not a theatre member" });
    return;
  }

  const rows = await query<{ id: string }>(
    "INSERT INTO fixture_instances (id, rig_version_id, fixture_type_id, position_id, label, quantity, orientation, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now(), now()) RETURNING id",
    [
      req.params.id,
      parsed.data.fixtureTypeId,
      parsed.data.positionId,
      parsed.data.label,
      parsed.data.quantity,
      parsed.data.orientation ?? null
    ]
  );

  res.status(201).json({ id: rows[0].id });
});

export default router;
