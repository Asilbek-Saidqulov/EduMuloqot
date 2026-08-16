import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { complaintRepo } from "../../repositories/complaintRepo";
import {
  complaintSearchByNumberPrompt,
  complaintDetail,
  registrationRemoveKeyboard,
  mainMenu,
} from "../ui/screens";
import { normalizeComplaintNumber } from "../ui/helpers";
import { InlineKeyboard } from "grammy";

/**
 * Complaint search-by-number conversation (manual text-entry flow).
 *
 * Entered from the "🔍 Raqam bo'yicha qidirish" button on the My Complaints
 * screen. Asks the user to type a complaint number, normalizes it, looks it
 * up scoped to the current parent, and shows the same complaintDetail screen
 * used by the by-id view handler. Reuses the existing complaintDetail screen
 * — does NOT create a second complaint-detail implementation.
 *
 * Replay-safety rules (same as parentRegistration / childEdit / profileEdit):
 *   1. All Bot API calls (ctx.reply, ctx.answerCallbackQuery) are made
 *      DIRECTLY — never wrapped in `conversation.external()`.
 *   2. `conversation.external()` is used ONLY for database reads
 *      (userRepo.findByTelegramId, complaintRepo.findByComplaintNumberForParent).
 *   3. `safeEditMessage` is NOT used inside the conversation — its
 *      try/catch fallback is non-deterministic and breaks replay.
 *   4. ReplyKeyboard transitions: the input prompt shows a ReplyKeyboard
 *      (cancel-only); before showing the InlineKeyboard detail screen, a
 *      `remove_keyboard: true` marker message is sent.
 *
 * The conversation loops on invalid input: if the user enters something
 * that doesn't normalize to a valid complaint number, or the number isn't
 * found / doesn't belong to them, the conversation re-shows the input
 * prompt with an error message and lets them try again. They can cancel at
 * any time via the ReplyKeyboard "❌ Bekor qilish" button.
 */
export async function complaintSearchByNumberConversation(conversation: BotConversation, ctx: BotContext) {
  // ─── Load the current user ───────────────────────────────────────────
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));
  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // ─── Loop: ask for a complaint number until valid or cancelled ───────
  // We loop by re-showing the prompt after an error. Each iteration is a
  // separate `waitFor("message:text")`, so the replay log grows by one
  // wait op per attempt. This is fine — the conversation is short-lived
  // and the user will either find their complaint or cancel.
  // We cap the attempts to avoid an unbounded loop in pathological cases
  // (e.g. a user keeps typing invalid input). 10 is generous.
  for (let attempt = 0; attempt < 10; attempt++) {
    // Show the input prompt with a ReplyKeyboard cancel-only button.
    // On retry (attempt > 0) the prompt is the same; the error message
    // was already sent as a separate reply in the previous iteration.
    const promptScreen = complaintSearchByNumberPrompt();
    await ctx.reply(promptScreen.text, { reply_markup: promptScreen.reply_markup });

    // Wait for the user's text input. Cancel arrives as message:text
    // "❌ Bekor qilish" (ReplyKeyboard button).
    let ctxInput = await conversation.waitFor("message:text");

    if (ctxInput.message?.text === "❌ Bekor qilish") {
      // Dismiss the ReplyKeyboard and return to My Complaints.
      await ctx.reply("❌ Qidirish bekor qilindi.", {
        reply_markup: { remove_keyboard: true },
      });
      // Render the My Complaints list directly (the user came from there).
      const complaints = await conversation.external(() => complaintRepo.listByParent(user.id));
      const { myComplaints } = await import("../ui/screens");
      const screen = myComplaints(
        complaints.map((c) => ({
          id: c.id,
          complaintNumber: c.complaintNumber,
          status: c.status,
          category: c.category,
        }))
      );
      await ctx.reply(screen.text, { reply_markup: screen.keyboard });
      return;
    }

    const rawInput = ctxInput.message?.text ?? "";
    const normalized = normalizeComplaintNumber(rawInput);

    if (!normalized) {
      // Invalid format — tell the user and loop to re-ask.
      // Do NOT send a reply_markup here: the ReplyKeyboard from the prompt
      // is still visible, and sending another reply without a keyboard
      // keeps it visible. The next iteration will re-show the prompt with
      // the keyboard anyway.
      await ctx.reply(
        "⚠️ Noto'g'ri format. Murojaat raqami quyidagi ko'rinishda bo'lishi kerak:\n\n#EDU-000001\n\nQaytadan kiriting yoki ❌ Bekor qilish tugmasini bosing."
      );
      // Continue the loop — the next iteration re-shows the prompt.
      continue;
    }

    // Privacy-scoped lookup by complaint number. senderId is enforced at
    // the DB level — returns null if the complaint doesn't exist OR
    // belongs to another parent. Same not-found message in both cases.
    const complaint = await conversation.external(() =>
      complaintRepo.findByComplaintNumberForParent(normalized, user.id)
    );

    if (!complaint) {
      // Not found / not owned — tell the user and loop to re-ask. Use the
      // same generic message as the direct handler so we don't leak
      // whether the number exists.
      await ctx.reply(
        "⚠️ Murojaat topilmadi yoki sizga tegishli emas.\n\nQaytadan kiriting yoki ❌ Bekor qilish tugmasini bosing."
      );
      continue;
    }

    // Found — dismiss the ReplyKeyboard, then show the detail screen.
    await ctx.reply(registrationRemoveKeyboard().text, {
      reply_markup: registrationRemoveKeyboard().reply_markup,
    });

    const detailScreen = complaintDetail({
      id: complaint.id,
      complaintNumber: complaint.complaintNumber,
      targetType: complaint.targetType,
      schoolName: complaint.school?.name ?? null,
      neighborhoodName: complaint.neighborhood?.name ?? null,
      childName: complaint.student?.fullName ?? null,
      childGrade: complaint.student?.className ?? null,
      category: complaint.category,
      status: complaint.status,
      text: complaint.description,
      createdAt: complaint.createdAt,
      assignedToAdminName: complaint.assignedToAdmin?.fullName ?? null,
    });
    await ctx.reply(detailScreen.text, { reply_markup: detailScreen.keyboard });
    return;
  }

  // Exhausted all 10 attempts — exit gracefully.
  await ctx.reply("🔔 Murojaat raqamini topa olmadingiz. Iltimos, keyinroq urinib ko'ring.", {
    reply_markup: { remove_keyboard: true },
  });
  // Offer a way back.
  const backKb = new InlineKeyboard()
    .text("◀️ Murojaatlarim", "my_complaints")
    .row()
    .text("🏠 Bosh sahifa", "home");
  await ctx.reply("Quyidagi menyudan tanlang:", { reply_markup: backKb });
}
