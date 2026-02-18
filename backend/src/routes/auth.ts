import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { logAudit } from "../services/audit.js";

const router = Router();

const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

router.post("/register", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const existing = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const rows = await query<{ id: string; role: string }>(
    "INSERT INTO users (id, email, password_hash, role, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'SUBMITTER', now(), now()) RETURNING id, role",
    [email, passwordHash]
  );

  const user = rows[0];
  const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: "12h"
  });

  await logAudit(null, "REGISTER", `User registered: ${email}`);

  res.status(201).json({ token });
});

router.post("/login", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, password } = parsed.data;
  const rows = await query<{ id: string; password_hash: string; role: string }>(
    "SELECT id, password_hash, role FROM users WHERE email = $1",
    [email]
  );

  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, config.jwtSecret, {
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
    expiresIn: "12h"
  });

  await logAudit(null, "LOGIN", `User logged in: ${email}`);

  res.json({ token });
});

export default router;
