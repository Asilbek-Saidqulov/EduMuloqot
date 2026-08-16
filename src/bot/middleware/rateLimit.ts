import type { NextFunction } from "grammy";
import type { BotContext } from "../../types";

/**
 * Rate-limit window: 3 seconds. Within this window, a single user may send
 * up to MAX_REQUESTS_PER_WINDOW updates before being throttled.
 */
const WINDOW_MS = 3000;

/**
 * Maximum updates per user per window. 5 updates / 3 seconds is generous
 * enough for normal conversational use (typing a name, tapping a button,
 * etc.) but blocks rapid-fire spam (e.g. holding down enter, or a script
 * flooding the bot).
 */
const MAX_REQUESTS_PER_WINDOW = 5;

/**
 * Safety cap on the in-memory Map size. If the number of tracked users
 * exceeds this (which should only happen under abnormal conditions — e.g.
 * a DDoS from many unique users), the Map is cleared entirely as a
 * defense-in-depth against unbounded memory growth. Normal operation will
 * never hit this cap because the periodic cleanup (CLEANUP_INTERVAL_MS)
 * removes stale entries.
 */
const MAX_TRACKED_USERS = 100_000;

/**
 * How often to run the periodic cleanup sweep. The sweep removes entries
 * whose timestamps are all older than WINDOW_MS — i.e. users who haven't
 * been active recently. This prevents the Map from growing forever as new
 * users interact with the bot.
 */
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

/**
 * In-memory per-user request log. Maps telegramId → array of timestamps
 * within the current window.
 *
 * This is a simple in-memory limiter sufficient for a single-process bot.
 * If the bot is ever scaled to multiple processes/instances, this should
 * be replaced with a shared store (e.g. Redis). For the current MVP
 * single-process deployment, this is adequate.
 *
 * Memory safety:
 *   - Entries are pruned on each access (timestamps older than WINDOW_MS
 *     are filtered out).
 *   - A periodic sweep (setInterval) removes entries whose timestamp
 *     arrays are empty after pruning.
 *   - A hard cap (MAX_TRACKED_USERS) clears the Map if it somehow grows
 *     beyond a reasonable size.
 */
const requestLog = new Map<number, number[]>();

/**
 * Periodic cleanup: remove entries for users who haven't been active in
 * the last WINDOW_MS. This prevents the Map from growing forever as new
 * users interact with the bot. Runs every CLEANUP_INTERVAL_MS.
 *
 * The interval is unref'd so it doesn't keep the Node.js process alive
 * on its own (e.g. during graceful shutdown).
 */
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [telegramId, timestamps] of requestLog) {
      const recent = timestamps.filter((ts) => now - ts < WINDOW_MS);
      if (recent.length === 0) {
        // User hasn't been active in the last window — remove the entry.
        requestLog.delete(telegramId);
      } else {
        // Update the entry with the pruned timestamps (saves memory).
        requestLog.set(telegramId, recent);
      }
    }
    // Defense-in-depth: if the Map is still too large (e.g. a burst of
    // 100k+ unique users within 1 minute — highly abnormal), clear it.
    if (requestLog.size > MAX_TRACKED_USERS) {
      requestLog.clear();
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for the cleanup timer.
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
}

// Start the cleanup timer when the module is first loaded.
startCleanupTimer();

/**
 * Per-user spam/flood limiter.
 *
 * Limits each Telegram user to MAX_REQUESTS_PER_WINDOW updates per
 * WINDOW_MS. Throttled updates are dropped (the downstream middleware is
 * NOT called) to prevent flooding the bot's handlers, DB, and Telegram
 * API.
 *
 * Per-user isolation: the limit is keyed by ctx.from.id (Telegram user
 * ID). User A hitting the limit does NOT affect User B.
 *
 * Callback queries: when a callback query is throttled, we call
 * ctx.answerCallbackQuery() so Telegram doesn't leave a spinning clock
 * icon on the button. The user sees a brief "⏳" tooltip.
 *
 * Messages: when a regular message is throttled, we send a single
 * ctx.reply() warning (only on the first throttled request in a burst —
 * subsequent throttled requests are silently dropped to avoid spamming
 * the chat).
 *
 * Conversations: the limiter runs BEFORE the session/conversations
 * middleware, so throttled updates never reach a conversation's
 * waitFor(). This is intentional — if a user is flooding, their excess
 * updates should not advance conversation state. The conversation simply
 * stays suspended until the user slows down, at which point the next
 * update passes through and resumes the conversation normally.
 *
 * Race safety: the read-modify-write on requestLog is synchronous (no
 * await between get and set), so Node's single-threaded event loop
 * ensures concurrent updates from the same user are serialized correctly.
 */
export function rateLimit() {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) {
      // No user (e.g. channel_post) — skip rate limiting.
      await next();
      return;
    }

    const now = Date.now();
    const recent = (requestLog.get(telegramId) ?? []).filter((ts) => now - ts < WINDOW_MS);
    recent.push(now);
    requestLog.set(telegramId, recent);

    if (recent.length > MAX_REQUESTS_PER_WINDOW) {
      // Throttled — drop the update. But answer callback queries so
      // Telegram doesn't leave a spinner running.
      if (ctx.callbackQuery) {
        // For callback queries: answer the query with a brief tooltip.
        // show_alert: false = small toast, not a modal popup.
        try {
          await ctx.answerCallbackQuery({
            text: "⏳ Iltimos, biroz kuting.",
            show_alert: false,
          });
        } catch {
          // answerCallbackQuery can fail if the query is too old (>~30s)
          // or already answered. Ignore — the main goal (dropping the
          // update) is already achieved.
        }
      } else {
        // For regular messages: send a single warning per burst (only
        // on the first throttled request, i.e. when recent.length ===
        // MAX_REQUESTS_PER_WINDOW + 1). Subsequent throttled messages
        // in the same burst are silently dropped to avoid spamming the
        // chat with warnings.
        if (recent.length === MAX_REQUESTS_PER_WINDOW + 1) {
          try {
            await ctx.reply("⏳ Juda tez yozyapsiz. Iltimos, biroz kuting.");
          } catch {
            // Ignore reply errors (e.g. chat blocked).
          }
        }
      }
      return;
    }

    await next();
  };
}
