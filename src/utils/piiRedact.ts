/**
 * Phase 9: PII redaction utilities for logging.
 *
 * Telegram IDs, phone numbers, and PINFL are PII. When logging errors
 * or debug info, these must be masked to prevent PII leakage into
 * log aggregators (stdout/stderr).
 */

/**
 * Mask a Telegram ID, showing only the last 4 digits.
 * Example: 123456789 → ****6789
 */
export function maskTelegramId(telegramId: bigint | string): string {
  const str = telegramId.toString();
  if (str.length <= 4) return "****";
  return "****" + str.slice(-4);
}

/**
 * Mask a phone number, showing only the last 4 digits.
 * Example: +998901234567 → ****4567
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "N/A";
  if (phone.length <= 4) return "****";
  return "****" + phone.slice(-4);
}

/**
 * Mask a PINFL, showing only the last 2 digits.
 * Example: 12345678901234 → ************34
 */
export function maskPinfl(pinfl: string | null | undefined): string {
  if (!pinfl) return "N/A";
  if (pinfl.length <= 2) return "****";
  return "*".repeat(pinfl.length - 2) + pinfl.slice(-2);
}
