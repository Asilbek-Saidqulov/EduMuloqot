/**
 * Phase 10 Fix: Safe callback query helper.
 *
 * Immediately acknowledges a Telegram callback query, ignoring stale/invalid
 * query errors (which happen when the query times out — typically because
 * the handler took too long to respond).
 *
 * Usage:
 *   await safeAnswerCallbackQuery(ctx, { text: "⏳ Saqlanmoqda..." });
 *   // then do expensive work
 */
import type { BotContext } from "../../types";

export async function safeAnswerCallbackQuery(
  ctx: BotContext,
  options?: { text?: string; show_alert?: boolean }
): Promise<void> {
  if (!ctx.callbackQuery) return;

  try {
    await ctx.answerCallbackQuery(options);
  } catch (error: any) {
    const message = String(error?.message || error);

    // Telegram returns these when the callback query expires (typically
    // after ~30 seconds). This is expected if the handler was slow —
    // the PRIMARY fix is to answer immediately, but this helper catches
    // the race condition where the query expires between the user's tap
    // and the handler's start.
    if (
      message.includes("query is too old") ||
      message.includes("query ID is invalid") ||
      message.includes("response timeout expired")
    ) {
      console.warn("⚠️ Stale callback query ignored:", message);
      return;
    }

    // Re-throw unexpected errors
    console.error("Unexpected answerCallbackQuery error:", message);
    throw error;
  }
}
