import { InlineKeyboard } from "grammy";

/**
 * Progress indicator component
 */
export function progressIndicator(current: number, total: number): string {
  return `${current} / ${total}`;
}

/**
 * Header component
 */
export function header(title: string, subtitle?: string): string {
  let text = `🏫 ${title}\n\n`;
  if (subtitle) {
    text += `${subtitle}\n\n`;
  }
  return text;
}

/**
 * Status badge component
 */
export function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    NEW: "🟡 Yangi",
    ASSIGNED: "📌 Biriktirildi",
    IN_PROGRESS: "🔄 Ko'rib chiqilmoqda",
    RESOLVED: "✅ Hal qilindi",
    REJECTED: "🔴 Rad etildi",
  };
  return badges[status] || status;
}

/**
 * Back button
 */
export function backButton(callbackData: string): InlineKeyboard {
  return new InlineKeyboard().text("◀️ Orqaga", callbackData);
}

/**
 * Cancel button
 */
export function cancelButton(callbackData: string): InlineKeyboard {
  return new InlineKeyboard().text("❌ Bekor qilish", callbackData);
}

/**
 * Home button
 */
export function homeButton(callbackData: string): InlineKeyboard {
  return new InlineKeyboard().text("🏠 Bosh menyu", callbackData);
}

/**
 * Navigation row with back and cancel
 */
export function navigationRow(backCallback: string, cancelCallback: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("◀️ Orqaga", backCallback)
    .text("❌ Bekor qilish", cancelCallback);
}

/**
 * Navigation row with back and home
 */
export function navigationRowWithHome(backCallback: string, homeCallback: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("◀️ Orqaga", backCallback)
    .text("🏠 Bosh menyu", homeCallback);
}

/**
 * Divider
 */
export function divider(): string {
  return "━━━━━━━━━━━━━━";
}

/**
 * Empty state
 */
export function emptyState(message: string, actionLabel: string, actionCallback: string): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: message,
    keyboard: new InlineKeyboard().text(actionLabel, actionCallback),
  };
}

/**
 * Error state
 */
export function errorState(): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: "⚠️ Nimadir noto'g'ri ketdi.\n\nIltimos, birozdan so'ng qayta urinib ko'ring.",
    keyboard: new InlineKeyboard()
      .text("🔄 Qayta urinish", "retry")
      .text("🏠 Bosh menyu", "home"),
  };
}

/**
 * Loading state
 */
export function loadingState(message: string): string {
  return `⏳ ${message}`;
}

/**
 * Confirmation screen
 */
export function confirmationScreen(
  title: string,
  message: string,
  confirmCallback: string,
  cancelCallback: string
): {
  text: string;
  keyboard: InlineKeyboard;
} {
  return {
    text: `${title}\n\n${message}`,
    keyboard: new InlineKeyboard()
      .text("✅ Tasdiqlash", confirmCallback)
      .text("❌ Bekor qilish", cancelCallback),
  };
}
