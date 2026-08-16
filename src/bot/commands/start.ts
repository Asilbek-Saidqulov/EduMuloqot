import type { BotContext } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  welcomeScreen,
  mainMenu,
  staffDeactivatedScreen,
} from "../ui/screens";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";
import {
  getEffectiveRole,
  isStaffRole,
  isUserActiveStaff,
} from "../../auth/permissions";

/**
 * /start command handler.
 *
 * Routes users based on their role:
 *   - Deactivated staff → deactivation screen
 *   - Active staff → role-specific panel (with dashboard summary for admins)
 *   - Registered parent/student → main menu
 *   - Unregistered → welcome screen
 *
 * Feature #10: School admins see a dashboard summary above their panel:
 *   "📊 Bugun: 3 yangi murojaat, 2 kutilmoqda, 5 ariza"
 *
 * Feature #6: Teachers see a "Bugungi davomat" hint if they haven't
 * recorded today's attendance yet.
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findOrCreateByTelegramId(telegramId, ctx.from.first_name);

  const admin = await adminRepo.findByTelegramId(telegramId);
  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive, schoolId: admin.schoolId, neighborhoodId: admin.neighborhoodId }
    : null;

  // Deactivated staff
  if (isStaffRole(user.role) && !isUserActiveStaff({ role: user.role, isActive: user.isActive }, adminForCheck)) {
    const screen = staffDeactivatedScreen();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    return;
  }

  // Active staff — route to role-specific panel
  if (isUserActiveStaff({ role: user.role, isActive: user.isActive }, adminForCheck)) {
    const effectiveRole = getEffectiveRole(
      { role: user.role, isActive: user.isActive },
      adminForCheck ? { role: adminForCheck.role, isActive: adminForCheck.isActive } : null
    );
    const roleLabels: Record<string, string> = {
      TEACHER: "👨‍🏫 O'qituvchi",
      CLASS_TEACHER: "👨‍🏫 Sinf rahbari",
      MAHALLA_RESPONSIBLE: "🏘 Mahalla mas'uli",
      SCHOOL_ADMIN: "🏫 Maktab administratori",
      ADMIN: "🛡 Admin",
      SUPER_ADMIN: "👑 Super Admin",
    };
    const label = roleLabels[effectiveRole] || effectiveRole;

    // Build dashboard summary for admin roles + teacher attendance hint
    const dashboard = await buildStaffDashboard(effectiveRole, user.id, user.schoolId);

    await ctx.reply(`${label} paneli${dashboard ? "\n\n" + dashboard : ""}`, {
      reply_markup: getAdminMenuKeyboard(effectiveRole),
    });
    return;
  }

  // Registered parent/student
  if (userRepo.isUserRegistered(user)) {
    // Bug Fix: STUDENT gets a student-specific menu, not the parent menu
    if (user.role === "STUDENT") {
      const { getMainMenuForRole } = await import("../ui/screens");
      const screen = getMainMenuForRole("STUDENT");
      await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    } else {
      const screen = mainMenu();
      await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    }
  } else {
    const screen = welcomeScreen();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  }
}

/**
 * Build a one-line dashboard summary for staff roles.
 *   - SCHOOL_ADMIN/ADMIN/SUPER_ADMIN: complaint + application counts
 *   - TEACHER/CLASS_TEACHER: "Bugungi davomat belgilanmagan" hint
 *   - MAHALLA_RESPONSIBLE: pending escalation count
 */
async function buildStaffDashboard(role: string, userId: number, schoolId: number | null): Promise<string> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (role === "SCHOOL_ADMIN" || role === "ADMIN" || role === "SUPER_ADMIN") {
    // For SCHOOL_ADMIN, scope to their school. For ADMIN/SUPER_ADMIN, global.
    const schoolFilter = (role === "SCHOOL_ADMIN" && schoolId) ? { schoolId } : {};

    const [newComplaints, inProgressComplaints, pendingApplications, pendingEscalations] = await Promise.all([
      prisma.complaint.count({ where: { ...schoolFilter, status: "NEW" } }),
      prisma.complaint.count({ where: { ...schoolFilter, status: "IN_PROGRESS" } }),
      (prisma as any).studentApplication.count({
        where: { ...schoolFilter, status: "PENDING" },
      }),
      prisma.attendanceEscalation.count({ where: { resolvedAt: null } }),
    ]);

    const parts: string[] = [];
    if (newComplaints > 0) parts.push(`📥 ${newComplaints} yangi murojaat`);
    if (inProgressComplaints > 0) parts.push(`🔄 ${inProgressComplaints} kutilmoqda`);
    if (pendingApplications > 0) parts.push(`📋 ${pendingApplications} ariza`);
    if (pendingEscalations > 0 && role !== "SCHOOL_ADMIN") parts.push(`🚨 ${pendingEscalations} ogohlantirish`);

    if (parts.length === 0) return "📊 Bugun: hamma narsa tartibda ✅";
    return "📊 Bugun: " + parts.join(", ");
  }

  if (role === "TEACHER" || role === "CLASS_TEACHER") {
    // Check if the teacher has recorded today's attendance for any class.
    const todayAttendance = await prisma.attendance.count({
      where: {
        recordedById: userId,
        date: today,
      },
    });
    if (todayAttendance === 0) {
      return "💡 Bugungi davomat hali belgilanmagan. \"📋 Davomat\" tugmasini bosing.";
    }
    return "✅ Bugungi davomat belgilangan.";
  }

  if (role === "MAHALLA_RESPONSIBLE") {
    const pendingEscalations = await prisma.attendanceEscalation.count({
      where: { resolvedAt: null },
    });
    if (pendingEscalations > 0) {
      return `🚨 ${pendingEscalations} ta ko'rib chiqilmagan ogohlantirish`;
    }
    return "📊 Yangi ogohlantirishlar yo'q.";
  }

  return "";
}
