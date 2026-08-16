import type { BotContext } from "../../types";
import { InlineKeyboard } from "grammy";

/**
 * Normalize a user-entered complaint number to the canonical form stored in
 * the DB ("#EDU-000001" — with the leading `#` and uppercase letters).
 *
 * Accepts reasonable user input variations:
 *   "#EDU-000001"  → "#EDU-000001"
 *   "EDU-000001"   → "#EDU-000001"
 *   "edu-000001"   → "#EDU-000001"
 *   "  #EDU-000001 " → "#EDU-000001"  (whitespace trimmed)
 *
 * Returns `null` if the input does not match the expected pattern
 * (/^#?EDU-\d{6}$/ after trimming). The caller should show a validation
 * error and let the user retry.
 *
 * Intentionally NOT permissive: we do not accept "EDU000001" (no dash),
 * "EDU-1" (not zero-padded to 6), or any prefix other than "EDU-". This
 * keeps the matching predictable and avoids accidental substring matches.
 */
export function normalizeComplaintNumber(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Strip a single leading "#" if present, then uppercase. We do NOT strip
  // multiple "#"s — "##EDU-000001" is a user typo and should be rejected.
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const upper = withoutHash.toUpperCase();
  // Must be exactly "EDU-" followed by 6 digits.
  if (!/^EDU-\d{6}$/.test(upper)) return null;
  return `#${upper}`;
}

/**
 * Safely edit a message with fallback to sending a new message
 * Handles Telegram errors gracefully
 */
export async function safeEditMessage(
  ctx: BotContext,
  text: string,
  keyboard?: InlineKeyboard,
  options?: { parse_mode?: string; reply_markup?: any }
): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: options?.parse_mode as any,
      });
    } else if (ctx.message) {
      await ctx.reply(text, {
        reply_markup: options?.reply_markup || keyboard,
        parse_mode: options?.parse_mode as any,
      });
    }
  } catch (error: any) {
    // Handle common Telegram edit errors
    if (error.description?.includes("message is not modified")) {
      // Message content is identical, ignore
      return;
    }
    if (error.description?.includes("message to edit not found")) {
      // Message too old or deleted, send new message
      await ctx.reply(text, {
        reply_markup: options?.reply_markup || keyboard,
        parse_mode: options?.parse_mode as any,
      });
      return;
    }
    if (error.description?.includes("query is too old")) {
      // Callback query expired, send new message
      await ctx.reply(text, {
        reply_markup: options?.reply_markup || keyboard,
        parse_mode: options?.parse_mode as any,
      });
      return;
    }
    // Log unexpected errors
    console.error("safeEditMessage error:", error);
    // Fallback: send new message
    await ctx.reply(text, {
      reply_markup: options?.reply_markup || keyboard,
      parse_mode: options?.parse_mode as any,
    });
  }
}

/**
 * Send message with raw reply_markup (for ReplyKeyboard)
 * Bypasses conversation replay system
 */
export async function sendReplyKeyboard(
  ctx: BotContext,
  text: string,
  reply_markup: any
): Promise<void> {
  await ctx.reply(text, { reply_markup });
}

/**
 * Safely edit message reply markup only
 */
export async function safeEditReplyMarkup(
  ctx: BotContext,
  keyboard?: InlineKeyboard
): Promise<void> {
  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
    }
  } catch (error: any) {
    if (error.description?.includes("message is not modified")) {
      return;
    }
    if (error.description?.includes("message to edit not found")) {
      return;
    }
    if (error.description?.includes("query is too old")) {
      return;
    }
    console.error("safeEditReplyMarkup error:", error);
  }
}

/**
 * Send a new message (for important notifications that shouldn't be edited)
 */
export async function sendNewMessage(
  ctx: BotContext,
  text: string,
  keyboard?: InlineKeyboard,
  options?: { parse_mode?: string }
): Promise<void> {
  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: options?.parse_mode as any,
  });
}
