import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { prisma } from "../../database/prisma";
import {
  profileEditCurrentInfo,
  profileEditName,
  profileEditPhone,
  profileEditSchool,
  profileEditNeighborhood,
  profileEditPreview,
  profileEditSaved,
  registrationRemoveKeyboard,
  mainMenu,
} from "../ui/screens";

/**
 * Profile Edit conversation.
 *
 * Edits the CURRENT user's profile (fullName, phone, schoolId, or
 * neighborhoodId). Only one field is edited per run — the user picks which
 * field from the edit menu, enters a new value, confirms a preview, and the
 * single field is updated. The other three fields, plus id/telegramId/
 * createdAt, are preserved.
 *
 * No session plumbing is needed (unlike childEdit which needs studentId) —
 * the user is always identified by ctx.from.id.
 *
 * Replay-safety rules (same as parentRegistration.ts and childEdit.ts):
 *   1. All Bot API calls (ctx.reply, ctx.answerCallbackQuery) are made
 *      DIRECTLY — never wrapped in `conversation.external()`. The
 *      conversations plugin intercepts them via ctx.api.config.use and
 *      records their results in the replay log.
 *   2. `conversation.external()` is used ONLY for database reads/writes
 *      (userRepo.findByTelegramId, prisma.school.findMany,
 *      prisma.neighborhood.findMany, userRepo.updateFullName,
 *      userRepo.updatePhone, userRepo.updateSchool,
 *      userRepo.updateNeighborhood). These return real JSON-serializable
 *      values, so their external slots survive the PostgreSQL Json
 *      round-trip.
 *   3. `safeEditMessage` is NOT used inside the conversation — its
 *      try/catch fallback (editMessageText → reply) is non-deterministic
 *      and breaks replay.
 *   4. ReplyKeyboard transitions: when the name or phone step shows a
 *      ReplyKeyboard, the next InlineKeyboard screen is preceded by a
 *      `remove_keyboard: true` marker message (Telegram cannot carry
 *      remove_keyboard + inline_keyboard in one message).
 */
