import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { studentRepo } from "../../repositories/studentRepo";
import { complaintService } from "../../services/complaintService";
import { prisma } from "../../database/prisma";
import {
  schoolComplaintStep1,
  schoolComplaintStep2,
  schoolComplaintStep3,
  schoolComplaintStep4,
  schoolComplaintStep5,
  schoolComplaintPreview,
  submissionLoading,
  submissionSuccess,
  mainMenu,
} from "../ui/screens";

/**
 * School complaint conversation.
 *
 * H1 fix: replay-safe architecture (same as parentRegistration / profileEdit /
 * childEdit / complaintSearchByNumber). All Telegram API calls are made
 * DIRECTLY via `ctx.reply` — never wrapped in `conversation.external()`.
 * `conversation.external()` is used ONLY for database calls. `safeEditMessage`
 * is NOT used inside the conversation — its try/catch fallback
 * (editMessageText → reply) is non-deterministic and breaks replay.
 *
 * The conversation uses `ctx.reply` (sends a new message) instead of
 * `ctx.editMessageText` (edits the previous message). This is intentional —
 * editing inside a conversation is non-deterministic because the message
 * being edited may not exist on replay (e.g. if the bot was restarted).
 * Sending a new message is always safe and replayable.
 */
export async function schoolComplaintConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  // H3 fix: use findByTelegramId (not findOrCreateByTelegramId) to avoid
  // overwriting the parent's custom fullName. The user should already exist
  // (the startNewComplaint handler checks this before entering).
  let user = await conversation.external(() => userRepo.findByTelegramId(telegramId));
  if (!user) {
    // Fallback: create the user if they don't exist (shouldn't happen in
    // normal flow, but defensive).
    user = await conversation.external(() =>
      userRepo.findOrCreateByTelegramId(telegramId, ctx.from?.first_name)
    );
  }

  // Get parent's verified students
  const students = await conversation.external(() => studentRepo.listByParent(user.id));
  const verifiedStudents = students.filter((s) => s.verificationStatus === "VERIFIED");

  if (verifiedStudents.length === 0) {
    await ctx.reply(
      "⏳ Farzandingiz hali maktab tomonidan tasdiqlanmagan.\n\nTasdiqlangandan so'ng murojaat yuborishingiz mumkin.",
      { reply_markup: mainMenu().keyboard }
    );
    return;
  }

  // Session state
  const state: {
    schoolId?: number;
    schoolName?: string;
    studentId?: number;
    studentName?: string;
    studentGrade?: string;
    category?: string;
    description?: string;
    fileId?: string;
    fileType?: string;
  } = {};

  // STEP 1: Select school
  const schools = await conversation.external(() => prisma.school.findMany());
  const step1Screen = schoolComplaintStep1(schools);
  await ctx.reply(step1Screen.text, { reply_markup: step1Screen.keyboard });

  let ctxStep1 = await conversation.waitForCallbackQuery(/^select_school:\d+$/);
  await ctxStep1.answerCallbackQuery();
  state.schoolId = Number(ctxStep1.callbackQuery.data.split(":")[1]);
  state.schoolName = schools.find((s) => s.id === state.schoolId)?.name;

  // Phase 9 Security Fix: Filter verified students to ONLY those at the
  // selected school. This prevents cross-school complaint submission —
  // a parent at School A cannot attach their child to a complaint
  // targeting School B.
  const schoolScopedStudents = verifiedStudents.filter(
    (s) => s.schoolId === state.schoolId
  );

  if (schoolScopedStudents.length === 0) {
    await ctx.reply(
      "⚠️ Sizda ushbu maktabda tasdiqlangan farzand yo'q.\n\n" +
      "Faqat o'z farzandingiz maktabiga murojaat yuborishingiz mumkin.",
      { reply_markup: mainMenu().keyboard }
    );
    return;
  }

  // STEP 2: Select student (only students at the selected school)
  const step2Screen = schoolComplaintStep2(
    schoolScopedStudents.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      grade: s.className,
    }))
  );
  await ctx.reply(step2Screen.text, { reply_markup: step2Screen.keyboard });

  let ctxStep2 = await conversation.waitForCallbackQuery(/^select_child:\d+$/);
  await ctxStep2.answerCallbackQuery();
  state.studentId = Number(ctxStep2.callbackQuery.data.split(":")[1]);
  const chosenStudent = schoolScopedStudents.find((s) => s.id === state.studentId);
  // Phase 9 Security Fix: verify the chosen student belongs to the
  // selected school (defense-in-depth against callback manipulation).
  if (!chosenStudent || chosenStudent.schoolId !== state.schoolId) {
    await ctx.reply("⚠️ Noto'g'ri tanlov. Farzandingiz ushbu maktabda topilmadi.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }
  state.studentName = chosenStudent?.fullName;
  state.studentGrade = chosenStudent?.className;

  // STEP 3: Select category
  const step3Screen = schoolComplaintStep3();
  await ctx.reply(step3Screen.text, { reply_markup: step3Screen.keyboard });

  let ctxStep3 = await conversation.waitForCallbackQuery(/^select_category:\w+$/);
  await ctxStep3.answerCallbackQuery();
  state.category = ctxStep3.callbackQuery.data.split(":")[1];

  // STEP 4: Enter description
  const step4Screen = schoolComplaintStep4();
  await ctx.reply(step4Screen.text, { reply_markup: step4Screen.keyboard });

  let ctxStep4 = await conversation.waitFor("message:text");
  state.description = ctxStep4.message.text.trim();

  if (!state.description) {
    await ctx.reply("⚠️ Iltimos, matn ko'rinishida murojaat yozing.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // STEP 5: Optional attachment
  const step5Screen = schoolComplaintStep5();
  await ctx.reply(step5Screen.text, { reply_markup: step5Screen.keyboard });

  let ctxStep5 = await conversation.waitFor(["message:photo", "message:document", "callback_query"]);

  if (ctxStep5.callbackQuery?.data === "skip_file") {
    // Skip file
  } else if (ctxStep5.message?.photo) {
    const photo = ctxStep5.message.photo[ctxStep5.message.photo.length - 1];
    state.fileId = photo.file_id;
    state.fileType = "photo";
  } else if (ctxStep5.message?.document) {
    state.fileId = ctxStep5.message.document.file_id;
    state.fileType = "document";
  } else if (ctxStep5.callbackQuery?.data === "cancel_complaint") {
    await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  } else if (ctxStep5.callbackQuery?.data === "step4") {
    // Go back to step 4
    const step4ScreenAgain = schoolComplaintStep4();
    await ctx.reply(step4ScreenAgain.text, { reply_markup: step4ScreenAgain.keyboard });
    ctxStep4 = await conversation.waitFor("message:text");
    state.description = ctxStep4.message.text.trim();
    if (!state.description) {
      await ctx.reply("⚠️ Iltimos, matn ko'rinishida murojaat yozing.", {
        reply_markup: mainMenu().keyboard,
      });
      return;
    }
    // Re-show step 5
    const step5ScreenAgain = schoolComplaintStep5();
    await ctx.reply(step5ScreenAgain.text, { reply_markup: step5ScreenAgain.keyboard });
    ctxStep5 = await conversation.waitFor(["message:photo", "message:document", "callback_query"]);
    if (ctxStep5.callbackQuery?.data === "skip_file") {
      // Skip file
    } else if (ctxStep5.message?.photo) {
      const photo = ctxStep5.message.photo[ctxStep5.message.photo.length - 1];
      state.fileId = photo.file_id;
      state.fileType = "photo";
    } else if (ctxStep5.message?.document) {
      state.fileId = ctxStep5.message.document.file_id;
      state.fileType = "document";
    }
  }

  // STEP 6: Preview
  const previewScreen = schoolComplaintPreview({
    schoolName: state.schoolName || "",
    childName: state.studentName || "",
    childGrade: state.studentGrade || "",
    category: state.category || "",
    text: state.description || "",
    hasFile: !!state.fileId,
  });
  await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

  let ctxPreview = await conversation.waitForCallbackQuery(/^submit_complaint|^edit_\w+|^cancel_complaint$/);
  await ctxPreview.answerCallbackQuery();

  if (ctxPreview.callbackQuery.data === "cancel_complaint") {
    await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Handle edit buttons — each re-shows the relevant step, then re-shows the preview
  if (ctxPreview.callbackQuery.data === "edit_school") {
    const step1ScreenAgain = schoolComplaintStep1(schools);
    await ctx.reply(step1ScreenAgain.text, { reply_markup: step1ScreenAgain.keyboard });
    ctxStep1 = await conversation.waitForCallbackQuery(/^select_school:\d+$/);
    await ctxStep1.answerCallbackQuery();
    state.schoolId = Number(ctxStep1.callbackQuery.data.split(":")[1]);
    state.schoolName = schools.find((s) => s.id === state.schoolId)?.name;
  } else if (ctxPreview.callbackQuery.data === "edit_child") {
    // Bug Fix: use schoolScopedStudents (filtered by selected school)
    // instead of verifiedStudents (all schools) — prevents cross-school
    // complaint submission via edit_child path.
    const step2ScreenAgain = schoolComplaintStep2(
      schoolScopedStudents.map((s) => ({ id: s.id, fullName: s.fullName, grade: s.className }))
    );
    await ctx.reply(step2ScreenAgain.text, { reply_markup: step2ScreenAgain.keyboard });
    ctxStep2 = await conversation.waitForCallbackQuery(/^select_child:\d+$/);
    await ctxStep2.answerCallbackQuery();
    state.studentId = Number(ctxStep2.callbackQuery.data.split(":")[1]);
    const chosenStudentAgain = schoolScopedStudents.find((s) => s.id === state.studentId);
    // Defense-in-depth: verify the student belongs to the selected school
    if (!chosenStudentAgain || chosenStudentAgain.schoolId !== state.schoolId) {
      await ctx.reply("⚠️ Noto'g'ri tanlov. Farzandingiz ushbu maktabda topilmadi.", {
        reply_markup: mainMenu().keyboard,
      });
      return;
    }
    state.studentName = chosenStudentAgain?.fullName;
    state.studentGrade = chosenStudentAgain?.className;
  } else if (ctxPreview.callbackQuery.data === "edit_category") {
    const step3ScreenAgain = schoolComplaintStep3();
    await ctx.reply(step3ScreenAgain.text, { reply_markup: step3ScreenAgain.keyboard });
    ctxStep3 = await conversation.waitForCallbackQuery(/^select_category:\w+$/);
    await ctxStep3.answerCallbackQuery();
    state.category = ctxStep3.callbackQuery.data.split(":")[1];
  } else if (ctxPreview.callbackQuery.data === "edit_text") {
    const step4ScreenAgain = schoolComplaintStep4();
    await ctx.reply(step4ScreenAgain.text, { reply_markup: step4ScreenAgain.keyboard });
    ctxStep4 = await conversation.waitFor("message:text");
    state.description = ctxStep4.message.text.trim();
    if (!state.description) {
      await ctx.reply("⚠️ Iltimos, matn ko'rinishida murojaat yozing.", {
        reply_markup: mainMenu().keyboard,
      });
      return;
    }
  }

  // If an edit was performed, re-show the preview and wait for submit/cancel
  if (ctxPreview.callbackQuery.data.startsWith("edit_")) {
    const previewScreenAgain = schoolComplaintPreview({
      schoolName: state.schoolName || "",
      childName: state.studentName || "",
      childGrade: state.studentGrade || "",
      category: state.category || "",
      text: state.description || "",
      hasFile: !!state.fileId,
    });
    await ctx.reply(previewScreenAgain.text, { reply_markup: previewScreenAgain.keyboard });
    ctxPreview = await conversation.waitForCallbackQuery(/^submit_complaint|^edit_\w+|^cancel_complaint$/);
    await ctxPreview.answerCallbackQuery();
    if (ctxPreview.callbackQuery.data !== "submit_complaint") {
      await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
  }

  // STEP 7: Loading
  const loadingScreen = submissionLoading();
  await ctx.reply(loadingScreen.text, { reply_markup: loadingScreen.keyboard });

  // STEP 8: Submit
  const attachments: { fileId: string; fileType: string }[] = [];
  if (state.fileId && state.fileType) {
    attachments.push({ fileId: state.fileId, fileType: state.fileType });
  }

  const complaint = await conversation.external(() =>
    complaintService.submitSchoolComplaint({
      senderId: user.id,
      schoolId: state.schoolId!,
      studentId: state.studentId!,
      category: state.category!,
      description: state.description!,
      attachments,
    })
  );

  // STEP 9: Success
  const successScreen = submissionSuccess(complaint.complaintNumber, state.schoolName || "");
  await ctx.reply(successScreen.text, { reply_markup: successScreen.keyboard });
}
