/**
 * Feature #11: Staff workload view.
 *
 * Shows which teachers haven't recorded attendance today (or for X
 * days), so school admins can follow up.
 *
 * Flow:
 *   School admin → "📊 Davomat hisoboti" → "Belgilanmagan sinflar"
 *   → list of teachers who haven't recorded today's attendance
 *
 * Authorization: SCHOOL_ADMIN, ADMIN, SUPER_ADMIN (VIEW_SCHOOL_DATA).
 */
import type { BotContext } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
} from "../../auth/permissions";
import { mainMenu } from "../ui/screens";
import { safeEditMessage } from "../ui/helpers";

async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);
  if (!user) return null;
  return { user, admin };
}

function getActorSchoolId(actor: {
  user: { schoolId: number | null };
  admin: { isActive: boolean; schoolId: number | null } | null;
}): number | null {
  if (actor.admin?.isActive && actor.admin.schoolId != null) {
    return actor.admin.schoolId;
  }
  return actor.user.schoolId;
}

/**
 * Show teachers who haven't recorded today's attendance.
 */
export async function staffWorkloadHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;

  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_SCHOOL_DATA,
    adminForCheck
  )) {
    await ctx.reply("⛔️ Sizda bu ma'lumotni ko'rish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const effectiveRole = getEffectiveRole(
    { role: actor.user.role, isActive: actor.user.isActive },
    adminForCheck
  );

  // School scope: SCHOOL_ADMIN sees their school, ADMIN/SUPER_ADMIN see all
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let teachers: any[];
  if (effectiveRole === "SCHOOL_ADMIN") {
    const schoolId = getActorSchoolId(actor);
    if (!schoolId) {
      await ctx.reply("⚠️ Sizga maktab biriktirilmagan.", { reply_markup: mainMenu().keyboard });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
    teachers = await prisma.user.findMany({
      where: {
        role: { in: ["TEACHER", "CLASS_TEACHER"] },
        isActive: true,
        schoolId,
      },
      select: { id: true, fullName: true, role: true },
    });
  } else {
    // ADMIN / SUPER_ADMIN — all teachers
    teachers = await prisma.user.findMany({
      where: {
        role: { in: ["TEACHER", "CLASS_TEACHER"] },
        isActive: true,
      },
      select: { id: true, fullName: true, role: true, schoolId: true },
    });
  }

  // For each teacher, check if they recorded attendance today
  const results = [];
  for (const teacher of teachers) {
    const todayCount = await prisma.attendance.count({
      where: {
        recordedById: teacher.id,
        date: today,
      },
    });
    if (todayCount === 0) {
      // Get the last time they recorded attendance
      const lastRecord = await prisma.attendance.findFirst({
        where: { recordedById: teacher.id },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      const daysSince = lastRecord
        ? Math.floor((today.getTime() - lastRecord.date.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      results.push({
        teacher,
        lastRecordDate: lastRecord?.date ?? null,
        daysSince,
      });
    }
  }

  if (results.length === 0) {
    await ctx.reply(
      "✅ Barcha o'qituvchilar bugungi davomatni belgilab bo'lishdi!",
      { reply_markup: mainMenu().keyboard }
    );
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  let text = `📋 Belgilanmagan davomat (${results.length} ta o'qituvchi):\n\n`;
  for (const r of results) {
    const roleLabel = r.teacher.role === "CLASS_TEACHER" ? "Sinf rahbari" : "O'qituvchi";
    const lastLabel = r.lastRecordDate
      ? `oxirgi: ${r.lastRecordDate.toLocaleDateString("uz-UZ")} (${r.daysSince} kun oldin)`
      : "hech qachon belgilamagan";
    text += `• ${r.teacher.fullName || "Noma'lum"} (${roleLabel}) — ${lastLabel}\n`;
  }

  await ctx.reply(text, { reply_markup: mainMenu().keyboard });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}
