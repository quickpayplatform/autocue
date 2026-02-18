import { query } from "../db.js";
import { hashPassword } from "../utils/password.js";
import { logger } from "../logger.js";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
}

const existing = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
if (existing.length > 0) {
  logger.info("Admin user already exists");
  process.exit(0);
}

const passwordHash = await hashPassword(password);
await query(
  "INSERT INTO users (id, email, password_hash, role, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ADMIN', now(), now())",
  [email, passwordHash]
);

logger.info("Admin user created");
