import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { prisma } from "../../database/prisma";
import {
  registrationStep1Name,
  registrationStep2School,
  registrationStep3Neighborhood,
  registrationPreview,
  registrationCompleteAskChild,
  registrationRemoveKeyboard,
  mainMenu,
} from "../ui/screens";

/**
 * Parent registration conversation.
 *
 * Architectural rules followed (these are the root-cause fixes for the
 * "bot receives contact but does not continue" bug and the earlier
 * `TypeError: Cannot read properties of undefined (reading '0') at
 * ConversationHandle._replayApi` crash):
 *
 * 1. Inside the conversation, ALL Telegram API calls (ctx.reply,
 *    ctx.editMessageText, ctx.answerCallbackQuery, ...) are invoked
 *    DIRECTLY on `ctx`. The grammY conversations plugin intercepts these
 *    calls via `ctx.api.config.use` and records their results in the
 *    replay log. On replay the cached result is returned without making
 *    a new network call. This is the only correct way to call the Bot
 *    API from inside a conversation.
 *
 * 2. `conversation.external()` is used ONLY for genuine non-API side
 *    effects (database reads/writes, randomness, time). It must NOT wrap
 *    `ctx.reply` or any other API call. Wrapping an API call in
 *    `external` is harmful for two reasons:
 *      (a) The task's return value is stored as `{ v: value }` in the
 *          external slot. For a task like
 *          `async () => { await ctx.reply(...); }` the return value is
 *          `undefined`, so the slot is `{ v: undefined }`. When the
 *          session is persisted to the PostgreSQL `Json` column,
 *          `JSON.stringify` drops `undefined` values and the slot becomes
 *          `{}`. On the next replay, `"v" in {}` is false, so `external`
 *          throws `undefined` and the conversation is killed silently.
 *      (b) Even when the task returns a real value, the API call inside
 *          it is ALSO logged by the api-interceptor — but `external`
 *          returns the cached external result on replay without
 *          re-executing the task, so the API slot is never consumed.
 *          This diverges the replay cursor from the log and corrupts
 *          subsequent replays.
 *
 * 3. The non-deterministic `safeEditMessage` helper is NOT used inside
 *    the conversation. `safeEditMessage` tries `ctx.editMessageText`
 *    first and falls back to `ctx.reply` on any error. That fallback is
 *    a try/catch around a Bot API call: on the first run the call may
 *    throw (e.g. "message to edit not found"), so `ctx.reply` is logged
 *    instead; on replay `ctx.editMessageText` is called again and the
 *    api-interceptor calls `_replayApi("editMessageText")`, but the log
 *    only contains `sendMessage` — so `_c[method][index]` throws
 *    `Cannot read properties of undefined (reading '0')`. To stay
 *    deterministic, every API call inside the conversation must be a
 *    bare `ctx.reply` / `ctx.editMessageText` with NO try/catch
 *    fallback. If a call legitimately needs to be best-effort, that
 *    best-effort logic must live outside the conversation (in a
 *    callback handler) — never inside it.
 *
 * 4. ReplyKeyboard transitions: `request_contact` only works on a
 *    ReplyKeyboardButton, so the phone step uses a ReplyKeyboard. To
 *    dismiss that keyboard we either send a new ReplyKeyboard (which
 *    replaces the old one) or send a `remove_keyboard: true` marker
 *    message before the next InlineKeyboard screen. We cannot combine
 *    `remove_keyboard` and `inline_keyboard` in one message.
 */
