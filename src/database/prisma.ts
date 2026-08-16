import { PrismaClient } from "@prisma/client";

// Singleton — dev rejimida hot-reload paytida ko'p ulanish ochilib ketmasligi uchun
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
