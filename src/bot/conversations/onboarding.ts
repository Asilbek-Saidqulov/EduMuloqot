import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { prisma } from "../../database/prisma";
import { studentApplicationRepo } from "../../repositories/studentApplicationRepo";
import { matchStudentName } from "../../utils/studentNameMatcher";
import {
  onboardingParentRole,
  onboardingStudentName,
  onboardingStudentSchool,
  onboardingStudentComplete,
  registrationStep1Phone,
  registrationStep1Name,
  registrationStep2School,
  registrationStep3Neighborhood,
  registrationPreview,
  registrationRemoveKeyboard,
  registrationCompleteAskChild,
  onboardingStudentComplete as studentComplete,
  mainMenu,
} from "../ui/screens";
import { InlineKeyboard } from "grammy";

/**
 * Phase 2: Onboarding conversation.
 *
 * Handles both parent and student registration paths.
 *
 * Parent flow:
 *   Role selection → Father/Mother → Phone → Name → School → Neighborhood → Preview → Confirm
 *
 * Student flow:
 *   Role selection → Name → School → Complete
 *
 * Security:
 *   - Staff roles are NEVER selectable. Only PARENT and STUDENT can be
 *     set through this conversation.
 *   - School IDs from callback data are validated against the DB.
 *   - The user's existing role is protected: if they already have a staff
 *     role, the conversation exits immediately.
 *   - Phone contact is verified: contact.user_id must match ctx.from.id.
 *
 * Replay-safety: direct ctx.reply, conversation.external for DB calls.
 */
export async function onboardingConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));

  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi. Iltimos, /start ni qayta bosing.");
    return;
  }

  // Staff protection: never overwrite a staff role through onboarding
  if (userRepo.isStaffUser(user)) {
    const screen = mainMenu();
    await ctx.reply("✅ Siz allaqachon ro'yxatdan o'tgansiz.", { reply_markup: screen.keyboard });
    return;
  }

  // ─── STEP 0: Role selection (Student or Parent) ────────────────────
  // The welcome screen is shown by /start. Here we wait for the user's
  // role selection callback.
  let ctxRole = await conversation.waitForCallbackQuery([
    "onboard_student",
    "onboard_parent",
    "cancel_onboarding",
  ]);
  await ctxRole.answerCallbackQuery();

  if (ctxRole.callbackQuery.data === "cancel_onboarding") {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  const isStudent = ctxRole.callbackQuery.data === "onboard_student";
  const isParent = ctxRole.callbackQuery.data === "onboard_parent";

  // ═══ STUDENT PATH ═══════════════════════════════════════════════════
  if (isStudent) {
    return await studentOnboarding(conversation, ctx, user.id);
  }

  // ═══ PARENT PATH ════════════════════════════════════════════════════
  if (isParent) {
    // Step 0a: Ask father/mother
    const roleScreen = onboardingParentRole();
    await ctx.reply(roleScreen.text, { reply_markup: roleScreen.keyboard });

    let ctxParentRole = await conversation.waitForCallbackQuery([
      "onboard_parent_father",
      "onboard_parent_mother",
      "onboard_back",
    ]);
    await ctxParentRole.answerCallbackQuery();

    if (ctxParentRole.callbackQuery.data === "onboard_back") {
      // Back to role selection — restart
      const { welcomeScreen } = await import("../ui/screens");
      await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
      return;
    }

    const parentRole: "FATHER" | "MOTHER" =
      ctxParentRole.callbackQuery.data === "onboard_parent_father" ? "FATHER" : "MOTHER";
    const parentRoleLabel = parentRole === "FATHER" ? "👨 Ota" : "👩 Ona";

    return await parentOnboarding(conversation, ctx, user.id, parentRole, parentRoleLabel);
  }
}

/**
 * Student onboarding: name → school → search DB → auto-link or application.
 *
 * Phase 5+ flow:
 * 1. Student enters their full name
 * 2. Student selects their school
 * 3. Bot searches the students DB for that name at that school
 *    (fuzzy matching with confidence scoring)
 * 4. If HIGH-confidence match found → auto-link User to Student
 *    (set User.role = STUDENT, User.schoolId, and link via session.studentId)
 * 5. If no match or low confidence → offer "Maktab adminiga ariza yuborish"
 *    (submit application to school admin)
 *
 * The auto-link is secure because:
 *   - The student must already be in the DB (pre-validated via Excel import)
 *   - The search is scoped to the selected school
 *   - The match must be HIGH confidence (exact or near-exact name)
 *   - The User's role is only set to STUDENT (never to staff roles)
 */
