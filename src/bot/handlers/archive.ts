/**
 * Phase 8: Archive handlers.
 *
 * Provides:
 *   - Archive menu (entry point)
 *   - Archive statistics
 *   - Archivable attendance list
 *   - Bulk archive old attendance
 *   - Archived students list
 *   - Archive/unarchive individual student
 *
 * Authorization: VIEW_ARCHIVE for viewing, MANAGE_ARCHIVE for operations.
 * School isolation: SCHOOL_ADMIN sees own school; ADMIN/SUPER_ADMIN see all.
 */
import type { BotContext } from "../../types";
import { archiveService } from "../../services/archiveService";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
} from "../../auth/permissions";
import { mainMenu } from "../ui/screens";
import { safeEditMessage } from "../ui/helpers";
import { InlineKeyboard } from "grammy";

async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);
  if (!user) return null;
  return { user, admin };
}

/**
 * Archive menu — entry point.
 */
export async function archiveMenuHandler(ctx: BotContext): Promise<void> {
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
    Permission.VIEW_ARCHIVE,
    adminForCheck
  )) {
    await ctx.reply("⛔️ Sizda arxivni ko'rish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const canManage = hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.MANAGE_ARCHIVE,
    adminForCheck
  );

  const kb = new InlineKeyboard()
    .text("📊 Arxiv statistikasi", "archive_stats")
    .row()
    .text("📅 Davomat tarixi", "archive_attendance_list")
    .row()
    .text("👨‍🎓 Arxiv o'quvchilar", "archive_students_list")
    .row();
  if (canManage) {
    kb.text("🗄 Eski davomatni arxivlash", "archive_attendance_bulk").row();
  }
  kb.text("◀️ Orqaga", "back_to_admin_menu");

  await safeEditMessage(
    ctx,
    `🗄 Arxiv\n\nArxiv bo'limini tanlang:`,
    kb
  );
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Archive statistics.
 */
export async function archiveStatsHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const stats = await archiveService.getArchiveStats({
      actorTelegramId: telegramId,
    });

    let text = `📊 Arxiv statistikasi\n\n`;

    text += `📅 Davomat:\n`;
    text += `• Jami: ${stats.attendance.total}\n`;
    text += `• Faol: ${stats.attendance.active}\n`;
    text += `• Arxivlangan: ${stats.attendance.archived}\n`;
    text += `• Arxivlash mumkin: ${stats.attendance.eligibleForArchive}\n\n`;

    text += `👨‍🎓 O'quvchilar:\n`;
    text += `• Jami: ${stats.students.total}\n`;
    text += `• Faol: ${stats.students.active}\n`;
    text += `• Arxivlangan: ${stats.students.archived}\n\n`;

    text += `📝 Murojaatlar:\n`;
    text += `• Jami: ${stats.complaints.total}\n`;
    text += `• Faol: ${stats.complaints.active}\n`;
    text += `• Hal qilingan: ${stats.complaints.resolved}\n\n`;

    text += `👨‍🏫 Xodimlar:\n`;
    text += `• Jami: ${stats.staff.total}\n`;
    text += `• Faol: ${stats.staff.active}\n`;
    text += `• Nofaol: ${stats.staff.inactive}\n\n`;

    text += `🔐 Audit loglar:\n`;
    text += `• Davomat audit: ${stats.auditLogs.attendanceAuditLogs}\n`;
    text += `• Xodim amallari: ${stats.auditLogs.staffActionLogs}\n`;
    text += `• Admin amallari: ${stats.auditLogs.adminActionLogs}\n`;

    const kb = new InlineKeyboard()
      .text("◀️ Arxiv menyusi", "archive_menu")
      .row()
      .text("🏠 Bosh menyu", "home");

    await safeEditMessage(ctx, text, kb);
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
 * List archivable attendance records (old + not yet archived).
 */
export async function archiveAttendanceListHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const records = await archiveService.findArchivableAttendance({
      actorTelegramId: telegramId,
      limit: 30,
    });

    if (records.length === 0) {
      await safeEditMessage(
        ctx,
        "📅 Arxivlash uchun davomat yozuvlari topilmadi.\n\n(Eski yozuvlar yo'q yoki allaqachon arxivlangan)",
        new InlineKeyboard()
          .text("◀️ Arxiv menyusi", "archive_menu")
      );
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    let text = `📅 Arxivlash mumkin bo'lgan davomat (${records.length} ta):\n\n`;
    for (const r of records.slice(0, 15)) {
      const dateStr = r.date.toLocaleDateString("uz-UZ");
      text += `• ${r.studentName} — ${dateStr} (${r.status})\n`;
    }
    if (records.length > 15) {
      text += `... va yana ${records.length - 15} ta\n`;
    }

    const kb = new InlineKeyboard()
      .text("◀️ Arxiv menyusi", "archive_menu");

    await safeEditMessage(ctx, text, kb);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Ro'yxat olinmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Bulk archive old attendance.
 */
export async function archiveAttendanceBulkHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const result = await archiveService.archiveOldAttendance({
      actorTelegramId: telegramId,
      limit: 500,
    });

    await safeEditMessage(
      ctx,
      `✅ Arxivlash yakunlandi!\n\n` +
      `Arxivlangan yozuvlar: ${result.archivedCount}\n\n` +
      `Eski davomat yozuvlari arxivga ko'chirildi.`,
      new InlineKeyboard()
        .text("◀️ Arxiv menyusi", "archive_menu")
    );
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Arxivlash amalga oshmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * List archived students.
 */
export async function archiveStudentsListHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const telegramId = BigInt(ctx.from.id);

  try {
    const students = await archiveService.listArchivedStudents({
      actorTelegramId: telegramId,
      limit: 30,
    });

    if (students.length === 0) {
      await safeEditMessage(
        ctx,
        "👨‍🎓 Arxivlangan o'quvchilar yo'q.",
        new InlineKeyboard()
          .text("◀️ Arxiv menyusi", "archive_menu")
      );
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }

    let text = `👨‍🎓 Arxivlangan o'quvchilar (${students.length} ta):\n\n`;
    for (const s of students.slice(0, 15)) {
      const dateStr = s.archivedAt.toLocaleDateString("uz-UZ");
      text += `• ${s.fullName} (${s.className}) — ${dateStr}\n`;
    }
    if (students.length > 15) {
      text += `... va yana ${students.length - 15} ta\n`;
    }

    const kb = new InlineKeyboard()
      .text("◀️ Arxiv menyusi", "archive_menu");

    await safeEditMessage(ctx, text, kb);
  } catch (error: any) {
    await safeEditMessage(
      ctx,
      `⚠️ ${error.message || "Ro'yxat olinmadi."}`,
      mainMenu().keyboard
    );
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}
