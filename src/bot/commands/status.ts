import type { BotContext } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  getEffectiveRole,
  isUserActiveStaff,
  isStaffRole,
} from "../../auth/permissions";
import { Permission, hasPermission } from "../../auth/permissions";
import { mainMenu } from "../ui/screens";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * /status command — system health dashboard for SUPER_ADMIN.
 *
 * Shows a quick pulse-check of the system:
 *   - Total users (by role)
 *   - Active staff count
 *   - Complaints today
 *   - Attendance records today
 *   - Pending student applications
 *   - Pending escalations
 *
 * Authorization: only SUPER_ADMIN and ADMIN can run this.
 */
export async function statusCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

  const effectiveRole = getEffectiveRole(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  );

  // Role-aware keyboard: staff get their panel, parent/student get main menu
  const roleKeyboard = (isStaffRole(user.role) && isUserActiveStaff(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  ))
    ? getAdminMenuKeyboard(effectiveRole)
    : mainMenu().keyboard;

  // Authorization: SUPER_ADMIN or ADMIN only
  if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
    await ctx.reply(
      "⛔️ /status buyrug'i faqat ADMIN va SUPER_ADMIN uchun.",
      { reply_markup: roleKeyboard }
    );
    return;
  }

  // Gather stats
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const [
    totalUsers,
    activeStaff,
    parents,
    students,
    teachers,
    schoolAdmins,
    complaintsToday,
    attendanceToday,
    pendingApplications,
    pendingEscalations,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: {
        role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"] },
        isActive: true,
      },
    }),
    prisma.user.count({ where: { role: "PARENT" } }),
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.user.count({
      where: { role: { in: ["TEACHER", "CLASS_TEACHER"] }, isActive: true },
    }),
    prisma.user.count({ where: { role: "SCHOOL_ADMIN", isActive: true } }),
    prisma.complaint.count({
      where: { createdAt: { gte: today, lt: tomorrow } },
    }),
    prisma.attendance.count({
      where: { createdAt: { gte: today, lt: tomorrow } },
    }),
    (prisma as any).studentApplication.count({ where: { status: "PENDING" } }),
    prisma.attendanceEscalation.count({ where: { resolvedAt: null } }),
  ]);

  const text =
    `📊 Tizim holati\n\n` +
    `👤 Foydalanuvchilar:\n` +
    `• Jami: ${totalUsers}\n` +
    `• Ota-onalar: ${parents}\n` +
    `• O'quvchilar: ${students}\n` +
    `• Faol xodimlar: ${activeStaff}\n` +
    `  - O'qituvchilar: ${teachers}\n` +
    `  - Maktab adminlari: ${schoolAdmins}\n\n` +
    `📋 Bugun:\n` +
    `• Yangi murojaatlar: ${complaintsToday}\n` +
    `• Davomat yozuvlari: ${attendanceToday}\n` +
    `• Kutilayotgan arizalar: ${pendingApplications}\n` +
    `• Faol ogohlantirishlar: ${pendingEscalations}`;

  await ctx.reply(text, { reply_markup: getAdminMenuKeyboard(effectiveRole) });
}