export async function profileEditConversation(conversation: BotConversation, ctx: BotContext) {
  // ─── Load the current user ───────────────────────────────────────────
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));
  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Resolve current school/neighborhood names for display (the User row
  // only stores the ids).
  const [school, neighborhood] = await conversation.external(async () => {
    const s = user.schoolId ? await prisma.school.findUnique({ where: { id: user.schoolId! } }) : null;
    const n = user.neighborhoodId
      ? await prisma.neighborhood.findUnique({ where: { id: user.neighborhoodId! } })
      : null;
    return [s, n] as const;
  });

  const currentSchoolName = school?.name ?? null;
  const currentNeighborhoodName = neighborhood?.name ?? null;

  // ─── STEP 1: Show current info + edit menu ───────────────────────────
  const infoScreen = profileEditCurrentInfo({
    fullName: user.fullName,
    phone: user.phone,
    schoolName: currentSchoolName,
    neighborhoodName: currentNeighborhoodName,
  });
  await ctx.reply(infoScreen.text, { reply_markup: infoScreen.keyboard });

  let ctxChoice = await conversation.waitForCallbackQuery([
    "edit_profile_name",
    "edit_profile_phone",
    "edit_profile_school",
    "edit_profile_neighborhood",
    "cancel_edit_profile",
  ]);
  await ctxChoice.answerCallbackQuery();

  if (ctxChoice.callbackQuery.data === "cancel_edit_profile") {
    await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Phase 9 Security Fix: Block self-service school/neighborhood changes.
  // These fields control school isolation — allowing a parent to change
  // their schoolId would let them access other schools' students,
  // attendance, and complaints. School/neighborhood can only be set
  // during onboarding or via admin provisioning (staffService).
  if (ctxChoice.callbackQuery.data === "edit_profile_school" || ctxChoice.callbackQuery.data === "edit_profile_neighborhood") {
    await ctx.reply(
      "⚠️ Maktab va mahallani o'zgartirish mumkin emas.\n\n" +
      "Agar maktabingiz o'zgargan bo'lsa, administrator bilan bog'laning.",
      { reply_markup: mainMenu().keyboard }
    );
    return;
  }

  const fieldToEdit = ctxChoice.callbackQuery.data as
    | "edit_profile_name"
    | "edit_profile_phone"
    | "edit_profile_school"
    | "edit_profile_neighborhood";

  // ─── STEP 2: Collect the new value ───────────────────────────────────
  let newValue: string;
  let newId: number | null = null; // for school/neighborhood
  let oldValue: string;
  let fieldLabel: "name" | "phone" | "school" | "neighborhood";

  if (fieldToEdit === "edit_profile_name") {
    fieldLabel = "name";
    oldValue = user.fullName || "Noma'lum";

    // ReplyKeyboard cancel-only, waitFor message:text.
    const nameScreen = profileEditName({ currentName: user.fullName });
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
  } else if (fieldToEdit === "edit_profile_phone") {
    fieldLabel = "phone";
    oldValue = user.phone || "Noma'lum";

    // ReplyKeyboard with request_contact + cancel, waitFor message:contact or message:text.
    const phoneScreen = profileEditPhone({ currentPhone: user.phone });
    await ctx.reply(phoneScreen.text, { reply_markup: phoneScreen.reply_markup });

    let ctxPhone = await conversation.waitFor(["message:contact", "message:text"]);
    if (ctxPhone.message?.text === "❌ Bekor qilish") {
      await ctx.reply("❌ Tahrirlash bekor qilindi.", {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
      return;
    }
    const phone = ctxPhone.message?.contact?.phone_number;
    if (!phone) {
      await ctx.reply("⚠️ Telefon raqam talab qilinadi. Iltimos, tugma orqali raqamingizni yuboring.", {
        reply_markup: { remove_keyboard: true },
      });
      await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
      return;
    }
    newValue = phone;

    // Dismiss the ReplyKeyboard before showing the InlineKeyboard preview.
    await ctx.reply(registrationRemoveKeyboard().text, {
      reply_markup: registrationRemoveKeyboard().reply_markup,
    });
  } else if (fieldToEdit === "edit_profile_school") {
    fieldLabel = "school";
    oldValue = currentSchoolName || "Noma'lum";

    // InlineKeyboard list of schools, waitForCallbackQuery.
    const schools = await conversation.external(() => prisma.school.findMany());
    const schoolScreen = profileEditSchool(schools, { currentSchoolName });
    await ctx.reply(schoolScreen.text, { reply_markup: schoolScreen.keyboard });

    let ctxSchool = await conversation.waitForCallbackQuery(
      /^select_edit_profile_school:|^cancel_edit_profile$/
    );
    await ctxSchool.answerCallbackQuery();
    if (ctxSchool.callbackQuery.data === "cancel_edit_profile") {
      await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
    newId = Number(ctxSchool.callbackQuery.data.split(":")[1]);
    const chosen = schools.find((s) => s.id === newId);
    newValue = chosen?.name ?? String(newId);
  } else {
    fieldLabel = "neighborhood";
    oldValue = currentNeighborhoodName || "Noma'lum";

    // InlineKeyboard list of neighborhoods, waitForCallbackQuery.
    const neighborhoods = await conversation.external(() => prisma.neighborhood.findMany());
    const neighborhoodScreen = profileEditNeighborhood(neighborhoods, { currentNeighborhoodName });
    await ctx.reply(neighborhoodScreen.text, { reply_markup: neighborhoodScreen.keyboard });

    let ctxNeighborhood = await conversation.waitForCallbackQuery(
      /^select_edit_profile_neighborhood:|^cancel_edit_profile$/
    );
    await ctxNeighborhood.answerCallbackQuery();
    if (ctxNeighborhood.callbackQuery.data === "cancel_edit_profile") {
      await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }
    newId = Number(ctxNeighborhood.callbackQuery.data.split(":")[1]);
    const chosen = neighborhoods.find((n) => n.id === newId);
    newValue = chosen?.name ?? String(newId);
  }

  // ─── STEP 3: Preview ─────────────────────────────────────────────────
  const previewScreen = profileEditPreview({ field: fieldLabel, oldValue, newValue });
  await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

  let ctxPreview = await conversation.waitForCallbackQuery([
    "confirm_edit_profile",
    "cancel_edit_profile",
  ]);
  await ctxPreview.answerCallbackQuery();

  if (ctxPreview.callbackQuery.data === "cancel_edit_profile") {
    await ctx.reply("❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // ─── STEP 4: Persist the change ──────────────────────────────────────
  // Only the chosen field is updated. id, telegramId, createdAt, and the
  // other three profile fields are untouched.
  try {
    if (fieldLabel === "name") {
      await conversation.external(() => userRepo.updateFullName(user.id, newValue));
    } else if (fieldLabel === "phone") {
      await conversation.external(() => userRepo.updatePhone(user.id, newValue));
    } else if (fieldLabel === "school") {
      await conversation.external(() => userRepo.updateSchool(user.id, newId!));
    } else {
      await conversation.external(() => userRepo.updateNeighborhood(user.id, newId!));
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
  // The "👤 Profil" button triggers the `profile` callback, which calls
  // showProfile — that handler reloads the user from the DB and displays
  // the updated info. So the profile screen refreshes automatically when
  // the user taps that button.
  const savedScreen = profileEditSaved();
  await ctx.reply(savedScreen.text, { reply_markup: savedScreen.keyboard });
}
