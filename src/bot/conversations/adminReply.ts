import type { BotContext, BotConversation } from "../../types";
import { complaintService } from "../../services/complaintService";
import { adminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * Admin reply conversation.
 *
 * The `complaintId` is passed via `ctx.session.complaintId` (set by the
 * `reply:<id>` callback in app.ts before entering). The admin identity
 * comes from `ctx.admin` (set by the `authAdmin` middleware before the
 * callback handler runs, and preserved in the conversation's context
 * snapshot).
 *
 * Sender model:
 *   The admin's reply is stored via `complaintService.reply(complaintId,
 *   ctx.admin.id, message)`, which calls `complaintRepo.addAdminMessage`.
 *   The message is stored with senderType=ADMIN and senderAdminId=<Admin.id>.
 *   This replaces the old buggy flow that used
 *   `userRepo.findOrCreateByTelegramId(ctx.from.id)` to obtain a User.id
 *   for the admin — which caused identity collisions when an admin's
 *   Telegram ID matched a parent's.
 *
 * Replay-safety:
 *   - `ctx.session.complaintId` is read at the top (before any wait) —
 *     this is safe per the adminReply pattern (the value is in the session
 *     snapshot). We do NOT delete it until the end (same pattern).
 *   - `ctx.admin.id` is read at the top — `ctx.admin` is set by the
 *     `authAdmin` middleware before the conversation is entered, so it's
 *     part of the initial context snapshot and survives replays.
 *   - `conversation.external()` is used for the DB write (complaintService.reply).
 *   - `ctx.reply` is called directly (no external wrapper).
 */
export async function adminReplyConversation(
  conversation: BotConversation,
  ctx: BotContext
) {
  const complaintId = ctx.session.complaintId;
  if (!complaintId) {
    await ctx.reply("Xatolik: complaintId topilmadi.", { reply_markup: adminMenuKeyboard });
    return;
  }

  // The admin identity comes from the authenticated admin context, NOT
  // from userRepo.findOrCreateByTelegramId. ctx.admin is set by the
  // authAdmin middleware before the conversation is entered, and is
  // preserved in the conversation's context snapshot.
  if (!ctx.admin) {
    await ctx.reply("Xatolik: admin ma'lumotlari topilmadi.", { reply_markup: adminMenuKeyboard });
    return;
  }
  const adminId = ctx.admin.id;

  await ctx.reply("Javobingizni yozing:");
  const replyCtx = await conversation.wait();
  const message = replyCtx.message?.text?.trim();

  if (!message) {
    await ctx.reply("Javob matn ko'rinishida bo'lishi kerak. Bekor qilindi.", {
      reply_markup: adminMenuKeyboard,
    });
    return;
  }

  // Store the reply with senderType=ADMIN, senderAdminId=adminId.
  // complaintService.reply calls complaintRepo.addAdminMessage internally.
  await conversation.external(() => complaintService.reply(complaintId, adminId, message));

  await ctx.reply("Javobingiz ota-onaga yuborildi.", { reply_markup: adminMenuKeyboard });

  // Clean up session
  delete ctx.session.complaintId;
}
