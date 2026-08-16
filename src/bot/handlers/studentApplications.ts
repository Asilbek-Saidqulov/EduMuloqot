/**
 * Phase 5+: Student Application handlers (for school admins).
 *
 * School admins can:
 *   - List pending applications for their school
 *   - View an application's details
 *   - Approve an application (creates a Student record + links it)
 *   - Reject an application
 *
 * Authorization: the actor must have VIEW_SCHOOL_DATA permission
 * (SCHOOL_ADMIN, ADMIN, SUPER_ADMIN). The school scope comes from
 * the actor's DB User record — callback data is never trusted for
 * schoolId.
 */
import type { BotContext } from "../../types";
import { studentApplicationRepo } from "../../repositories/studentApplicationRepo";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
  canAccessSchool,
} from "../../auth/permissions";
import { notificationService } from "../../services/notificationService";
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
 * List pending student applications for the actor's school.
 */
export async function applicationListHandler(ctx: BotContext): Promise<void> {
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
  const effectiveRole = getEffectiveRole(
    { role: actor.user.role, isActive: actor.user.isActive },
    adminForCheck
  );

  // Authorization: must have VIEW_SCHOOL_DATA permission
  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_SCHOOL_DATA,
    adminForCheck
  )) {
    await ctx.reply("⛔️ Sizda arizalarni ko'rish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Get applications
  let applications: any[] = [];
  if (effectiveRole === "SUPER_ADMIN" || effectiveRole === "ADMIN") {
    // Global — see all pending applications
    applications = await studentApplicationRepo.listAllPending();
  } else {
    // School-scoped
    const schoolId = getActorSchoolId(actor);
    if (!schoolId) {
      await ctx.reply("⚠️ Sizga maktab biriktirilmagan.", { reply_markup: mainMenu().keyboard });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
    applications = await studentApplicationRepo.listPendingBySchool(schoolId);
  }

  if (applications.length === 0) {
    await ctx.reply("📋 Hozircha arizalar yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Build the list
  const kb = new InlineKeyboard();
  for (const app of applications) {
    const schoolName = app.school?.name || `Maktab #${app.schoolId}`;
    kb.text(
      `${app.fullName} — ${schoolName}`,
      `view_application:${app.id}`
    ).row();
  }
  kb.text("◀️ Orqaga", "back_to_admin_menu");

  await ctx.reply(
    `📋 Arizalar (${applications.length} ta):\n\n` +
    `Ko'rish uchun arizani bosing:`,
    { reply_markup: kb }
  );
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * View a single application's details.
 */
export async function applicationViewHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const applicationId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Noto'g'ri ariza.", show_alert: true });
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
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const application = await studentApplicationRepo.findById(applicationId);
  if (!application) {
    await ctx.reply("⚠️ Ariza topilmadi.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // School isolation: SCHOOL_ADMIN can only view applications for their school
  const effectiveRole = getEffectiveRole(
    { role: actor.user.role, isActive: actor.user.isActive },
    adminForCheck
  );
  if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
    const actorSchoolId = getActorSchoolId(actor);
    if (application.schoolId !== actorSchoolId) {
      await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
  }

  // Build detail text
  let text = `📋 Ariza #${application.id}\n\n`;
  text += `👤 Ism: ${application.fullName}\n`;
  text += `🏫 Maktab: ${application.school?.name || "Noma'lum"}\n`;
  if (application.className) text += `📚 Sinf: ${application.className}\n`;
  if (application.phone) text += `📞 Telefon: ${application.phone}\n`;
  if (application.note) text += `📝 Izoh: ${application.note}\n`;
  text += `📅 Sana: ${application.createdAt.toLocaleDateString("uz-UZ")}\n`;
  text += `📊 Holat: ${application.status}\n`;

  if (application.status === "PENDING") {
    const kb = new InlineKeyboard()
      .text("✅ Tasdiqlash", `approve_application:${application.id}`)
      .row()
      .text("❌ Rad etish", `reject_application:${application.id}`)
      .row()
      .text("◀️ Orqaga", "application_list");
    await ctx.reply(text, { reply_markup: kb });
  } else {
    text += `\n✅ Hal qilindi: ${application.resolvedAt?.toLocaleDateString("uz-UZ") || ""}`;
    if (application.resolver) {
      text += `\n👤 Hal qiluvchi: ${application.resolver.fullName || "Noma'lum"}`;
    }
    const kb = new InlineKeyboard().text("◀️ Orqaga", "application_list");
    await ctx.reply(text, { reply_markup: kb });
  }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Approve an application: creates a Student record and links it.
 */
export async function applicationApproveHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const applicationId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  if (!actor) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Foydalanuvchi topilmadi.", show_alert: true });
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
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
    return;
  }

  const application = await studentApplicationRepo.findById(applicationId);
  if (!application) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Ariza topilmadi.", show_alert: true });
    return;
  }

  // School isolation
  const effectiveRole = getEffectiveRole(
    { role: actor.user.role, isActive: actor.user.isActive },
    adminForCheck
  );
  if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
    const actorSchoolId = getActorSchoolId(actor);
    if (application.schoolId !== actorSchoolId) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
      return;
    }
  }

  // Approve (creates Student record + links it)
  const result = await studentApplicationRepo.approve(applicationId, actor.user.id);
  if (!result) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Ariza allaqachon hal qilingan.", show_alert: true });
    return;
  }

  // Bug Fix #12: Actually notify the applicant via notificationService
  try {
    const applicant = await prisma.user.findUnique({
      where: { id: application.applicantUserId },
      select: { telegramId: true, fullName: true },
    });
    if (applicant) {
      const { notificationService } = await import("../../services/notificationService");
      await notificationService.notifyUser(
        applicant.telegramId,
        `✅ Arizangiz tasdiqlandi!\n\n` +
        `🏫 Maktab: ${application.school?.name || ""}\n` +
        `👤 Ismingiz: ${application.fullName}\n\n` +
        `Endi /start ni bosing va tizimga kirishingiz mumkin.`
      );
    }
  } catch (err) {
    console.error("Failed to notify applicant:", (err as Error).message);
  }

  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "✅ Ariza tasdiqlandi. O'quvchi ro'yxatga qo'shildi." });
  await ctx.reply(
    `✅ Ariza tasdiqlandi!\n\n` +
    `👤 O'quvchi: ${result.student.fullName}\n` +
    `🏫 Sinf: ${result.student.className}\n` +
    `🏫 Maktab: ${application.school?.name || ""}\n\n` +
    `O'quvchi endi tizimga kirishi mumkin (/start).`,
    { reply_markup: mainMenu().keyboard }
  );
}

/**
 * Reject an application.
 */
export async function applicationRejectHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const applicationId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);
  if (!actor) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Foydalanuvchi topilmadi.", show_alert: true });
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
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
    return;
  }

  const application = await studentApplicationRepo.findById(applicationId);
  if (!application) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Ariza topilmadi.", show_alert: true });
    return;
  }

  // School isolation
  const effectiveRole = getEffectiveRole(
    { role: actor.user.role, isActive: actor.user.isActive },
    adminForCheck
  );
  if (effectiveRole !== "SUPER_ADMIN" && effectiveRole !== "ADMIN") {
    const actorSchoolId = getActorSchoolId(actor);
    if (application.schoolId !== actorSchoolId) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
      return;
    }
  }

  const result = await studentApplicationRepo.reject(applicationId, actor.user.id);
  if (!result) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Ariza allaqachon hal qilingan.", show_alert: true });
    return;
  }

  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "❌ Ariza rad etildi." });
  await ctx.reply("❌ Ariza rad etildi.", { reply_markup: mainMenu().keyboard });
}
