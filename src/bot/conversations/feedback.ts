import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { prisma } from "../../database/prisma";
import { mainMenu } from "../ui/screens";
import { InlineKeyboard } from "grammy";
import type { Bot } from "grammy";

let botRef: Bot<BotContext> | undefined;
export function setFeedbackBotRef(bot: Bot<BotContext>) {
  botRef = bot;
}

/**
 * /fikr command — feedback / bug report / feature request.
 *
 * Lets any user send a message to SUPER_ADMIN. The feedback is stored
 * in the DB (StaffActionLog with action="USER_FEEDBACK") and a
 * notification is sent to all active SUPER_ADMIN users.
 *
 * This closes the communication loop — users don't need a separate
 * channel to report bugs or request features.
 *
 * Flow:
 *   /fikr → "Iltimos, fikringizni yozing:" → user types message →
 *   confirmation → SUPER_ADMINs receive notification
 */
export async function feedbackConversation(conversation: BotConversation, ctx: BotContext) {
  if (!ctx.from) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.");
    return;
  }

  const telegramId = BigInt(ctx.from.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));

  if (!user) {
    await ctx.reply("⚠️ Siz hali ro'yxatdan o'tmagansiz. /start ni bosing.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // Ask for feedback
  await ctx.reply(
    "💡 Fikr bildirish\n\n" +
    "Iltimos, fikringizni, taklifingizni yoki xato haqidagi xabarini yozing:\n\n" +
    "(Bekor qilish uchun \"❌ Bekor qilish\" tugmasini bosing)",
    {
      reply_markup: new InlineKeyboard().text("❌ Bekor qilish", "cancel_feedback"),
    }
  );

  // Wait for text or cancel
  let ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);

  if (ctxInput.callbackQuery?.data === "cancel_feedback") {
    await ctxInput.answerCallbackQuery();
    await ctx.reply("❌ Fikr bildirish bekor qilindi.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // Ignore stale callbacks
  if (ctxInput.callbackQuery) {
    await ctxInput.answerCallbackQuery();
    return;
  }

  const feedbackText = ctxInput.message?.text?.trim();
  if (!feedbackText || feedbackText.length < 3) {
    await ctx.reply("⚠️ Fikr juda qisqa. Iltimos, batafsilroq yozing.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  if (feedbackText.length > 2000) {
    await ctx.reply("⚠️ Fikr 2000 belgidan oshmasligi kerak.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // Store the feedback in StaffActionLog (reusing the existing audit table
  // to avoid adding a new model). We use action="USER_FEEDBACK" and put
  // the feedback text in the `details` field.
  try {
    await conversation.external(() =>
      (prisma as any).staffActionLog.create({
        data: {
          actorUserId: user.id,
          targetUserId: user.id, // self
          action: "USER_FEEDBACK",
          details: JSON.stringify({
            feedback: feedbackText,
            userFullName: user.fullName,
            userRole: user.role,
            telegramId: telegramId.toString(),
          }),
        },
      })
    );
  } catch (err) {
    console.error("Failed to store feedback:", (err as Error).message);
  }

  // Notify all active SUPER_ADMIN users
  try {
    const superAdmins = await conversation.external(() =>
      prisma.user.findMany({
        where: { role: "SUPER_ADMIN", isActive: true },
        select: { telegramId: true },
      })
    );

    if (botRef && superAdmins.length > 0) {
      const userName = user.fullName || "Noma'lum";
      const userRoleLabel: Record<string, string> = {
        PARENT: "Ota-ona",
        STUDENT: "O'quvchi",
        TEACHER: "O'qituvchi",
        SCHOOL_ADMIN: "Maktab admini",
      };
      const roleLabel = userRoleLabel[user.role] || user.role;

      const notificationText =
        `💡 Yangi fikr/taklif\n\n` +
        `👤 Kimdan: ${userName} (${roleLabel})\n` +
        `🆔 Telegram ID: ${telegramId}\n\n` +
        `📝 Fikr:\n${feedbackText}`;

      for (const sa of superAdmins) {
        try {
          await botRef.api.sendMessage(sa.telegramId.toString(), notificationText);
        } catch (err) {
          // Phase 9: Mask telegramId in logs
          const { maskTelegramId } = require("../../utils/piiRedact");
          console.error(`Failed to notify SUPER_ADMIN (user=${maskTelegramId(sa.telegramId)}):`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error("Failed to notify super admins:", (err as Error).message);
  }

  // Confirm to the user
  await ctx.reply(
    "✅ Fikringiz qabul qilindi!\n\n" +
    "Rahmat — SUPER_ADMIN sizning fikringizni ko'rib chiqadi.",
    { reply_markup: mainMenu().keyboard }
  );
}
