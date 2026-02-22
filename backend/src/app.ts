import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./logger.js";
import { query } from "./db.js";
import authRoutes from "./routes/auth.js";
import cueRoutes from "./routes/cues.js";
import venueRoutes from "./routes/venues.js";
import rigRoutes from "./routes/rigs.js";
import sessionRoutes from "./routes/sessions.js";
import { requireAuth } from "./middleware/auth.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use((pinoHttp as unknown as (options: { logger: unknown }) => express.RequestHandler)({
    logger
  }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await query("SELECT 1");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/auth", authRoutes);
  app.use("/venues", requireAuth, venueRoutes);
  app.use("/rigs", requireAuth, rigRoutes);
  app.use("/autoque", requireAuth, sessionRoutes);
  app.use("/cues", requireAuth, cueRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}
