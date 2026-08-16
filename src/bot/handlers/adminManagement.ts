import type { BotContext } from "../../types";
import { adminRepo } from "../../repositories/adminRepo";
import { adminService } from "../../services/adminService";
import { prisma } from "../../database/prisma";
import {
  superAdminMenuKeyboard,
  adminListKeyboard,
  adminDetailKeyboard,
  confirmationKeyboard,
  roleChangeKeyboard,
  schoolSelectionKeyboard,
  neighborhoodSelectionKeyboard,
  responsibilitySelectionKeyboard,
} from "../keyboards/adminManagement";
import { adminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * SUPER_ADMIN menu handler - shows admin management options
 */
export async function superAdminMenuHandler(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.reply("⛔️ Sizda SUPER_ADMIN huquqi yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  await ctx.reply("👥 Adminlarni boshqarish", { reply_markup: superAdminMenuKeyboard });
}

/**
 * List all admins
 */
export async function listAllAdminsHandler(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.reply("⛔️ Sizda SUPER_ADMIN huquqi yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  const admins = await prisma.admin.findMany({
    include: {
      school: true,
      neighborhood: true,
      responsibilities: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (admins.length === 0) {
    await ctx.reply("Tizimda adminla yo'q.", { reply_markup: superAdminMenuKeyboard });
    return;
  }

  const adminList = admins.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    role: a.role,
    schoolName: a.school?.name,
    neighborhoodName: a.neighborhood?.name,
    isActive: a.isActive,
  }));

  await ctx.reply("👥 Barcha adminlar:", {
    reply_markup: adminListKeyboard(adminList),
  });
}

/**
 * List school admins
 */
export async function listSchoolAdminsHandler(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.reply("⛔️ Sizda SUPER_ADMIN huquqi yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  const admins = await prisma.admin.findMany({
    where: { role: "SCHOOL_ADMIN" },
    include: {
      school: true,
      responsibilities: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (admins.length === 0) {
    await ctx.reply("Tizimda maktab adminlari yo'q.", { reply_markup: superAdminMenuKeyboard });
    return;
  }

  const adminList = admins.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    role: a.role,
    schoolName: a.school?.name,
    neighborhoodName: null,
    isActive: a.isActive,
  }));

  await ctx.reply("🏫 Maktab adminlari:", {
    reply_markup: adminListKeyboard(adminList),
  });
}

/**
 * List neighborhood admins
 */
export async function listNeighborhoodAdminsHandler(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.reply("⛔️ Sizda SUPER_ADMIN huquqi yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  const admins = await prisma.admin.findMany({
    where: { role: "NEIGHBORHOOD_ADMIN" },
    include: {
      neighborhood: true,
      responsibilities: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (admins.length === 0) {
    await ctx.reply("Tizimda mahalla adminlari yo'q.", { reply_markup: superAdminMenuKeyboard });
    return;
  }

  const adminList = admins.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    role: a.role,
    schoolName: null,
    neighborhoodName: a.neighborhood?.name,
    isActive: a.isActive,
  }));

  await ctx.reply("🏘️ Mahalla adminlari:", {
    reply_markup: adminListKeyboard(adminList),
  });
}

/**
 * View admin details
 */
export async function viewAdminCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  const responsibilities = (targetAdmin.responsibilities as any)?.map((r: any) => r.responsibility).join(", ") || "Yo'q";

  let text =
    `👤 Admin\n\n` +
    `📛 Ism: ${targetAdmin.fullName || "Noma'lum"}\n` +
    `🆔 Telegram ID: ${targetAdmin.telegramId}\n` +
    `🎭 Rol: ${targetAdmin.role}\n`;

  if ((targetAdmin as any).school) {
    text += `🏫 Maktab: ${(targetAdmin as any).school.name}\n`;
  }
  if ((targetAdmin as any).neighborhood) {
    text += `🏘️ Mahalla: ${(targetAdmin as any).neighborhood.name}\n`;
  }

  text +=
    `🎯 Mas'uliyatlar: ${responsibilities}\n` +
    `🟢 Holat: ${targetAdmin.isActive ? "Faol" : "Faol emas"}`;

  await ctx.reply(text, { reply_markup: adminDetailKeyboard(targetAdminId) });
  await ctx.answerCallbackQuery();
}

/**
 * Deactivate admin (soft delete).
 *
 * Same security guards as deleteAdminCallback: SUPER_ADMIN role required,
 * target must exist, self-deletion blocked, last-active-SUPER_ADMIN
 * protected.
 */
