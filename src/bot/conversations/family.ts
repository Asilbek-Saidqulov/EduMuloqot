/**
 * Phase 3: Family conversation.
 *
 * Handles:
 *   - Family creation (first parent)
 *   - Family invitation generation
 *   - Family joining (second parent via invitation code)
 *   - Family menu display
 *
 * Replay-safe: direct ctx.reply, conversation.external for DB calls.
 */
import type { BotContext, BotConversation } from "../../types";
import { userRepo } from "../../repositories/userRepo";
import { familyRepo } from "../../repositories/familyRepo";
import {
  familyMenu,
  familyNoFamily,
  familyInvitationCreated,
  familyJoinPrompt,
  familyJoinPreview,
  familyJoinSuccess,
  familyCreateConfirm,
  familyCreateSuccess,
  mainMenu,
} from "../ui/screens";

export async function familyConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  const user = await conversation.external(() => userRepo.findByTelegramId(telegramId));

  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  if (!user.parentRole) {
    await ctx.reply("⚠️ Siz ota-ona sifatida ro'yxatdan o'tmagansiz.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Check if user already has a family
  const existingFamily = await conversation.external(() => familyRepo.findFamilyByUserId(user.id));

  if (existingFamily) {
    await showFamilyMenu(ctx, existingFamily);
    return;
  }

  // No family — show create/join options
  const noFamilyScreen = familyNoFamily();
  await ctx.reply(noFamilyScreen.text, { reply_markup: noFamilyScreen.keyboard });

  let ctxChoice = await conversation.waitForCallbackQuery([
    "family_create",
    "family_join_prompt",
    "home",
  ]);
  await ctxChoice.answerCallbackQuery();

  if (ctxChoice.callbackQuery.data === "home") return;

  if (ctxChoice.callbackQuery.data === "family_create") {
    // Confirm family creation
    const confirmScreen = familyCreateConfirm();
    await ctx.reply(confirmScreen.text, { reply_markup: confirmScreen.keyboard });

    let ctxConfirm = await conversation.waitForCallbackQuery([
      "confirm_family_create",
      "cancel_family_create",
    ]);
    await ctxConfirm.answerCallbackQuery();

    if (ctxConfirm.callbackQuery.data === "cancel_family_create") {
      await ctx.reply("❌ Oila yaratish bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    // Create family atomically
    try {
      await conversation.external(() =>
        familyRepo.createFamily(user.id, user.parentRole!)
      );
      const successScreen = familyCreateSuccess();
      await ctx.reply(successScreen.text, { reply_markup: successScreen.keyboard });
    } catch (error: any) {
      if (error?.code === "P2002") {
        await ctx.reply("⚠️ Siz allaqachon bir oilaga a'zosiz.", { reply_markup: mainMenu().keyboard });
      } else {
        await ctx.reply(`❌ Xatolik: ${error.message}`, { reply_markup: mainMenu().keyboard });
      }
    }
    return;
  }

  if (ctxChoice.callbackQuery.data === "family_join_prompt") {
    // Ask for invitation code
    const joinScreen = familyJoinPrompt();
    await ctx.reply(joinScreen.text, { reply_markup: joinScreen.keyboard });

    // Wait for text input (the code) or cancel callback
    let ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);

    if (ctxInput.callbackQuery?.data === "cancel_family_join") {
      await ctxInput.answerCallbackQuery();
      await ctx.reply("❌ Oila kodini kiritish bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    // Ignore stale callbacks, wait for text
    if (ctxInput.callbackQuery) {
      await ctxInput.answerCallbackQuery();
      // Re-ask
      const screen = familyJoinPrompt();
      await ctx.reply(screen.text, { reply_markup: screen.keyboard });
      ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);
      if (ctxInput.callbackQuery) {
        await ctxInput.answerCallbackQuery();
        await ctx.reply("❌ Bekor qilindi.", { reply_markup: mainMenu().keyboard });
        return;
      }
    }

    const code = ctxInput.message?.text?.trim() ?? "";

    // Look up invitation
    const invitation = await conversation.external(() =>
      familyRepo.findInvitationByToken(code)
    );

    if (!invitation) {
      await ctx.reply(
        "⚠️ Taklif kodi topilmadi yoki muddati tugagan.\n\nIltimos, kodni tekshirib qaytadan kiriting.",
        { reply_markup: mainMenu().keyboard }
      );
      return;
    }

    // Show preview (safe info only)
    const existingMembers = invitation.family.members || [];
    const firstMember = existingMembers[0];
    const parentName = firstMember?.user?.fullName ?? "Noma'lum";
    const parentRole = firstMember?.user?.parentRole ?? "FATHER";
    const children = (invitation.family.students || []).map((fs: any) => ({
      fullName: fs.student?.fullName ?? "",
      className: fs.student?.className ?? "",
    }));

    const previewScreen = familyJoinPreview({
      parentName,
      parentRole,
      children,
    });
    await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

    // Wait for confirmation
    let ctxJoinConfirm = await conversation.waitForCallbackQuery([
      "confirm_family_join",
      "cancel_family_join",
    ]);
    await ctxJoinConfirm.answerCallbackQuery();

    if (ctxJoinConfirm.callbackQuery.data === "cancel_family_join") {
      await ctx.reply("❌ Oila qo'shilish bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    // Join family atomically
    const result = await conversation.external(() =>
      familyRepo.joinFamilyByInvitation(code, user.id, user.parentRole!)
    );

    if ("error" in result) {
      await ctx.reply(`⚠️ ${result.error}`, { reply_markup: mainMenu().keyboard });
    } else {
      const successScreen = familyJoinSuccess();
      await ctx.reply(successScreen.text, { reply_markup: successScreen.keyboard });
    }
    return;
  }
}

/**
 * Show the family menu (for parents who already have a family).
 * Used as a standalone handler (not inside a conversation).
 */
export async function showFamilyMenuHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user || !user.parentRole) {
    await ctx.reply("⚠️ Siz ota-ona sifatida ro'yxatdan o'tmagansiz.", { reply_markup: mainMenu().keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  const family = await familyRepo.findFamilyByUserId(user.id);

  if (!family) {
    const screen = familyNoFamily();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  await showFamilyMenu(ctx, family);
  await ctx.answerCallbackQuery();
}

/**
 * Generate a family invitation (standalone handler).
 */
export async function familyInviteHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const user = await userRepo.findByTelegramId(telegramId);

  if (!user || !user.parentRole) {
    await ctx.reply("⚠️ Siz ota-ona sifatida ro'yxatdan o'tmagansiz.");
    await ctx.answerCallbackQuery();
    return;
  }

  const family = await familyRepo.findFamilyByUserId(user.id);

  if (!family) {
    await ctx.reply("⚠️ Siz hali oilaga ulanmagansiz.", { reply_markup: mainMenu().keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  // Check if both roles are already filled
  const hasFather = family.members.some((m: any) => m.parentRole === "FATHER");
  const hasMother = family.members.some((m: any) => m.parentRole === "MOTHER");

  if (hasFather && hasMother) {
    await ctx.reply("⚠️ Oilada ota va ona allaqachon mavjud.", { reply_markup: mainMenu().keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    const { token } = await familyRepo.createInvitation(family.id, user.id);
    const screen = familyInvitationCreated(token);
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  } catch (error: any) {
    await ctx.reply(`❌ Xatolik: ${error.message}`, { reply_markup: mainMenu().keyboard });
  }
  await ctx.answerCallbackQuery();
}

/**
 * Helper: show the family menu screen.
 */
async function showFamilyMenu(ctx: BotContext, family: any) {
  const members = family.members || [];
  const father = members.find((m: any) => m.parentRole === "FATHER");
  const mother = members.find((m: any) => m.parentRole === "MOTHER");

  const children = (family.students || []).map((fs: any) => ({
    fullName: fs.student?.fullName ?? "Noma'lum",
    className: fs.student?.className ?? "",
  }));

  const screen = familyMenu({
    fatherName: father?.user?.fullName ?? null,
    motherName: mother?.user?.fullName ?? null,
    children,
  });

  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
}
