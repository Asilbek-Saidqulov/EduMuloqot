import { BotContext, BotConversation } from "../../types";
import { InlineKeyboard } from "grammy";
import { adminService } from "../../services/adminService";
import { adminRepo } from "../../repositories/adminRepo";
import { roleSelectionKeyboard, responsibilitySelectionKeyboard, schoolSelectionKeyboard, neighborhoodSelectionKeyboard } from "../keyboards/adminManagement";
import { adminMenuKeyboard } from "../keyboards/adminMenu";
import { prisma } from "../../database/prisma";

interface AddAdminSession {
  telegramId?: bigint;
  fullName?: string;
  role?: string;
  schoolId?: number;
  neighborhoodId?: number;
  responsibilities: Set<string>;
}

export async function addAdminConversation(conversation: BotConversation, ctx: BotContext) {
  // C2 fix (defense-in-depth): verify SUPER_ADMIN role inside the conversation
  // too, not just at the entry handler. This prevents any code path that
  // somehow enters the conversation without going through the hears handler
  // (e.g. a future re-entry, a session-restore edge case) from letting a
  // non-SUPER_ADMIN create admins.
  if (!ctx.admin || (ctx.admin as any).role !== "SUPER_ADMIN") {
    await ctx.reply("⛔️ Sizda SUPER_ADMIN huquqi yo'q.", { reply_markup: adminMenuKeyboard });
    return;
  }

  const session: AddAdminSession = {
    responsibilities: new Set(),
  };

  // Step 1: Ask for Telegram ID
  await ctx.reply("🆔 Yangi admin qo'shish\n\nTelegram ID ni kiriting:");
  const telegramIdMsg = await conversation.wait();
  const telegramIdStr = telegramIdMsg.message?.text;
  if (!telegramIdStr || isNaN(Number(telegramIdStr))) {
    await ctx.reply("❌ Noto'g'ri Telegram ID. Iltimos, raqam kiriting.", { reply_markup: adminMenuKeyboard });
    return;
  }
  session.telegramId = BigInt(telegramIdStr);

  // Check for duplicate Telegram ID
  const existingAdmin = await adminRepo.findByTelegramId(session.telegramId);
  if (existingAdmin) {
    await ctx.reply("❌ Bu Telegram ID allaqachon ro'yxatdan o'tgan admin.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // Step 2: Ask for full name
  await ctx.reply("👤 Adminning to'liq ismini kiriting:");
  const fullNameMsg = await conversation.wait();
  const fullName = fullNameMsg.message?.text;
  if (!fullName || fullName.trim().length === 0) {
    await ctx.reply("❌ Ism kiritilmadi. Amal bekor qilindi.", { reply_markup: adminMenuKeyboard });
    return;
  }
  session.fullName = fullName.trim();

  // Step 3: Ask for role
  await ctx.reply("🎭 Admin rolini tanlang:", { reply_markup: roleSelectionKeyboard() });
  const roleMsg = await conversation.waitForCallbackQuery(["role:SUPER_ADMIN", "role:SCHOOL_ADMIN", "role:NEIGHBORHOOD_ADMIN", "cancel:add_admin"]);
  await roleMsg.answerCallbackQuery();

  if (roleMsg.callbackQuery.data === "cancel:add_admin") {
    await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: adminMenuKeyboard });
    return;
  }

  session.role = roleMsg.callbackQuery.data.split(":")[1];

  // Step 4: Ask for school/neighborhood based on role
  if (session.role === "SCHOOL_ADMIN") {
    const schools = await prisma.school.findMany();
    if (schools.length === 0) {
      await ctx.reply("❌ Tizimda maktablar yo'q. Avval maktab qo'shing.", { reply_markup: adminMenuKeyboard });
      return;
    }
    await ctx.reply("🏫 Maktabni tanlang:", { reply_markup: schoolSelectionKeyboard(schools) });
    const schoolMsg = await conversation.waitForCallbackQuery(/^select_school:/);
    await schoolMsg.answerCallbackQuery();
    session.schoolId = Number(schoolMsg.callbackQuery.data.split(":")[1]);
  } else if (session.role === "NEIGHBORHOOD_ADMIN") {
    const neighborhoods = await prisma.neighborhood.findMany();
    if (neighborhoods.length === 0) {
      await ctx.reply("❌ Tizimda mahallalar yo'q. Avval mahalla qo'shing.", { reply_markup: adminMenuKeyboard });
      return;
    }
    await ctx.reply("🏘️ Mahallani tanlang:", { reply_markup: neighborhoodSelectionKeyboard(neighborhoods) });
    const neighborhoodMsg = await conversation.waitForCallbackQuery(/^select_neighborhood:/);
    await neighborhoodMsg.answerCallbackQuery();
    session.neighborhoodId = Number(neighborhoodMsg.callbackQuery.data.split(":")[1]);
  }

  // Step 5: Ask for responsibilities
  await ctx.reply("🎯 Mas'uliyatlarni tanlang (bir nechta tanlash mumkin):", {
    reply_markup: responsibilitySelectionKeyboard(session.responsibilities),
  });

  let responsibilitySelection = true;
  while (responsibilitySelection) {
    const respMsg = await conversation.waitForCallbackQuery(["toggle_resp:", "save_responsibilities", "cancel:responsibilities"]);
    await respMsg.answerCallbackQuery();

    if (respMsg.callbackQuery.data === "save_responsibilities") {
      responsibilitySelection = false;
    } else if (respMsg.callbackQuery.data === "cancel:responsibilities") {
      await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: adminMenuKeyboard });
      return;
    } else {
      const respKey = respMsg.callbackQuery.data.split(":")[1];
      if (session.responsibilities.has(respKey)) {
        session.responsibilities.delete(respKey);
      } else {
        session.responsibilities.add(respKey);
      }
      await ctx.editMessageReplyMarkup({
        reply_markup: responsibilitySelectionKeyboard(session.responsibilities),
      });
    }
  }

  // Step 6: Preview
  const schoolName = session.schoolId ? (await prisma.school.findUnique({ where: { id: session.schoolId } }))?.name : null;
  const neighborhoodName = session.neighborhoodId ? (await prisma.neighborhood.findUnique({ where: { id: session.neighborhoodId } }))?.name : null;

  let previewText =
    `┌────────────────────────────┐\n` +
    `│ 👤 Yangi admin             │\n` +
    `│                            │\n` +
    `│ ${session.fullName}\n` +
    `│ Telegram ID: ${session.telegramId}\n` +
    `│                            │\n` +
    `│ 🎭 ${session.role}\n`;

  if (schoolName) {
    previewText += `│ 🏫 ${schoolName}\n`;
  }
  if (neighborhoodName) {
    previewText += `│ 🏘️ ${neighborhoodName}\n`;
  }

  if (session.responsibilities.size > 0) {
    previewText += `│                            │\n`;
    session.responsibilities.forEach((resp) => {
      previewText += `│ 🎯 ${resp}\n`;
    });
  }

  previewText +=
    `│                            │\n` +
    `│ 🟢 Faol                    │\n` +
    `└────────────────────────────┘`;

  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Tasdiqlash", "confirm:add_admin")
    .row()
    .text("❌ Bekor qilish", "cancel:add_admin");

  await ctx.reply(previewText, { reply_markup: confirmKeyboard });

  const confirmMsg = await conversation.waitForCallbackQuery(["confirm:add_admin", "cancel:add_admin"]);
  await confirmMsg.answerCallbackQuery();

  if (confirmMsg.callbackQuery.data === "cancel:add_admin") {
    await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // Step 7: Create admin
  try {
    const actorAdminId = ctx.admin?.id;
    const admin = await adminService.createAdmin({
      telegramId: session.telegramId!,
      fullName: session.fullName,
      role: session.role!,
      schoolId: session.schoolId,
      neighborhoodId: session.neighborhoodId,
      responsibilities: Array.from(session.responsibilities),
      actorAdminId,
    });

    await ctx.reply(
      `✅ Admin muvaffaqiyatli yaratildi!\n\n` +
      `👤 ${admin.fullName}\n` +
      `🎭 ${admin.role}\n` +
      `🟢 Faol`,
      { reply_markup: adminMenuKeyboard }
    );
  } catch (error) {
    await ctx.reply(`❌ Xatolik yuz berdi: ${error instanceof Error ? error.message : "Noma'lum xatolik"}`, { reply_markup: adminMenuKeyboard });
  }
}