export async function deactivateAdminCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  // Self-deletion guard: a Super Admin must not deactivate themselves.
  if (targetAdminId === admin.id) {
    await ctx.answerCallbackQuery({
      text: "⚠️ O'zingizni faolsizlantira olmaysiz. Iltimos, boshqa SUPER_ADMIN ga murojaat qiling.",
      show_alert: true,
    });
    return;
  }

  // Check if this is the last active SUPER_ADMIN
  if (targetAdmin.role === "SUPER_ADMIN") {
    const activeSuperAdmins = await prisma.admin.count({
      where: { role: "SUPER_ADMIN", isActive: true },
    });

    if (activeSuperAdmins <= 1) {
      await ctx.answerCallbackQuery({ text: "⚠️ Tizimda kamida bitta faol SUPER_ADMIN bo'lishi kerak.", show_alert: true });
      return;
    }
  }

  ctx.session.targetAdminId = targetAdminId;

  await ctx.reply(
    `⚠️ Adminni faolsizlantirmoqchimisiz?\n\n${targetAdmin.fullName || "Admin"}\n\nU botdagi admin funksiyalaridan foydalana olmaydi.`,
    { reply_markup: confirmationKeyboard("deactivate", targetAdminId) }
  );
  await ctx.answerCallbackQuery();
}

/**
 * Activate admin
 */
export async function activateAdminCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  try {
    await adminService.activateAdmin(targetAdminId, admin.id);
    await ctx.answerCallbackQuery({ text: "✅ Admin faollashtirildi." });
    await ctx.reply(`✅ ${targetAdmin.fullName || "Admin"} faollashtirildi.`, { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Delete admin (soft delete via deactivation).
 *
 * This shows a confirmation screen before deactivating the admin. The
 * deactivation itself is performed by `confirmActionCallback` when the
 * Super Admin taps "✅ Ha, tasdiqlash".
 *
 * Security guards (all enforced server-side, NOT just by hiding the UI):
 *   1. ctx.admin must exist AND have role SUPER_ADMIN (checked at the top).
 *   2. Target admin must exist (findById returns null otherwise).
 *   3. Self-deletion is rejected: targetAdminId === admin.id → blocked.
 *      A Super Admin must not delete themselves — this would lock them
 *      out of the admin panel and could leave the system without a
 *      reachable Super Admin.
 *   4. Last-active-SUPER_ADMIN protection: if the target is a SUPER_ADMIN
 *      and there is only 1 active SUPER_ADMIN, deletion is blocked.
 *
 * No assignedComplaints check: soft delete (deactivation) does NOT break
 * assignments. The complaint remains assigned to the now-inactive admin;
 * a Super Admin can reassign it to an active admin if needed. Historical
 * assignment records and admin reply messages are preserved.
 */
export async function deleteAdminCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  // Self-deletion guard: a Super Admin must not delete themselves.
  if (targetAdminId === admin.id) {
    await ctx.answerCallbackQuery({
      text: "⚠️ O'zingizni o'chira olmaysiz. Iltimos, boshqa SUPER_ADMIN ga murojaat qiling.",
      show_alert: true,
    });
    return;
  }

  // Last-active-SUPER_ADMIN protection
  if (targetAdmin.role === "SUPER_ADMIN") {
    const activeSuperAdmins = await prisma.admin.count({
      where: { role: "SUPER_ADMIN", isActive: true },
    });

    if (activeSuperAdmins <= 1) {
      await ctx.answerCallbackQuery({ text: "⚠️ Tizimda kamida bitta faol SUPER_ADMIN bo'lishi kerak.", show_alert: true });
      return;
    }
  }

  ctx.session.targetAdminId = targetAdminId;

  // Build a detailed confirmation screen showing the admin's info and
  // explaining what soft-delete means.
  let detail =
    `👤 Ism: ${targetAdmin.fullName || "Noma'lum"}\n` +
    `🆔 Telegram ID: ${targetAdmin.telegramId}\n` +
    `🎭 Rol: ${targetAdmin.role}\n`;
  if ((targetAdmin as any).school) {
    detail += `🏫 Maktab: ${(targetAdmin as any).school.name}\n`;
  }
  if ((targetAdmin as any).neighborhood) {
    detail += `🏘️ Mahalla: ${(targetAdmin as any).neighborhood.name}\n`;
  }

  await ctx.reply(
    `⚠️ Adminni o'chirmoqchimisiz?\n\n${detail}\n` +
    `Bu admin faolsizlantiriladi:\n` +
    `• Admin paneliga kirishi bloklanadi\n` +
    `• Yangi murojaatlar biriktirilmaydi\n` +
    `• Tarixiy ma'lumotlar (murojaatlar, javoblar) saqlanadi\n\n` +
    `Tasdiqlaysizmi?`,
    { reply_markup: confirmationKeyboard("delete", targetAdminId) }
  );
  await ctx.answerCallbackQuery();
}

/**
 * Edit responsibilities
 */
export async function editResponsibilitiesCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  const currentResponsibilities = new Set(
    targetAdmin.responsibilities?.map((r: any) => r.responsibility) || []
  );

  ctx.session.targetAdminId = targetAdminId;
  ctx.session.selectedResponsibilities = Array.from(currentResponsibilities);

  await ctx.reply(
    `🎯 Mas'uliyatlarni o'zgartirish\n\nAdmin: ${targetAdmin.fullName || "Admin"}`,
    {
      reply_markup: responsibilitySelectionKeyboard(currentResponsibilities),
    }
  );
  await ctx.answerCallbackQuery();
}

/**
 * Edit scope (school/neighborhood)
 */
export async function editScopeCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  ctx.session.targetAdminId = targetAdminId;

  if (targetAdmin.role === "SCHOOL_ADMIN") {
    const schools = await prisma.school.findMany();
    await ctx.reply("🏫 Maktabni tanlang:", {
      reply_markup: schoolSelectionKeyboard(schools),
    });
  } else if (targetAdmin.role === "NEIGHBORHOOD_ADMIN") {
    const neighborhoods = await prisma.neighborhood.findMany();
    await ctx.reply("🏘️ Mahallani tanlang:", {
      reply_markup: neighborhoodSelectionKeyboard(neighborhoods),
    });
  } else {
    await ctx.answerCallbackQuery({ text: "SUPER_ADMIN uchun scope o'zgartirish mumkin emas.", show_alert: true });
    return; // Fix: prevent double answerCallbackQuery
  }

  await ctx.answerCallbackQuery();
}

