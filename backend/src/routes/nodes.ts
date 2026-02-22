import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { query } from "../db.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Role } from "../types.js";

const router = Router();

const NODE_ADMIN_ROLES: Role[] = ["THEATRE_ADMIN", "THEATRE_TECH", "ADMIN"];

const pairStartSchema = z.object({
  fingerprint: z.string().optional()
});

const pairClaimSchema = z.object({
  code: z.string().min(6),
  displayName: z.string().min(2),
  os: z.enum(["macos", "windows", "linux"]),
  venueId: z.string().uuid().optional()
});

const pairCompleteSchema = z.object({
  code: z.string().min(6),
  nonce: z.string().min(6)
});

const heartbeatSchema = z.object({
  version: z.string().optional(),
  os: z.string().optional(),
  status: z.string().optional(),
  consoleReachable: z.boolean().optional(),
  consoleIp: z.string().optional(),
  oscMode: z.string().optional(),
  lastError: z.string().optional()
});

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }).map(() => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function hasNodeAccess(userId: string, venueId: string) {
  const rows = await query<{ role: string }>(
    "SELECT role FROM venue_users WHERE venue_id = $1 AND user_id = $2",
    [venueId, userId]
  );
  return rows.length > 0;
}

router.post("/node-pair/start", async (req, res) => {
  const parsed = pairStartSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const code = generateCode();
  const nonce = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await query(
    "INSERT INTO node_pairing_codes (id, code, nonce, expires_at, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())",
    [code, nonce, expiresAt]
  );

  res.json({ code, nonce, expiresAt });
});

router.post("/node-pair/claim", async (req: AuthedRequest, res) => {
  const parsed = pairClaimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!req.user || !NODE_ADMIN_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const pairingRows = await query<{ id: string; expires_at: string; claimed_at: string | null }>(
    "SELECT id, expires_at, claimed_at FROM node_pairing_codes WHERE code = $1",
    [parsed.data.code]
  );
  const pairing = pairingRows[0];
  if (!pairing) {
    res.status(404).json({ error: "Pairing code not found" });
    return;
  }
  if (pairing.claimed_at) {
    res.status(409).json({ error: "Pairing code already claimed" });
    return;
  }

  const venueId = parsed.data.venueId ?? null;
  if (!venueId) {
    res.status(400).json({ error: "venueId is required" });
    return;
  }

  const venueRows = await query<{ id: string; plan_status: string; node_enabled: boolean }>(
    "SELECT id, plan_status, node_enabled FROM venues WHERE id = $1",
    [venueId]
  );
  const venue = venueRows[0];
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  if (!venue.node_enabled && venue.plan_status !== "active") {
    res.status(403).json({ error: "Node access not enabled" });
    return;
  }

  const token = generateToken();
  const tokenHash = await bcrypt.hash(token, 12);

  const nodeRows = await query<{ id: string }>(
    "INSERT INTO nodes (id, venue_id, display_name, os, status, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'offline', now(), now()) RETURNING id",
    [venue.id, parsed.data.displayName, parsed.data.os]
  );

  await query(
    "INSERT INTO node_tokens (node_id, token_hash, created_at, last_rotated_at) VALUES ($1, $2, now(), now())",
    [nodeRows[0].id, tokenHash]
  );

  await query(
    "UPDATE node_pairing_codes SET venue_id = $1, node_id = $2, created_by_user_id = $3, claimed_at = now() WHERE code = $4",
    [venue.id, nodeRows[0].id, req.user.userId, parsed.data.code]
  );

  res.json({ nodeId: nodeRows[0].id, nodeToken: token });
});

router.post("/node-pair/complete", async (req, res) => {
  const parsed = pairCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const pairingRows = await query<{ node_id: string; nonce: string; claimed_at: string | null }>(
    "SELECT node_id, nonce, claimed_at FROM node_pairing_codes WHERE code = $1",
    [parsed.data.code]
  );
  const pairing = pairingRows[0];
  if (!pairing || pairing.nonce !== parsed.data.nonce || !pairing.claimed_at) {
    res.status(404).json({ error: "Pairing not ready" });
    return;
  }

  res.status(409).json({ error: "Token is delivered at claim time" });
});

router.post("/nodes/:nodeId/heartbeat", async (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await query(
    "UPDATE nodes SET last_seen_at = now(), status = $1, version = COALESCE($2, version), updated_at = now() WHERE id = $3",
    [parsed.data.status ?? "online", parsed.data.version ?? null, req.params.nodeId]
  );

  res.json({ status: "ok" });
});

router.post("/nodes/:nodeId/command", async (req: AuthedRequest, res) => {
  if (!req.user || !NODE_ADMIN_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const nodeRows = await query<{ venue_id: string }>(
    "SELECT venue_id FROM nodes WHERE id = $1",
    [req.params.nodeId]
  );
  const node = nodeRows[0];
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }
  const allowed = await hasNodeAccess(req.user.userId, node.venue_id);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const nodeWs = req.app.get("nodeWs");
  const accepted = nodeWs?.sendCommand?.(req.params.nodeId, req.body) ?? false;
  res.json({ accepted });
});

router.post("/nodes/:nodeId/cues/:cueId/result", async (req, res) => {
  const ok = Boolean(req.body?.ok);
  const status = ok ? "EXECUTED" : "FAILED";
  await query(
    "UPDATE cues SET status = $1, executed_at = CASE WHEN $1 = 'EXECUTED' THEN now() ELSE executed_at END, updated_at = now() WHERE id = $2",
    [status, req.params.cueId]
  );
  await query(
    "INSERT INTO audit_logs (id, cue_id, venue_id, event_type, message, created_at) VALUES (gen_random_uuid(), $1, (SELECT venue_id FROM cues WHERE id = $1), $2, $3, now())",
    [req.params.cueId, ok ? "EXECUTED" : "FAILED", ok ? "Node reported execution" : "Node reported failure"]
  );
  res.json({ status });
});

router.get("/venues/:venueId/nodes", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const allowed = await hasNodeAccess(req.user.userId, req.params.venueId);
  if (!allowed && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const nodes = await query(
    "SELECT id, display_name, os, version, status, last_seen_at FROM nodes WHERE venue_id = $1 ORDER BY created_at DESC",
    [req.params.venueId]
  );

  res.json(nodes);
});

router.get("/node-downloads", async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const venues = await query<{ plan_status: string; node_enabled: boolean }>(
    "SELECT plan_status, node_enabled FROM venues v JOIN venue_users vu ON vu.venue_id = v.id WHERE vu.user_id = $1 LIMIT 1",
    [req.user.userId]
  );
  const venue = venues[0];
  if (!venue || (!venue.node_enabled && venue.plan_status !== "active")) {
    res.json({ available: false, downloads: [] });
    return;
  }

  const downloads = [] as Array<{ os: string; url: string; sha256: string; version: string }>;
  if (process.env.NODE_DOWNLOAD_MACOS_URL) {
    downloads.push({
      os: "macos",
      url: process.env.NODE_DOWNLOAD_MACOS_URL,
      sha256: process.env.NODE_DOWNLOAD_MACOS_SHA256 ?? "",
      version: process.env.NODE_DOWNLOAD_VERSION ?? "0.1.0"
    });
  }
  if (process.env.NODE_DOWNLOAD_WINDOWS_URL) {
    downloads.push({
      os: "windows",
      url: process.env.NODE_DOWNLOAD_WINDOWS_URL,
      sha256: process.env.NODE_DOWNLOAD_WINDOWS_SHA256 ?? "",
      version: process.env.NODE_DOWNLOAD_VERSION ?? "0.1.0"
    });
  }

  res.json({ available: downloads.length > 0, downloads });
});

export default router;
