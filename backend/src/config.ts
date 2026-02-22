import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? "development",
  databaseUrl: requireEnv("DATABASE_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtIssuer: process.env.JWT_ISSUER ?? "autoque",
  jwtAudience: process.env.JWT_AUDIENCE ?? "autoque-users",
  oscIp: requireEnv("OSC_IP"),
  oscPort: Number(process.env.OSC_PORT ?? 3032),
  oscRateMs: Number(process.env.OSC_RATE_MS ?? 100),
  oscRetryAttempts: Number(process.env.OSC_RETRY_ATTEMPTS ?? 3),
  oscRetryDelayMs: Number(process.env.OSC_RETRY_DELAY_MS ?? 10000),
  oscIpWhitelist: (process.env.OSC_IP_WHITELIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
  lockedCueNumbers: (process.env.LOCKED_CUE_NUMBERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value)),
  cueRateLimit: {
    windowMs: Number(process.env.CUE_RATE_LIMIT_WINDOW_MS ?? 60000),
    max: Number(process.env.CUE_RATE_LIMIT_MAX ?? 20)
  },
  patchRange: {
    min: Number(process.env.PATCH_RANGE_MIN ?? 1),
    max: Number(process.env.PATCH_RANGE_MAX ?? 512)
  }
};
