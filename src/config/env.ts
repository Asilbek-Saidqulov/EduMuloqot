import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN .env faylida ko'rsatilishi shart"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL .env faylida ko'rsatilishi shart"),
  BOOTSTRAP_ADMIN_IDS: z.string().optional().default(""),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Phase 5: number of consecutive ABSENT days that triggers a mahalla
  // escalation notification. Default 3 — sensible default for a school
  // system, but can be overridden via env. Set to 0 to disable escalation.
  MAHALLA_ABSENCE_THRESHOLD: z.coerce.number().int().min(0).default(3),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // sensitive data'ni log qilmaslik: faqat qaysi maydonlar xato ekanini chiqaramiz, qiymatlarini emas
  console.error("Environment validation error:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const bootstrapAdminIds: bigint[] = env.BOOTSTRAP_ADMIN_IDS.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => BigInt(s));

/**
 * Phase 5: configurable threshold for consecutive-absence mahalla
 * escalation. Read from MAHALLA_ABSENCE_THRESHOLD env var (default 3).
 * When set to 0, escalation is disabled entirely.
 */
export const mahallaAbsenceThreshold: number = env.MAHALLA_ABSENCE_THRESHOLD;