/**
 * Edit name
 */
export async function editNameCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  ctx.session.targetAdminId = targetAdminId;

  await ctx.reply("✏️ Yangi ismni kiriting:");
  await ctx.answerCallbackQuery();
}

/**
 * Change role
 */
export async function changeRoleCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdmin = await adminRepo.findById(targetAdminId);

  if (!targetAdmin) {
    await ctx.answerCallbackQuery({ text: "Admin topilmadi.", show_alert: true });
    return;
  }

  ctx.session.targetAdminId = targetAdminId;

  await ctx.reply(
    `🎭 Rolni o'zgartirish\n\nAdmin: ${targetAdmin.fullName || "Admin"}`,
    { reply_markup: roleChangeKeyboard() }
  );
  await ctx.answerCallbackQuery();
}

/**
 * Confirmation callback handler
 */
export async function confirmActionCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const [_, action, targetAdminIdStr] = ctx.callbackQuery.data.split(":");
  const targetAdminId = Number(targetAdminIdStr);

  try {
    if (action === "deactivate") {
      await adminService.deactivateAdmin(targetAdminId, admin.id);
      await ctx.answerCallbackQuery({ text: "✅ Admin faolsizlantirildi." });
      await ctx.reply("✅ Admin faolsizlantirildi.", { reply_markup: adminMenuKeyboard });
    } else if (action === "delete") {
      // Soft delete (deactivation). The admin is NOT physically removed —
      // their isActive flag is set to false. This preserves all historical
      // data (assignments, replies, action logs) while blocking the admin
      // from accessing /admin and receiving new assignments.
      await adminService.deleteAdmin(targetAdminId, admin.id);
      await ctx.answerCallbackQuery({ text: "✅ Admin o'chirildi (faolsizlantirildi)." });
      await ctx.reply(
        "✅ Admin o'chirildi (faolsizlantirildi).\n\n" +
        "Admin paneliga kirishi bloklandi. Tarixiy ma'lumotlar saqlanadi.",
        { reply_markup: adminMenuKeyboard }
      );
    } else if (action === "promote_super_admin") {
      // H4 fix: implement the missing promote_super_admin confirmation
      // branch. changeRoleConfirmCallback sets up a confirmation screen
      // with callback_data "confirm:promote_super_admin:<id>"; without
      // this branch, the confirmation tap did nothing (dead code).
      await adminService.updateAdmin(targetAdminId, { role: "SUPER_ADMIN" }, admin.id);
      await ctx.answerCallbackQuery({ text: "✅ SUPER_ADMIN huquqi berildi." });
      await ctx.reply("✅ Admin SUPER_ADMIN ga ko'tarildi.", { reply_markup: adminMenuKeyboard });
    }
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Callback handler for selecting school
 */
export async function selectSchoolCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const schoolId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdminId = ctx.session.targetAdminId;

  if (!targetAdminId) {
    await ctx.answerCallbackQuery({ text: "Xatolik: admin ID topilmadi.", show_alert: true });
    return;
  }

  try {
    await adminService.updateAdmin(targetAdminId, {
      schoolId,
      neighborhoodId: undefined,
    }, admin.id);
    await ctx.answerCallbackQuery({ text: "✅ Maktab yangilandi." });
    await ctx.reply("✅ Maktab yangilandi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Callback handler for selecting neighborhood
 */
export async function selectNeighborhoodCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const neighborhoodId = Number(ctx.callbackQuery.data.split(":")[1]);
  const targetAdminId = ctx.session.targetAdminId;

  if (!targetAdminId) {
    await ctx.answerCallbackQuery({ text: "Xatolik: admin ID topilmadi.", show_alert: true });
    return;
  }

  try {
    await adminService.updateAdmin(targetAdminId, {
      neighborhoodId,
      schoolId: undefined,
    }, admin.id);
    await ctx.answerCallbackQuery({ text: "✅ Mahalla yangilandi." });
    await ctx.reply("✅ Mahalla yangilandi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Callback handler for changing role
 */
export async function changeRoleConfirmCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const newRole = ctx.callbackQuery.data.split(":")[1];
  const targetAdminId = ctx.session.targetAdminId;

  if (!targetAdminId) {
    await ctx.answerCallbackQuery({ text: "Xatolik: admin ID topilmadi.", show_alert: true });
    return;
  }

  // Special confirmation for SUPER_ADMIN promotion
  if (newRole === "SUPER_ADMIN") {
    ctx.session.pendingRole = newRole;
    await ctx.reply(
      `⚠️ SUPER_ADMIN huquqi\n\nBu foydalanuvchiga butun tizim bo'yicha yuqori darajadagi boshqaruv huquqini beradi.\n\nDavom etasizmi?`,
      { reply_markup: confirmationKeyboard("promote_super_admin", targetAdminId) }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    await adminService.updateAdmin(targetAdminId, { role: newRole }, admin.id);
    await ctx.answerCallbackQuery({ text: "✅ Rol yangilandi." });
    await ctx.reply("✅ Rol yangilandi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Callback handler for saving responsibilities
 */
export async function saveResponsibilitiesCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const targetAdminId = ctx.session.targetAdminId;
  const responsibilities = ctx.session.selectedResponsibilities;

  if (!targetAdminId || !responsibilities) {
    await ctx.answerCallbackQuery({ text: "Xatolik: ma'lumotlar topilmadi.", show_alert: true });
    return;
  }

  try {
    await adminService.updateAdmin(targetAdminId, { responsibilities }, admin.id);
    await ctx.answerCallbackQuery({ text: "✅ Mas'uliyatlar yangilandi." });
    await ctx.reply("✅ Mas'uliyatlar yangilandi.", { reply_markup: adminMenuKeyboard });
  } catch (error) {
    await ctx.answerCallbackQuery({ text: "❌ Xatolik yuz berdi.", show_alert: true });
  }
}

/**
 * Callback handler for toggling responsibility selection
 */
export async function toggleResponsibilityCallback(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery?.data) return;

  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const respKey = ctx.callbackQuery.data.split(":")[1];
  const currentSelection = ctx.session.selectedResponsibilities || [];

  if (currentSelection.includes(respKey)) {
    ctx.session.selectedResponsibilities = currentSelection.filter((r: string) => r !== respKey);
  } else {
    ctx.session.selectedResponsibilities = [...currentSelection, respKey];
  }

  const selectedSet = new Set(ctx.session.selectedResponsibilities);
  await ctx.editMessageReplyMarkup({
    reply_markup: responsibilitySelectionKeyboard(selectedSet),
  });
  await ctx.answerCallbackQuery();
}

/**
 * Back to menu callback
 */
export async function backToMenuCallback(ctx: BotContext): Promise<void> {
  await ctx.reply("👥 Adminlarni boshqarish", { reply_markup: superAdminMenuKeyboard });
  await ctx.answerCallbackQuery();
}

/**
 * Back to list callback
 * L3 fix: re-fetch the admin list instead of passing an empty array.
 */
export async function backToListCallback(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin || (admin as any).role !== "SUPER_ADMIN") {
    await ctx.answerCallbackQuery({ text: "⛔️ Sizda SUPER_ADMIN huquqi yo'q.", show_alert: true });
    return;
  }

  const admins = await prisma.admin.findMany({
    include: { school: true, neighborhood: true, responsibilities: true },
    orderBy: { createdAt: "desc" },
  });

  const adminList = admins.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    role: a.role,
    schoolName: a.school?.name,
    neighborhoodName: a.neighborhood?.name,
    isActive: a.isActive,
  }));

  await ctx.reply("👥 Barcha adminlar:", {
    reply_markup: adminListKeyboard(adminList),
  });
  await ctx.answerCallbackQuery();
}