export async function parentRegistrationConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findOrCreateByTelegramId(telegramId));

  // Per-step registration state
  const state: {
    phone?: string;
    parentFullName?: string;
    schoolId?: number;
    schoolName?: string;
    neighborhoodId?: number;
    neighborhoodName?: string;
  } = {};

  // ─── STEP 1: wait for the Telegram contact (or cancel) ────────────────
  // The phone ReplyKeyboard (with request_contact) is sent BEFORE entering
  // the conversation, in startRegistrationCallback. Here we just wait for
  // the user's reply: either a `message:contact` (contact shared) or a
  // `message:text` ("❌ Bekor qilish" pressed on the ReplyKeyboard).
  let ctxStep1 = await conversation.waitFor(["message:contact", "message:text"]);

  // ReplyKeyboard "❌ Bekor qilish" arrives as message:text, not as a
  // callback_query. Handle it before touching the contact.
  if (ctxStep1.message?.text === "❌ Bekor qilish") {
    // Remove the phone ReplyKeyboard and return to the main menu.
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }

  // Otherwise we expect a contact. Extract the phone number.
  const phone = ctxStep1.message?.contact?.phone_number;
  if (!phone) {
    await ctx.reply("⚠️ Telefon raqam talab qilinadi. Iltimos, tugma orqali raqamingizni yuboring.", {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply(mainMenu().text, { reply_markup: mainMenu().keyboard });
    return;
  }
  state.phone = phone;

  // ─── STEP 2: ask for the parent's full name ───────────────────────────
  // Replacing the phone ReplyKeyboard with a cancel-only ReplyKeyboard is
  // the cleanest way to (a) dismiss the phone keyboard and (b) keep a
  // visible cancel button — all in a single message. The cancel button
  // arrives as message:text, so the next waitFor only needs message:text.
  const step1NameScreen = registrationStep1Name();
  await ctx.reply(step1NameScreen.text, { reply_markup: step1NameScreen.reply_markup });

  // Wait for either the parent's name (message:text) or the cancel button
  // (also message:text "❌ Bekor qilish"). No callback_query here.
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

  // ─── STEP 3: school selection (InlineKeyboard) ───────────────────────
  // Dismiss the cancel-only ReplyKeyboard before showing the InlineKeyboard
  // — Telegram cannot carry remove_keyboard + inline_keyboard in one msg.
  await ctx.reply(registrationRemoveKeyboard().text, {
    reply_markup: registrationRemoveKeyboard().reply_markup,
  });

  const schools = await conversation.external(() => prisma.school.findMany());
  const step2Screen = registrationStep2School(schools);
  await ctx.reply(step2Screen.text, { reply_markup: step2Screen.keyboard });

  let ctxSchool = await conversation.waitForCallbackQuery(/^select_school:|^cancel_registration$/);
  await ctxSchool.answerCallbackQuery();
  if (ctxSchool.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }
  state.schoolId = Number(ctxSchool.callbackQuery.data.split(":")[1]);
  state.schoolName = schools.find((s) => s.id === state.schoolId)?.name;

  // ─── STEP 4: neighborhood selection (InlineKeyboard) ─────────────────
  const neighborhoods = await conversation.external(() => prisma.neighborhood.findMany());
  const step3Screen = registrationStep3Neighborhood(neighborhoods);
  await ctx.reply(step3Screen.text, { reply_markup: step3Screen.keyboard });

  let ctxNeighborhood = await conversation.waitForCallbackQuery(/^select_neighborhood:|^cancel_registration$/);
  await ctxNeighborhood.answerCallbackQuery();
  if (ctxNeighborhood.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }
  state.neighborhoodId = Number(ctxNeighborhood.callbackQuery.data.split(":")[1]);
  state.neighborhoodName = neighborhoods.find((n) => n.id === state.neighborhoodId)?.name;

  // ─── STEP 5: preview & confirm ───────────────────────────────────────
  const previewScreen = registrationPreview({
    parentName: state.parentFullName || "",
    phone: state.phone || "",
    schoolName: state.schoolName || "",
    neighborhoodName: state.neighborhoodName || "",
  });
  await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

  let ctxPreview = await conversation.waitForCallbackQuery([
    "confirm_registration",
    "edit_registration",
    "cancel_registration",
  ]);
  await ctxPreview.answerCallbackQuery();

  if (ctxPreview.callbackQuery.data === "cancel_registration") {
    await ctx.reply("❌ Ro'yxatdan o'tish bekor qilindi.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  if (ctxPreview.callbackQuery.data === "edit_registration") {
    await ctx.reply("ℹ️ Ma'lumotlarni o'zgartirish uchun ro'yxatdan o'tishni qaytadan boshlang.", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // ─── STEP 6: persist parent profile ──────────────────────────────────
  try {
    await conversation.external(() =>
      userRepo.updateParentProfile(user.id, {
        fullName: state.parentFullName!,
        phone: state.phone!,
        schoolId: state.schoolId!,
        neighborhoodId: state.neighborhoodId!,
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

  // ─── STEP 7: ask whether to add a child now ──────────────────────────
  const completeScreen = registrationCompleteAskChild({
    parentName: state.parentFullName || "",
    schoolName: state.schoolName || "",
    neighborhoodName: state.neighborhoodName || "",
  });

  await ctx.reply(completeScreen.text, {
    reply_markup: completeScreen.keyboard,
  });

  const ctxChildChoice = await conversation.waitForCallbackQuery([
    "add_child_now",
    "skip_child",
  ]);

  await ctxChildChoice.answerCallbackQuery();

  if (ctxChildChoice.callbackQuery.data === "skip_child") {
    await ctx.reply("🏠 Bosh menyu", {
      reply_markup: mainMenu().keyboard,
    });
    return;
  }

  // Child registrationni bu yerdan enter QILMAYMIZ.
  // Foydalanuvchi "➕ Farzand qo'shish" tugmasini bosganda
  // global handler childRegistration conversationni ishga tushiradi.
  await ctx.reply(
    "➕ Farzand qo'shish tugmasini bosing.",
    {
      reply_markup: mainMenu().keyboard,
    }
  );
}
