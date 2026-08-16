import type { BotContext, BotConversation } from "../../types";
import { studentRepo } from "../../repositories/studentRepo";
import { userRepo } from "../../repositories/userRepo";
import {
  childEditCurrentInfo,
  childEditName,
  childEditClass,
  childEditPreview,
  childEditSaved,
  registrationRemoveKeyboard,
  mainMenu,
} from "../ui/screens";

/**
 * Child Edit conversation.
 *
 * Edits an EXISTING student record (name or class). This is a completely
 * separate flow from `childRegistrationConversation` (which creates a NEW
 * student). The student's id, schoolId, parentId, verificationStatus and
 * createdAt are preserved — only the chosen field (fullName or className)
 * is updated.
 *
 * The studentId is passed in via `ctx.session.studentId`, which is set by
 * the `view_child:<id>` callback handler in app.ts before entering this
 * conversation. This mirrors the existing pattern used by `adminReply`
 * (which passes `complaintId` through `ctx.session.complaintId`).
 *
 * Replay-safety rules (same as parentRegistration.ts):
 *   1. All Bot API calls (ctx.reply, ctx.answerCallbackQuery) are made
 *      DIRECTLY — never wrapped in `conversation.external()`. The
 *      conversations plugin intercepts them via ctx.api.config.use and
 *      records their results in the replay log.
 *   2. `conversation.external()` is used ONLY for database reads/writes
 *      (userRepo.findByTelegramId, studentRepo.findByIdForParent,
 *      studentRepo.updateFullName, studentRepo.updateClassName). These
 *      return real JSON-serializable values, so their external slots
 *      survive the PostgreSQL Json round-trip.
 *   3. `safeEditMessage` is NOT used inside the conversation — its
 *      try/catch fallback (editMessageText → reply) is non-deterministic
 *      and breaks replay.
 *   4. ReplyKeyboard transitions: when the name step shows a ReplyKeyboard
 *      (cancel-only), the next InlineKeyboard screen is preceded by a
 *      `remove_keyboard: true` marker message.
 */
export async function childEditConversation(conversation: BotConversation, ctx: BotContext) {
  // ─── Load the student to edit ────────────────────────────────────────
  // studentId is set by the view_child:<id> callback before entering.
  // NOTE: Do NOT delete ctx.session.studentId here. The grammY conversations
  // plugin snapshots ctx.session at each `wait`/`waitFor` call and restores
  // that snapshot during replay. If we delete studentId before the first
  // wait, the snapshot won't have it, and on the next update the replayed
  // conversation will read studentId = undefined and bail out. The same
  // pattern is used by adminReply (which deletes ctx.session.complaintId
  // only at the very end, after all waits are done). We follow suit and
  // leave studentId in the session — it will be overwritten the next time
  // the user taps a different child.
  const studentId = ctx.session.studentId;
  if (!studentId) {
    await ctx.reply("⚠️ Farzand topilmadi. Iltimos, qaytadan urinib ko'ring.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // Look up the parent User row (we need the numeric id for the
  // privacy-scoped student lookup).
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));
  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // findByIdForParent enforces parent ownership — a user cannot edit someone
  // else's child by guessing an id.
  const student = await conversation.external(() =>
    studentRepo.findByIdForParent(studentId, user.id)
  );

  if (!student) {
    await ctx.reply("⚠️ Farzand topilmadi yoki sizga tegishli emas.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  const schoolName = student.school?.name ?? "Noma'lum";

  // ─── STEP 1: Show current info + edit menu ───────────────────────────
  const infoScreen = childEditCurrentInfo({
    childName: student.fullName,
    className: student.className,
    schoolName,
    verificationStatus: student.verificationStatus,
  });
  await ctx.reply(infoScreen.text, { reply_markup: infoScreen.keyboard });

  let ctxChoice = await conversation.waitForCallbackQuery([
    "edit_child_name",
    "edit_child_class",
    "cancel_edit_child",
  ]);
  await ctxChoice.answerCallbackQuery();

  if (ctxChoice.callbackQuery.data === "cancel_edit_child") {
    await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  const fieldToEdit: "name" | "class" =
    ctxChoice.callbackQuery.data === "edit_child_name" ? "name" : "class";

  // ─── STEP 2: Collect the new value ───────────────────────────────────
  let newValue: string;

  if (fieldToEdit === "name") {
    // Name edit: ReplyKeyboard with cancel-only button, waitFor message:text.
    const nameScreen = childEditName({ currentName: student.fullName });
    await ctx.reply(nameScreen.text, { reply_markup: nameScreen.reply_markup });

    let ctxName = await conversation.waitFor("message:text");
    if (ctxName.message?.text === "❌ Bekor qilish") {
      await ctx.reply("❌ Tahrirlash bekor qilindi.", {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
      return;
    }
    const trimmed = ctxName.message?.text?.trim();
    if (!trimmed || trimmed.length < 3) {
      await ctx.reply("⚠️ Iltimos, to'liq ism-familiyani kiriting.", {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
      return;
    }
    newValue = trimmed;

    // Dismiss the ReplyKeyboard before showing the InlineKeyboard preview.
    await ctx.reply(registrationRemoveKeyboard().text, {
      reply_markup: registrationRemoveKeyboard().reply_markup,
    });
  } else {
    // Class edit: InlineKeyboard grid, waitForCallbackQuery.
    const classScreen = childEditClass({ currentClass: student.className });
    await ctx.reply(classScreen.text, { reply_markup: classScreen.keyboard });

    let ctxClass = await conversation.waitForCallbackQuery(/^select_edit_class:|^cancel_edit_child$/);
    await ctxClass.answerCallbackQuery();
    if (ctxClass.callbackQuery.data === "cancel_edit_child") {
      await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
    newValue = ctxClass.callbackQuery.data.split(":")[1];
  }

  // ─── STEP 3: Preview ─────────────────────────────────────────────────
  const oldValue = fieldToEdit === "name" ? student.fullName : student.className;
  const previewScreen = childEditPreview({
    field: fieldToEdit,
    oldValue,
    newValue,
    childName: student.fullName,
    className: student.className,
    schoolName,
  });
  await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

  let ctxPreview = await conversation.waitForCallbackQuery(["confirm_edit_child", "cancel_edit_child"]);
  await ctxPreview.answerCallbackQuery();

  if (ctxPreview.callbackQuery.data === "cancel_edit_child") {
    await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // ─── STEP 4: Persist the change ──────────────────────────────────────
  // Only the chosen field is updated. id, schoolId, parentId,
  // verificationStatus and createdAt are untouched. No new Student row is
  // created, so no duplicate and no new pending verification is triggered.
  try {
    if (fieldToEdit === "name") {
      await conversation.external(() => studentRepo.updateFullName(student.id, newValue));
    } else {
      await conversation.external(() => studentRepo.updateClassName(student.id, newValue));
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    await ctx.reply(
      `❌ Xatolik yuz berdi: ${errorMessage}\n\nIltimos, qaytadan urinib ko'ring.`,
      { reply_markup: mainMenu().keyboard }
    );
    return;
  }

  // ─── STEP 5: Success ─────────────────────────────────────────────────
  const savedScreen = childEditSaved();
  await ctx.reply(savedScreen.text, { reply_markup: savedScreen.keyboard });
}
