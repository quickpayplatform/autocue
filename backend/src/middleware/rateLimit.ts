import rateLimit from "express-rate-limit";
import { config } from "../config.js";

export const cueSubmissionLimiter = rateLimit({
  windowMs: config.cueRateLimit.windowMs,
  max: config.cueRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false
});
