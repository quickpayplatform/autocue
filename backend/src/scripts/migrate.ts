import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "../db.js";
import { logger } from "../logger.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(currentDir, "..", "sql", "schema.sql");

const sql = readFileSync(schemaPath, "utf-8");

try {
  await pool.query(sql);
  logger.info("Migration applied");
} catch (error) {
  logger.error({ error }, "Migration failed");
  process.exit(1);
} finally {
  await pool.end();
}
