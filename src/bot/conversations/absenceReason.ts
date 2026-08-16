/**
 * Phase 10: Absence reason conversation.
 *
 * When a parent taps "📝 Sababini bildirish" on the absence notification,
 * this conversation asks for the reason and stores it on the Attendance record.
 * The reason is visible ONLY to the CLASS_TEACHER (not the subject teacher).
 */
import type { BotContext, BotConversation } from "../../types";
import { attendanceService } from "../../services/attendanceService";
import { mainMenu } from "../ui/screens";
import { InlineKeyboard } from "grammy";

export async function absenceReasonConversation(conversation: BotConversation, ctx: BotContext) {
  const attendanceId = ctx.session.complaintId; // reused session field
  if (!attendanceId) {
    await ctx.reply("⚠️ Davomat yozuvi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  await ctx.reply(
    "📝 Sababini yozing:\n\n" +
    "(Masalan: kasal, oilaviy ish, transport muammosi)",
    { reply_markup: new InlineKeyboard().text("❌ Bekor qilish", "cancel_reason") }
  );

  let ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);

  if (ctxInput.callbackQuery?.data === "cancel_reason") {
    await ctxInput.answerCallbackQuery();
    await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  if (ctxInput.callbackQuery) {
    await ctxInput.answerCallbackQuery();
    return;
  }

  const reason = ctxInput.message?.text?.trim();
  if (!reason || reason.length < 3) {
    await ctx.reply("⚠️ Sabab kamida 3 ta belgidan iborat bo'lishi kerak.", { reply_markup: mainMenu().keyboard });
    return;
  }

  const success = await conversation.external(() =>
    attendanceService.submitAbsenceReason({ attendanceId, reason })
  );

  if (success) {
    await ctx.reply(
      "✅ Sababingiz qabul qilindi.\n\n" +
      "Sinf rahbari ko'rib chiqadi.",
      { reply_markup: mainMenu().keyboard }
    );
  } else {
    await ctx.reply("⚠️ Davomat yozuvi topilmadi yoki sabab yuborib bo'lmadi.", { reply_markup: mainMenu().keyboard });
  }

  // Clear the reused session field
  ctx.session.complaintId = undefined;
}
