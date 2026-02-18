import { Router } from "express";
import { z } from "zod";
import { query } from "../db.js";
import { AuthedRequest } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { Role, VenueRole } from "../types.js";
import { logAudit } from "../services/audit.js";

const router = Router();

const venueSchema = z.object({
  name: z.string().min(2),
  patchRangeMin: z.number().int().min(1).default(1),
  patchRangeMax: z.number().int().min(1).default(512),
  lockedCueNumbers: z.array(z.number().int().positive()).default([])
});

const venueUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["SUBMITTER", "OPERATOR", "ADMIN"])
});

const ADMIN_ONLY: Role[] = ["ADMIN"];

router.post("/", requireRole(ADMIN_ONLY), async (req: AuthedRequest, res) => {
  const parsed = venueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { name, patchRangeMin, patchRangeMax, lockedCueNumbers } = parsed.data;
  const rows = await query<{ id: string }>(
    "INSERT INTO venues (id, name, patch_range_min, patch_range_max, locked_cue_numbers, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id",
    [name, patchRangeMin, patchRangeMax, lockedCueNumbers]
  );

  res.status(201).json({ id: rows[0].id });
});

router.get("/", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const venues = await query(
    `SELECT v.id, v.name, v.patch_range_min, v.patch_range_max, v.locked_cue_numbers, vu.role
     FROM venues v
     JOIN venue_users vu ON vu.venue_id = v.id
     WHERE vu.user_id = $1
     ORDER BY v.name ASC`,
    [req.user.userId]
  );

  res.json(venues);
});

router.get("/:id", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const venues = await query(
    `SELECT v.id, v.name, v.patch_range_min, v.patch_range_max, v.locked_cue_numbers, vu.role
     FROM venues v
     JOIN venue_users vu ON vu.venue_id = v.id
     WHERE v.id = $1 AND vu.user_id = $2`,
    [req.params.id, req.user.userId]
  );

  const venue = venues[0];
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  res.json(venue);
});

router.post("/:id/users", requireRole(ADMIN_ONLY), async (req: AuthedRequest, res) => {
  const parsed = venueUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { userId, role } = parsed.data as { userId: string; role: VenueRole };

  await query(
    "INSERT INTO venue_users (id, venue_id, user_id, role, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now()) ON CONFLICT (venue_id, user_id) DO UPDATE SET role = EXCLUDED.role",
    [req.params.id, userId, role]
  );

  await logAudit(null, req.params.id, "VENUE_USER_ROLE", `User ${userId} set to ${role}`);

  res.status(200).json({ status: "ok" });
});

export default router;
