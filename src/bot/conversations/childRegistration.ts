import type { BotContext, BotConversation } from "../../types";
import { studentService, ClaimCandidate } from "../../services/studentService";
import { userRepo } from "../../repositories/userRepo";
import { prisma } from "../../database/prisma";
import {
  childClaimNamePrompt,
  childClaimNoMatch,
  childClaimPreview,
  childClaimMultipleCandidates,
  childClaimAlreadyClaimed,
  childClaimSuccess,
  mainMenu,
} from "../ui/screens";

/**
 * Child registration conversation — registry-based claiming.
 *
 * This conversation does NOT create new Student records. Instead, it
 * searches the official school registry (imported from Excel) and links
 * an existing unlinked Student to the parent.
 *
 * Flow:
 * 1. Parent enters child's name (free text, no class required first).
 * 2. System searches the parent's school registry for unlinked students
 *    matching the name (fuzzy matching with confidence scoring).
 * 3. If one HIGH-confidence match → show preview → parent confirms → claim.
 * 4. If multiple candidates → show list → parent selects → preview → claim.
 * 5. If no match → ask for more info or offer PINFL fallback.
 * 6. Claim is atomic (SELECT FOR UPDATE + conditional UPDATE) — race-safe.
 *
 * PINFL is NOT required. It's only used as an optional fallback if
 * name-based search fails.
 *
 * Replay-safety: direct ctx.reply, conversation.external for DB calls.
 */
