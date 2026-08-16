import { StorageAdapter } from "grammy";
import { prisma } from "./prisma";

/**
 * grammY session'ni PostgreSQL'dagi bot_sessions jadvalida saqlaydi.
 * Shu tufayli bot restart bo'lganda foydalanuvchining conversation holati
 * (masalan, "maktab tanlash" bosqichida to'xtab qolgan bo'lsa) yo'qolmaydi (spec §11).
 */
export function createPrismaSessionStorage<T>(): StorageAdapter<T> {
  return {
    async read(key) {
      const row = await prisma.botSession.findUnique({ where: { telegramId: BigInt(key) } });
      return row ? (row.data as T) : undefined;
    },
    async write(key, value) {
      await prisma.botSession.upsert({
        where: { telegramId: BigInt(key) },
        update: { data: value as object },
        create: { telegramId: BigInt(key), data: value as object },
      });
    },
    async delete(key) {
      await prisma.botSession
        .delete({ where: { telegramId: BigInt(key) } })
        .catch(() => undefined); // mavjud bo'lmasa xato bermasin
    },
  };
}
