import { Keyboard } from "grammy";
import type { BotContext, BotConversation } from "../../types";
import { CATEGORIES_NEIGHBORHOOD } from "../../types";
import { neighborhoodRepo } from "../../repositories/neighborhoodRepo";
import { userRepo } from "../../repositories/userRepo";
import { complaintService } from "../../services/complaintService";
import { cancelOnlyKeyboard, mainMenuKeyboard } from "../keyboards/mainMenu";
import { neighborhoodCategoryKeyboard } from "../keyboards/categories";

const CANCEL_TEXTS = ["❌ Bekor qilish"];

async function isCancelled(ctx: BotContext): Promise<boolean> {
  const text = ctx.message?.text;
  if (text && CANCEL_TEXTS.includes(text)) {
    await ctx.reply("Bekor qilindi.", { reply_markup: mainMenuKeyboard });
    return true;
  }
  return false;
}

export async function neighborhoodComplaintConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() =>
    userRepo.findOrCreateByTelegramId(telegramId, ctx.from?.first_name)
  );

  // 1. Mahallani tanlash
  const neighborhoods = await conversation.external(() => neighborhoodRepo.listAll());
  if (neighborhoods.length === 0) {
    await ctx.reply("Hozircha tizimda mahallalar ro'yxati yo'q. Keyinroq urinib ko'ring.", {
      reply_markup: mainMenuKeyboard,
    });
    return;
  }
  const kb = new Keyboard();
  neighborhoods.forEach((n, i) => {
    kb.text(n.name);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("❌ Bekor qilish");

  await ctx.reply("Mahallangizni tanlang:", { reply_markup: kb.resized() });
  let ctx2 = await conversation.wait();
  if (await isCancelled(ctx2)) return;
  const chosen = neighborhoods.find((n) => n.name === ctx2.message?.text);
  if (!chosen) {
    await ctx.reply("Iltimos, ro'yxatdan mahallani tanlang.");
    return;
  }

  // 2. Kategoriya
  await ctx.reply("Murojaat kategoriyasini tanlang:", { reply_markup: neighborhoodCategoryKeyboard });
  ctx2 = await conversation.wait();
  if (await isCancelled(ctx2)) return;
  const category = CATEGORIES_NEIGHBORHOOD.find((c) => c === ctx2.message?.text);
  if (!category) {
    await ctx.reply("Iltimos, ro'yxatdan kategoriyani tanlang.");
    return;
  }

  // 3. Matn
  await ctx.reply("Murojaat matnini yozing:", { reply_markup: cancelOnlyKeyboard });
  ctx2 = await conversation.wait();
  if (await isCancelled(ctx2)) return;
  const description = ctx2.message?.text?.trim();
  if (!description) {
    await ctx.reply("Iltimos, matn ko'rinishida murojaat yozing.");
    return;
  }

  // 4. Ixtiyoriy fayl
  const attachments: { fileId: string; fileType: string }[] = [];
  const skipKb = new Keyboard().text("⏭ Faylsiz davom etish").text("❌ Bekor qilish").resized();
  await ctx.reply("Xohlasangiz rasm yoki fayl yuboring, aks holda 'Faylsiz davom etish' tugmasini bosing:", {
    reply_markup: skipKb,
  });
  ctx2 = await conversation.wait();
  if (await isCancelled(ctx2)) return;
  if (ctx2.message?.photo) {
    const photo = ctx2.message.photo[ctx2.message.photo.length - 1];
    attachments.push({ fileId: photo.file_id, fileType: "photo" });
  } else if (ctx2.message?.document) {
    attachments.push({ fileId: ctx2.message.document.file_id, fileType: "document" });
  }

  // 5. Preview
  const previewText =
    `Murojaatingizni tekshiring:\n\n` +
    `Mahalla: ${chosen.name}\n` +
    `Kategoriya: ${category}\n` +
    `Matn: ${description}\n` +
    `Fayl: ${attachments.length > 0 ? "biriktirilgan" : "yo'q"}\n\n` +
    `Yuborishni tasdiqlaysizmi?`;
  const confirmKb = new Keyboard().text("✅ Tasdiqlash").text("❌ Bekor qilish").resized();
  await ctx.reply(previewText, { reply_markup: confirmKb });
  ctx2 = await conversation.wait();
  if (await isCancelled(ctx2)) return;
  if (ctx2.message?.text !== "✅ Tasdiqlash") {
    await ctx.reply("Murojaat yuborilmadi.", { reply_markup: mainMenuKeyboard });
    return;
  }

  // 6. Saqlash + notification
  const complaint = await conversation.external(() =>
    complaintService.submitNeighborhoodComplaint({
      senderId: user.id,
      neighborhoodId: chosen.id,
      category,
      description,
      attachments,
    })
  );

  await ctx.reply(`Murojaatingiz qabul qilindi. Murojaat ID: ${complaint.complaintNumber}`, {
    reply_markup: mainMenuKeyboard,
  });
}
