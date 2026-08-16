/**
 * Phase 5+: Escalation resolution handlers (for mahalla responsibles).
 *
 * Allows a mahalla responsible to:
 *   - List escalations for their neighborhood
 *   - View an escalation's details
 *   - Mark an escalation "Ko'rib chiqilmoqda" (in progress)
 *   - Mark an escalation "Hal qilindi" (resolved) with an optional note
 *
 * This closes the loop — currently escalations are fire-and-forget.
 * With resolution tracking, the school knows the mahalla acted.
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
 * List escalations for the actor's neighborhood.
 */
export async function escalationListHandler(ctx: BotContext): Promise<void> {
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
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
    adminForCheck
  )) {
    await ctx.reply("⛔️ Sizda ogohlantirishlarni ko'rish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Get the neighborhood ID
  const neighborhoodId = actor.admin?.isActive
    ? actor.admin.neighborhoodId
    : actor.user.neighborhoodId;

  if (!neighborhoodId) {
    await ctx.reply("⚠️ Sizga mahalla biriktirilmagan.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const escalations = await prisma.attendanceEscalation.findMany({
    where: { neighborhoodId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      student: { select: { id: true, fullName: true, className: true } },
      school: { select: { id: true, name: true } },
    },
  });

  if (escalations.length === 0) {
    await ctx.reply("🚨 Hozircha ogohlantirishlar yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const kb = new InlineKeyboard();
  for (const e of escalations) {
    const statusIcon = e.resolvedAt ? "✅" : "🚨";
    kb.text(
      `${statusIcon} ${e.student?.fullName || "Noma'lum"} — ${e.absenceCount} kun`,
      `view_escalation:${e.id}`
    ).row();
  }
  kb.text("◀️ Orqaga", "back_to_admin_menu");

  await ctx.reply(
    `🚨 Ogohlantirishlar (${escalations.length} ta):\n\nKo'rish uchun bosing:`,
    { reply_markup: kb }
  );
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * View a single escalation's details.
 */
export async function escalationViewHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const escalationId = Number(ctx.callbackQuery.data.split(":")[1]);
  if (!Number.isInteger(escalationId) || escalationId <= 0) {
    await ctx.answerCallbackQuery({ text: "Noto'g'ri so'rov.", show_alert: true });
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
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
    adminForCheck
  )) {
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const escalation = await prisma.attendanceEscalation.findUnique({
    where: { id: escalationId },
    include: {
      student: { select: { id: true, fullName: true, className: true } },
      school: { select: { id: true, name: true } },
    },
  });

  if (!escalation) {
    await ctx.reply("⚠️ Ogohlantirish topilmadi.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // School isolation: mahalla responsible can only see escalations for their neighborhood
  const neighborhoodId = actor.admin?.isActive
    ? actor.admin.neighborhoodId
    : actor.user.neighborhoodId;

  if (escalation.neighborhoodId !== neighborhoodId) {
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const dateStr = escalation.thresholdDate.toLocaleDateString("uz-UZ", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const statusLabel = escalation.resolvedAt
    ? `✅ Hal qilindi (${escalation.resolvedAt.toLocaleDateString("uz-UZ")})`
    : "🚨 Faol";

  let text =
    `🚨 Ogohlantirish #${escalation.id}\n\n` +
    `👤 O'quvchi: ${escalation.student?.fullName || "Noma'lum"}\n` +
    `📚 Sinf: ${escalation.student?.className || "Noma'lum"}\n` +
    `🏫 Maktab: ${escalation.school?.name || "Noma'lum"}\n\n` +
    `📊 Ketma-ket davom etmagan kunlar: ${escalation.absenceCount}\n` +
    `📅 Oxirgi sana: ${dateStr}\n` +
    `📊 Holat: ${statusLabel}\n`;

  const kb = new InlineKeyboard();
  if (!escalation.resolvedAt) {
    kb.text("✅ Hal qilindi deb belgilash", `resolve_escalation:${escalation.id}`).row();
  }
  kb.text("◀️ Orqaga", "escalation_list");

  await ctx.reply(text, { reply_markup: kb });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Mark an escalation as resolved.
 */
export async function escalationResolveHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const escalationId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor) {
    await ctx.answerCallbackQuery({ text: "Foydalanuvchi topilmadi.", show_alert: true });
    return;
  }

  const adminForCheck = actor.admin
    ? { role: actor.admin.role, isActive: actor.admin.isActive }
    : null;

  if (!hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.VIEW_NEIGHBORHOOD_ATTENDANCE,
    adminForCheck
  )) {
    await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
    return;
  }

  const escalation = await prisma.attendanceEscalation.findUnique({
    where: { id: escalationId },
  });

  if (!escalation) {
    await ctx.answerCallbackQuery({ text: "Ogohlantirish topilmadi.", show_alert: true });
    return;
  }

  // School isolation
  const neighborhoodId = actor.admin?.isActive
    ? actor.admin.neighborhoodId
    : actor.user.neighborhoodId;

  if (escalation.neighborhoodId !== neighborhoodId) {
    await ctx.answerCallbackQuery({ text: "⛔️ Ruxsat yo'q.", show_alert: true });
    return;
  }

  if (escalation.resolvedAt) {
    await ctx.answerCallbackQuery({ text: "Allaqachon hal qilingan.", show_alert: true });
    return;
  }

  await prisma.attendanceEscalation.update({
    where: { id: escalationId },
    data: { resolvedAt: new Date() },
  });

  await ctx.answerCallbackQuery({ text: "✅ Hal qilindi deb belgilandi." });
  await ctx.reply(
    "✅ Ogohlantirish hal qilindi deb belgilandi.\n\n" +
    "O'quvchi oilasi bilan bog'langaningiz uchun rahmat!",
    { reply_markup: mainMenu().keyboard }
  );
}