export async function childRegistrationConversation(conversation: BotConversation, ctx: BotContext) {
  const telegramId = BigInt(ctx.from!.id);
  let user = await conversation.external(() => userRepo.findByTelegramId(telegramId));

  if (!user) {
    await ctx.reply("⚠️ Foydalanuvchi topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Get parent's school — all searches are scoped to this school
  const parent = await conversation.external(() =>
    prisma.user.findUnique({ where: { id: user.id } })
  );

  if (!parent || !parent.schoolId) {
    await ctx.reply("⚠️ Maktab ma'lumotlari topilmadi.", { reply_markup: mainMenu().keyboard });
    return;
  }

  const schoolId = parent.schoolId;
  const parentId = user.id;

  // ─── Search loop: parent can retry with different names ──────────
  // The loop allows the parent to search again if the first attempt
  // doesn't find the right student. Max 5 attempts to prevent abuse.
  for (let attempt = 0; attempt < 5; attempt++) {
    // Step 1: Ask for child's name
    const namePrompt = childClaimNamePrompt();
    await ctx.reply(namePrompt.text, { reply_markup: namePrompt.keyboard });

    // Wait for name input or cancel
    let ctxInput = await conversation.waitFor(["message:text", "callback_query:data"]);

    if (ctxInput.callbackQuery?.data === "cancel_child_registration") {
      await ctxInput.answerCallbackQuery();
      await ctx.reply("❌ Farzand qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
      return;
    }

    // If the user tapped a stale inline button (not cancel), answer the
    // callback and ignore it — wait for actual text input on the next loop.
    if (ctxInput.callbackQuery) {
      await ctxInput.answerCallbackQuery();
      continue;
    }

    const rawInput = ctxInput.message?.text?.trim() ?? "";
    if (!rawInput || rawInput.length < 3) {
      await ctx.reply("⚠️ Iltimos, farzandingizning ism-familiyasini kiriting.", {
        reply_markup: mainMenu().keyboard,
      });
      return;
    }

    // Step 2: Search the registry
    // Check if the input looks like a PINFL (14 digits)
    const cleanedInput = rawInput.replace(/[\s\-]/g, "");
    if (/^\d{14}$/.test(cleanedInput)) {
      // PINFL fallback search
      const candidate = await conversation.external(() =>
        studentService.searchByPinfl(schoolId, cleanedInput)
      );

      if (candidate) {
        // Check if already claimed
        const alreadyClaimed = await conversation.external(() =>
          studentService.isStudentAlreadyClaimed(cleanedInput, schoolId)
        );

        if (alreadyClaimed) {
          const screen = childClaimAlreadyClaimed();
          await ctx.reply(screen.text, { reply_markup: screen.keyboard });
          // Wait for retry or cancel
          let ctxRetry = await conversation.waitForCallbackQuery(["retry_name_search", "cancel_child_registration", "home"]);
          await ctxRetry.answerCallbackQuery();
          if (ctxRetry.callbackQuery.data === "retry_name_search") continue;
          return;
        }

        // Show preview
        const previewScreen = childClaimPreview({
          fullName: candidate.fullName,
          className: candidate.className,
          birthDate: candidate.birthDate,
          pinfl: candidate.pinfl,
        });
        await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

        // Wait for confirmation
        let ctxConfirm = await conversation.waitForCallbackQuery([
          "confirm_claim_child",
          "reject_claim_child",
          "retry_name_search",
        ]);
        await ctxConfirm.answerCallbackQuery();

        if (ctxConfirm.callbackQuery.data === "confirm_claim_child") {
          await performClaim(conversation, ctx, candidate, parentId, schoolId);
          return;
        } else if (ctxConfirm.callbackQuery.data === "retry_name_search") {
          continue;
        } else {
          // reject_claim_child
          await ctx.reply("❌ Farzand qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
          return;
        }
      } else {
        // PINFL not found or already claimed
        const screen = childClaimNoMatch();
        await ctx.reply(screen.text, { reply_markup: screen.keyboard });
        let ctxRetry = await conversation.waitForCallbackQuery(["retry_name_search", "cancel_child_registration"]);
        await ctxRetry.answerCallbackQuery();
        if (ctxRetry.callbackQuery.data === "retry_name_search") continue;
        return;
      }
    }

    // Name-based search
    const candidates = await conversation.external(() =>
      studentService.searchClaimCandidates(schoolId, rawInput)
    );

    if (candidates.length === 0) {
      // No match
      const noMatchScreen = childClaimNoMatch();
      await ctx.reply(noMatchScreen.text, { reply_markup: noMatchScreen.keyboard });
      let ctxRetry = await conversation.waitForCallbackQuery(["retry_name_search", "cancel_child_registration"]);
      await ctxRetry.answerCallbackQuery();
      if (ctxRetry.callbackQuery.data === "retry_name_search") continue;
      return;
    }

    // Filter by confidence
    const highConfidence = candidates.filter((c) => c.confidence === "HIGH");
    const mediumConfidence = candidates.filter((c) => c.confidence === "MEDIUM");

    if (highConfidence.length === 1) {
      // Single high-confidence match → show preview directly
      const candidate = highConfidence[0];
      const previewScreen = childClaimPreview({
        fullName: candidate.fullName,
        className: candidate.className,
        birthDate: candidate.birthDate,
        pinfl: candidate.pinfl,
      });
      await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

      let ctxConfirm = await conversation.waitForCallbackQuery([
        "confirm_claim_child",
        "reject_claim_child",
        "retry_name_search",
      ]);
      await ctxConfirm.answerCallbackQuery();

      if (ctxConfirm.callbackQuery.data === "confirm_claim_child") {
        await performClaim(conversation, ctx, candidate, parentId, schoolId);
        return;
      } else if (ctxConfirm.callbackQuery.data === "retry_name_search") {
        continue;
      } else {
        await ctx.reply("❌ Farzand qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
        return;
      }
    } else if (highConfidence.length > 1 || mediumConfidence.length > 0) {
      // Multiple candidates → show list
      const allCandidates = [...highConfidence, ...mediumConfidence].slice(0, 8);
      const listScreen = childClaimMultipleCandidates(
        allCandidates.map((c) => ({ id: c.id, fullName: c.fullName, className: c.className }))
      );
      await ctx.reply(listScreen.text, { reply_markup: listScreen.keyboard });

      // Wait for selection
      let ctxSelect = await conversation.waitForCallbackQuery([
        /^select_claim:\d+$/,
        "retry_name_search",
        "cancel_child_registration",
      ]);
      await ctxSelect.answerCallbackQuery();

      if (ctxSelect.callbackQuery.data === "retry_name_search") {
        continue;
      }
      if (ctxSelect.callbackQuery.data === "cancel_child_registration") {
        await ctx.reply("❌ Farzand qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
        return;
      }

      // Parent selected a candidate
      const selectedId = Number(ctxSelect.callbackQuery.data.split(":")[1]);
      const selectedCandidate = allCandidates.find((c) => c.id === selectedId);

      if (!selectedCandidate) {
        await ctx.reply("⚠️ O'quvchi topilmadi. Iltimos, qaytadan urinib ko'ring.", {
          reply_markup: mainMenu().keyboard,
        });
        return;
      }

      // Show preview for the selected candidate
      const previewScreen = childClaimPreview({
        fullName: selectedCandidate.fullName,
        className: selectedCandidate.className,
        birthDate: selectedCandidate.birthDate,
        pinfl: selectedCandidate.pinfl,
      });
      await ctx.reply(previewScreen.text, { reply_markup: previewScreen.keyboard });

      let ctxConfirm = await conversation.waitForCallbackQuery([
        "confirm_claim_child",
        "reject_claim_child",
        "retry_name_search",
      ]);
      await ctxConfirm.answerCallbackQuery();

      if (ctxConfirm.callbackQuery.data === "confirm_claim_child") {
        await performClaim(conversation, ctx, selectedCandidate, parentId, schoolId);
        return;
      } else if (ctxConfirm.callbackQuery.data === "retry_name_search") {
        continue;
      } else {
        await ctx.reply("❌ Farzand qo'shish bekor qilindi.", { reply_markup: mainMenu().keyboard });
        return;
      }
    } else {
      // Only LOW confidence matches
      const noMatchScreen = childClaimNoMatch();
      await ctx.reply(noMatchScreen.text, { reply_markup: noMatchScreen.keyboard });
      let ctxRetry = await conversation.waitForCallbackQuery(["retry_name_search", "cancel_child_registration"]);
      await ctxRetry.answerCallbackQuery();
      if (ctxRetry.callbackQuery.data === "retry_name_search") continue;
      return;
    }
  }

  // Exhausted all attempts
  await ctx.reply(
    "🔔 Farzandingizni topa olmadingiz. Iltimos, maktab administratori bilan bog'laning.",
    { reply_markup: mainMenu().keyboard }
  );
}

/**
 * Perform the actual claim operation.
 *
 * Uses studentService.claimChild which does an atomic SELECT FOR UPDATE
 * + conditional UPDATE. If the student was claimed by someone else in
 * the meantime, returns null and shows the "already claimed" message.
 *
 * The schoolId is passed for defense-in-depth: claimStudent verifies
 * the student belongs to the parent's school at the DB level.
 */
async function performClaim(
  conversation: BotConversation,
  ctx: BotContext,
  candidate: ClaimCandidate,
  parentId: number,
  schoolId: number
) {
  try {
    const claimed = await conversation.external(() =>
      studentService.claimChild(candidate.id, parentId, schoolId)
    );

    if (claimed) {
      const successScreen = childClaimSuccess();
      await ctx.reply(successScreen.text, { reply_markup: successScreen.keyboard });
    } else {
      // Race condition: someone else claimed it between our search and claim,
      // or the student doesn't belong to the parent's school (defense-in-depth)
      const alreadyScreen = childClaimAlreadyClaimed();
      await ctx.reply(alreadyScreen.text, { reply_markup: alreadyScreen.keyboard });
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    await ctx.reply(
      `❌ Xatolik yuz berdi: ${errorMessage}\n\nIltimos, qaytadan urinib ko'ring.`,
      { reply_markup: mainMenu().keyboard }
    );
  }
}
