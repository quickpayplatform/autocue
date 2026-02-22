import { query } from "../db.js";
import { hashPassword } from "../utils/password.js";
import { logger } from "../logger.js";

const theatreName = process.env.THEATRE_NAME;
const theatreTimezone = process.env.THEATRE_TIMEZONE ?? "UTC";
const theatreAddress = process.env.THEATRE_ADDRESS ?? null;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!theatreName || !adminEmail || !adminPassword) {
  throw new Error("THEATRE_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required");
}

const theatres = await query<{ id: string }>(
  "SELECT id FROM venues WHERE name = $1",
  [theatreName]
);
let theatreId = theatres[0]?.id;

if (!theatreId) {
  const rows = await query<{ id: string }>(
    "INSERT INTO venues (id, name, address, timezone, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now(), now()) RETURNING id",
    [theatreName, theatreAddress, theatreTimezone]
  );
  theatreId = rows[0].id;
  logger.info({ theatreId }, "Theatre created");
}

let userId = (await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminEmail]))[0]?.id;
if (!userId) {
  const passwordHash = await hashPassword(adminPassword);
  const userRows = await query<{ id: string }>(
    "INSERT INTO users (id, email, name, password_hash, role, theatre_id, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 'THEATRE_ADMIN', $4, now(), now()) RETURNING id",
    [adminEmail, adminEmail.split("@")[0], passwordHash, theatreId]
  );
  userId = userRows[0].id;
  logger.info({ userId }, "Admin user created");
}

await query(
  "INSERT INTO venue_users (id, venue_id, user_id, role, created_at) VALUES (gen_random_uuid(), $1, $2, 'ADMIN', now()) ON CONFLICT (venue_id, user_id) DO UPDATE SET role = 'ADMIN'",
  [theatreId, userId]
);

logger.info({ theatreId, userId }, "Admin membership ensured");