async function studentOnboarding(
  conversation: BotConversation,
  ctx: BotContext,
  userId: number
) {
  // Step 1: Student name
  const nameScreen = onboardingStudentName();
  await ctx.reply(nameScreen.text, { reply_markup: nameScreen.keyboard });

  let ctxName = await conversation.waitFor(["message:text", "callback_query:data"]);
  if (ctxName.callbackQuery?.data === "cancel_onboarding") {
    await ctxName.answerCallbackQuery();
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
    return;
  }
  // Ignore stale callbacks
  if (ctxName.callbackQuery) {
    await ctxName.answerCallbackQuery();
    const screen = onboardingStudentName();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    ctxName = await conversation.waitFor(["message:text", "callback_query:data"]);
    if (ctxName.callbackQuery) {
      await ctxName.answerCallbackQuery();
      const { welcomeScreen } = await import("../ui/screens");
      await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
      return;
    }
  }

  const fullName = ctxName.message?.text?.trim();
  if (!fullName || fullName.length < 3) {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("⚠️ Iltimos, to'liq ism-familiyangizni kiriting.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  // Step 2: School selection
  const schools = await conversation.external(() => prisma.school.findMany());
  if (schools.length === 0) {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("⚠️ Tizimda maktablar yo'q. Administrator bilan bog'laning.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  const schoolScreen = onboardingStudentSchool(schools);
  await ctx.reply(schoolScreen.text, { reply_markup: schoolScreen.keyboard });

  let ctxSchool = await conversation.waitForCallbackQuery([
    /^onboard_select_school:\d+$/,
    "cancel_onboarding",
  ]);
  await ctxSchool.answerCallbackQuery();

  if (ctxSchool.callbackQuery.data === "cancel_onboarding") {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  const selectedSchoolId = Number(ctxSchool.callbackQuery.data.split(":")[1]);

  // Validate school exists in DB (defense-in-depth)
  const school = schools.find((s) => s.id === selectedSchoolId);
  if (!school) {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("⚠️ Noto'g'ri maktab tanlandi.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  // Step 3: Search the students DB for this name at this school
  // Use the existing studentNameMatcher for fuzzy matching
  const searchTokens = fullName.split(/\s+/).filter((t) => t.length > 1);
  const candidates = await conversation.external(async () => {
    const dbCandidates = await prisma.student.findMany({
      where: {
        schoolId: selectedSchoolId,
        OR: searchTokens.map((t) => ({
          fullName: { contains: t, mode: "insensitive" as const },
        })),
      },
      select: {
        id: true, fullName: true, className: true,
        schoolId: true, parentId: true,
      },
      take: 20,
    });
    // Score each candidate using the name matcher
    const scored = dbCandidates.map((c) => {
      const result = matchStudentName(fullName, c.fullName);
      return { ...c, confidence: result.confidence, score: result.score };
    });
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored;
  });

  const highConfidence = candidates.filter((c: any) => c.confidence === "HIGH");

  if (highConfidence.length >= 1) {
    // Auto-link: found a high-confidence match
    const match = highConfidence[0];

    // Show the match and ask for confirmation
    const confirmKb = new InlineKeyboard()
      .text("✅ Ha, men shu o'quvchiman", "confirm_student_match")
      .row()
      .text("❌ Yo'q, boshqa", "reject_student_match");
    await ctx.reply(
      `📋 Sizni topdim:\n\n` +
      `👤 Ism: ${match.fullName}\n` +
      `🏫 Sinf: ${match.className}\n` +
      `🏫 Maktab: ${school.name}\n\n` +
      `Bu sizmisiz?`,
      { reply_markup: confirmKb }
    );

    let ctxConfirm = await conversation.waitForCallbackQuery([
      "confirm_student_match",
      "reject_student_match",
      "cancel_onboarding",
    ]);
    await ctxConfirm.answerCallbackQuery();

    if (ctxConfirm.callbackQuery.data === "confirm_student_match") {
      // Auto-link the User to this Student
      try {
        await conversation.external(() =>
          userRepo.updateStudentProfile(userId, {
            fullName: match.fullName,
            schoolId: selectedSchoolId,
          })
        );
        // Bug Fix #2: Link the Student record to this User by setting
        // Student.parentId = userId. This is the only User↔Student link
        // in the current schema. Without it, getOwnAttendanceForStudent
        // and getStudentReport can't verify the student belongs to the
        // requesting user, and the student can never view their attendance.
        // The parentId field is used here as "owner user id" — for
        // self-registering students, the student IS their own owner.
        await conversation.external(() =>
          prisma.student.update({
            where: { id: match.id },
            data: { parentId: userId, verificationStatus: "VERIFIED" },
          })
        );
        // Stash the studentId in session so the student can view their
        // own attendance later
        ctx.session.studentId = match.id;
      } catch (error) {
        const { welcomeScreen } = await import("../ui/screens");
        await ctx.reply(
          `❌ Xatolik yuz berdi: ${(error as Error).message}`,
          { reply_markup: welcomeScreen().keyboard }
        );
        return;
      }

      const completeScreen = onboardingStudentComplete();
      await ctx.reply(completeScreen.text, { reply_markup: completeScreen.keyboard });
      return;
    } else {
      // User rejected the match — fall through to application
      await ctx.reply("ℹ️ Siz noto'g'ri o'quvchi ekanligizni ko'rsatdingiz.");
    }
  }

  // Step 4: No high-confidence match — offer application
  await ctx.reply(
    `⚠️ Sizni maktab ro'yxatida topa olmadim.\n\n` +
    `Maktab administratoriga ariza yuborishni xohlaysizmi? ` +
    `Administrator sizni ro'yxatga qo'shadi.`,
    {
      reply_markup: new InlineKeyboard()
        .text("📋 Ariza yuborish", "submit_student_application")
        .row()
        .text("❌ Bekor qilish", "cancel_onboarding"),
    }
  );

  let ctxApp = await conversation.waitForCallbackQuery([
    "submit_student_application",
    "cancel_onboarding",
  ]);
  await ctxApp.answerCallbackQuery();

  if (ctxApp.callbackQuery.data === "cancel_onboarding") {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: welcomeScreen().keyboard });
    return;
  }

  // Check for duplicate application
  const hasPending = await conversation.external(() =>
    studentApplicationRepo.hasPendingApplication(userId, selectedSchoolId)
  );
  if (hasPending) {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply(
      "ℹ️ Siz allaqachon bu maktabga ariza yuborgansiz. `Administrator ko'rib chiqadi.`",
      { reply_markup: welcomeScreen().keyboard }
    );
    return;
  }

  // Create the application
  try {
    await conversation.external(() =>
      studentApplicationRepo.create({
        applicantUserId: userId,
        fullName,
        schoolId: selectedSchoolId,
      })
    );
  } catch (error) {
    const { welcomeScreen } = await import("../ui/screens");
    await ctx.reply(
      `❌ Xatolik yuz berdi: ${(error as Error).message}`,
      { reply_markup: welcomeScreen().keyboard }
    );
    return;
  }

  // Success
  await ctx.reply(
    `✅ Arizangiz qabul qilindi!\n\n` +
    `🏫 Maktab: ${school.name}\n` +
    `👤 Ism: ${fullName}\n\n` +
    `Administrator arizangizni ko'rib chiqadi va sizni ro'yxatga qo'shadi. ` +
    `Tasdiqlangandan so'ng, /start ni qayta bosing.`,
    { reply_markup: mainMenu().keyboard }
  );
}

/**
 * Parent onboarding: phone → name → school → neighborhood → preview → confirm.
 *
 * This reuses the existing registration screens and conversation pattern,
 * adding the parentRole (FATHER/MOTHER) to the profile save.
 */
async function parentOnboarding(
  conversation: BotConversation,
  ctx: BotContext,
  userId: number,
  parentRole: "FATHER" | "MOTHER",
  parentRoleLabel: string
) {
  const state: {
    phone?: string;
    parentFullName?: string;
    schoolId?: number;
    schoolName?: string;
    neighborhoodId?: number;
    neighborhoodName?: string;
  } = {};

  // ─── STEP 1: Phone (ReplyKeyboard with request_contact) ────────────
  const step1PhoneScreen = registrationStep1Phone();
  await ctx.reply(step1PhoneScreen.text, { reply_markup: step1PhoneScreen.reply_markup });

  let ctxStep1 = await conversation.waitFor(["message:contact", "message:text"]);

  if (ctxStep1.message?.text === "❌ Bekor qilish") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }

  const phone = ctxStep1.message?.contact?.phone_number;
  if (!phone) {
    await ctx.reply("⚠️ Telefon raqam talab qilinadi. Iltimos, tugma orqali raqamingizni yuboring.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }

  // Phase 2: Verify the contact belongs to the current user
  const contactUserId = ctxStep1.message?.contact?.user_id;
  if (contactUserId && contactUserId !== ctx.from!.id) {
    await ctx.reply("⚠️ Iltimos, o'z telefon raqamingizni yuboring.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }

  state.phone = phone;

  // ─── STEP 2: Name ───────────────────────────────────────────────────
  const step1NameScreen = registrationStep1Name();
  await ctx.reply(step1NameScreen.text, { reply_markup: step1NameScreen.reply_markup });

  let ctxName = await conversation.waitFor("message:text");
  if (ctxName.message?.text === "❌ Bekor qilish") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }
  const parentFullName = ctxName.message?.text?.trim();
  if (!parentFullName || parentFullName.length < 3) {
    await ctx.reply("⚠️ Iltimos, to'liq ism-familiyangizni kiriting.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }
  state.parentFullName = parentFullName;

  // ─── STEP 3: School selection ───────────────────────────────────────
  await ctx.reply(registrationRemoveKeyboard().text, {
    reply_markup: registrationRemoveKeyboard().reply_markup,
  });

  const schools = await conversation.external(() => prisma.school.findMany());
  const step2Screen = registrationStep2School(schools);
  await ctx.reply(step2Screen.text, { reply_markup: step2Screen.keyboard });

  let ctxSchool = await conversation.waitForCallbackQuery(/^select_school:|^cancel_registration$/);
  await ctxSchool.answerCallbackQuery();
  if (ctxSchool.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }
  state.schoolId = Number(ctxSchool.callbackQuery.data.split(":")[1]);
  state.schoolName = schools.find((s) => s.id === state.schoolId)?.name;

  // ─── STEP 4: Neighborhood selection ─────────────────────────────────
  const neighborhoods = await conversation.external(() => prisma.neighborhood.findMany());
  const step3Screen = registrationStep3Neighborhood(neighborhoods);
  await ctx.reply(step3Screen.text, { reply_markup: step3Screen.keyboard });

  let ctxNeighborhood = await conversation.waitForCallbackQuery(/^select_neighborhood:|^cancel_registration$/);
  await ctxNeighborhood.answerCallbackQuery();
  if (ctxNeighborhood.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }
  state.neighborhoodId = Number(ctxNeighborhood.callbackQuery.data.split(":")[1]);
  state.neighborhoodName = neighborhoods.find((n) => n.id === state.neighborhoodId)?.name;

  // ─── STEP 5: Preview & confirm ──────────────────────────────────────
  const previewScreen = registrationPreview({
    parentName: state.parentFullName || "",
    phone: state.phone || "",
    schoolName: state.schoolName || "",
    neighborhoodName: state.neighborhoodName || "",
    parentRoleLabel,
  });
  await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

  let ctxPreview = await conversation.waitForCallbackQuery([
    "confirm_registration",
    "edit_registration",
    "cancel_registration",
  ]);
  await ctxPreview.answerCallbackQuery();

  if (ctxPreview.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  if (ctxPreview.callbackQuery.data === "edit_registration") {
    await ctx.reply("ℹ️ Ma'lumotlarni o'zgartirish uchun /start ni qayta bosing.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // ─── STEP 6: Persist parent profile ─────────────────────────────────
  try {
    await conversation.external(() =>
      userRepo.updateParentProfile(userId, {
        fullName: state.parentFullName!,
        phone: state.phone!,
        schoolId: state.schoolId!,
        neighborhoodId: state.neighborhoodId!,
        parentRole,
      })
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    await ctx.reply(
      `❌ Xatolik yuz berdi: ${errorMessage}\n\nIltimos, qaytadan urinib ko'ring.`,
      { reply_markup: mainMenu().keyboard }
    );
    return;
  }

  // ─── STEP 7: Ask whether to add a child now ─────────────────────────
  const completeScreen = registrationCompleteAskChild({
    parentName: state.parentFullName || "",
    schoolName: state.schoolName || "",
    neighborhoodName: state.neighborhoodName || "",
  });

  await ctx.reply(completeScreen.text, { reply_markup: completeScreen.keyboard });

  const ctxChildChoice = await conversation.waitForCallbackQuery(["add_child_now", "skip_child"]);
  await ctxChildChoice.answerCallbackQuery();

  if (ctxChildChoice.callbackQuery.data === "skip_child") {
    await ctx.reply("🏠 Bosh menyu", { reply_markup: mainMenu().keyboard });
    return;
  }

  await ctx.reply("➕ Farzand qo'shish tugmasini bosing.", { reply_markup: mainMenu().keyboard });
}
