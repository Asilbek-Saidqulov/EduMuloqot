/**
 * Phase 7: Report handlers.
 *
 * Provides a report menu with time-range options (today/week/month),
 * detailed statistics, escalation reports, and CSV export.
 *
 * All handlers:
 *   - Load the actor from DB (never trust callback data for scope)
 *   - Check permissions via hasPermission
 *   - Enforce school/neighborhood isolation
 *   - Use attendanceReportService for efficient Prisma aggregation
 */
import type { BotContext } from "../../types";
import { InputFile } from "grammy";
import { attendanceReportService, DateRange } from "../../services/attendanceReportService";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
} from "../../auth/permissions";
import { mainMenu } from "../ui/screens";
import {
  reportMenuScreen,
  detailedReportScreen,
  escalationReportScreen,
} from "../ui/screens";
import { safeEditMessage } from "../ui/helpers";

async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);
  if (!user) return null;
  return { user, admin };
}

/**
 * Report menu — entry point.
 * Shows time-range options + report types.
 */
export async function reportMenuHandler(ctx: BotContext): Promise<void> {
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

  // Authorization: must have VIEW_CLASS_ATTENDANCE or higher
  const canViewClass = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_CLASS_ATTENDANCE,
    adminForCheck
  );
  const canViewSchool = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_SCHOOL_ATTENDANCE,
    adminForCheck
  );
  const canViewNeighborhood = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
    adminForCheck
  );

  if (!canViewClass && !canViewSchool && !canViewNeighborhood) {
    await ctx.reply("⛔️ Sizda hisobotlarni ko'rish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // CSV export requires VIEW_SCHOOL_ATTENDANCE or higher
  const canExport = canViewSchool;

  const screen = reportMenuScreen(canExport);
  await safeEditMessage(ctx, screen.text, screen.keyboard);
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Generate + show a report for the selected time range.
 * Callback data: "report:today" | "report:week" | "report:month"
 */
export async function reportRangeHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const rangeStr = ctx.callbackQuery.data.split(":")[1] as DateRange;
  if (!["today", "week", "month"].includes(rangeStr)) {
    await ctx.answerCallbackQuery({ text: "Noto'g'ri davr.", show_alert: true });
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const report = await attendanceReportService.getReport({
      actorTelegramId: telegramId,
      dateRange: rangeStr as DateRange,
    });

    const scopeLabels: Record<string, string> = {
      global: "Global (barcha maktablar)",
      school: "Mening maktabim",
      neighborhood: "Mening mahallam",
      class: "Mening sinfim",
    };

    const screen = detailedReportScreen({
      scope: scopeLabels[report.scope] || report.scope,
      dateRangeLabel: report.dateRange.label,
      totals: report.totals,
      byClass: report.byClass,
      trend: report.trend,
      escalations: report.escalations,
      totalStudents: report.totalStudents,
    });
    await safeEditMessage(ctx, screen.text, screen.keyboard);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Hisobot olinmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Detailed statistics (month range with full breakdown).
 */
export async function reportStatsHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const report = await attendanceReportService.getReport({
      actorTelegramId: telegramId,
      dateRange: "month",
    });

    const scopeLabels: Record<string, string> = {
      global: "Global",
      school: "Mening maktabim",
      neighborhood: "Mening mahallam",
      class: "Mening sinfim",
    };

    const screen = detailedReportScreen({
      scope: scopeLabels[report.scope] || report.scope,
      dateRangeLabel: report.dateRange.label,
      totals: report.totals,
      byClass: report.byClass,
      trend: report.trend,
      escalations: report.escalations,
      totalStudents: report.totalStudents,
    });
    await safeEditMessage(ctx, screen.text, screen.keyboard);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Statistika olinmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Escalation statistics.
 */
export async function reportEscalationsHandler(ctx: BotContext): Promise<void> {
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

  try {
    const effectiveRole = getEffectiveRole(
      { role: actor.user.role, isActive: actor.user.isActive },
      adminForCheck
    );

    let schoolId: number | undefined;
    let neighborhoodId: number | undefined;

    if (effectiveRole === "SCHOOL_ADMIN" || effectiveRole === "TEACHER" || effectiveRole === "CLASS_TEACHER") {
      schoolId = actor.admin?.isActive ? actor.admin.schoolId ?? undefined : actor.user.schoolId ?? undefined;
    } else if (effectiveRole === "MAHALLA_RESPONSIBLE") {
      neighborhoodId = actor.admin?.isActive ? actor.admin.neighborhoodId ?? undefined : actor.user.neighborhoodId ?? undefined;
    }

    const stats = await attendanceReportService.getEscalationStats({
      actorTelegramId: telegramId,
      schoolId,
      neighborhoodId,
    });

    const scopeLabels: Record<string, string> = {
      global: "Global (barcha maktablar)",
      school: "Mening maktabim",
      neighborhood: "Mening mahallam",
      class: "Mening sinfim",
    };

    const screen = escalationReportScreen({
      scope: scopeLabels[effectiveRole] || effectiveRole,
      stats: { total: stats.total, unresolved: stats.unresolved, resolved: stats.resolved },
      bySchool: stats.bySchool.map(s => ({ schoolName: s.schoolName, count: s.count })),
      byNeighborhood: stats.byNeighborhood,
    });
    await safeEditMessage(ctx, screen.text, screen.keyboard);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Ogohlantirish statistikasi olinmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * CSV export — generates a CSV and sends it as a document.
 */
export async function reportExportHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const csv = await attendanceReportService.exportCsv({
      actorTelegramId: telegramId,
      dateRange: "month",
    });

    // Send the CSV as a document
    const fileName = `davomat_hisobot_${new Date().toISOString().split("T")[0]}.csv`;
    const buffer = Buffer.from("\uFEFF" + csv, "utf-8"); // BOM for Excel UTF-8 compatibility

    await ctx.replyWithDocument(
      new InputFile(buffer, fileName)
    );
    await ctx.answerCallbackQuery({ text: "✅ CSV eksport tayyor" });
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Eksport amalga oshmadi."}`,
      mainMenu().keyboard
    );
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  }
}
