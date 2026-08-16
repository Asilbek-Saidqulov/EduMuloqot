import type { BotContext } from "../../types";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { getEffectiveRole, isUserActiveStaff, isStaffRole } from "../../auth/permissions";

/**
 * /panel command — unified staff panel for ALL staff roles.
 *
 * Unlike /admin (which requires an Admin-table record via authAdmin),
 * /panel works for any active staff user — including TEACHER and
 * CLASS_TEACHER who don't have Admin records.
 *
 * Phase 5+: This is the recommended entry point for staff. It:
 *   1. Loads the User + Admin records
 *   2. Checks the user is an active staff member (isUserActiveStaff)
 *   3. Computes the effective role (getEffectiveRole)
 *   4. Shows the role-specific keyboard
 *
 * Deactivated staff (User.isActive=false) are rejected — they see a
 * deactivation message instead of the panel.
 */
export async function panelCommand(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);

  if (!user) {
    await ctx.reply("⚠️ Siz hali ro'yxatdan o'tmagansiz. /start ni bosing.");
    return;
  }

  const adminForCheck = admin
    ? { role: admin.role, isActive: admin.isActive }
    : null;

  // Check if the user is an active staff member.
  if (!isStaffRole(user.role)) {
    // Not a staff role — show the parent/student main menu instead.
    const { mainMenu } = await import("../ui/screens");
    await ctx.reply("🏠 Bosh menyu", { reply_markup: mainMenu().keyboard });
    return;
  }

  // Phase 4 Hardening: deactivated staff get the deactivation screen.
  if (!isUserActiveStaff(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  )) {
    const { staffDeactivatedScreen } = await import("../ui/screens");
    const screen = staffDeactivatedScreen();
    await ctx.reply(screen.text, { reply_markup: screen.keyboard });
    return;
  }

  // Compute the effective role.
  const effectiveRole = getEffectiveRole(
    { role: user.role, isActive: user.isActive },
    adminForCheck
  );

  const roleLabels: Record<string, string> = {
    TEACHER: "👨‍🏫 O'qituvchi",
    CLASS_TEACHER: "👨‍🏫 Sinf rahbari",
    MAHALLA_RESPONSIBLE: "🏘 Mahalla mas'uli",
    SCHOOL_ADMIN: "🏫 Maktab administratori",
    ADMIN: "🛡 Admin",
    SUPER_ADMIN: "👑 Super Admin",
  };
  const label = roleLabels[effectiveRole] || effectiveRole;

  // Feature #14: show a one-time /panel hint to staff who haven't seen it yet.
  // We detect "first login" by checking if the user has no session state
  // (session is empty on first interaction). The hint is shown once and
  // then the user's session is marked as having seen it.
  const hasSeenPanelHint = (ctx.session as any).__seenPanelHint === true;
  if (!hasSeenPanelHint) {
    (ctx.session as any).__seenPanelHint = true;
    await ctx.reply(
      `💡 Maslahat: /panel buyrug'ini yodlab qoling — u sizni tezda panelingizga olib keladi.`,
      { reply_markup: getAdminMenuKeyboard(effectiveRole) }
    );
  }

  await ctx.reply(`⚙️ ${label} paneli`, {
    reply_markup: getAdminMenuKeyboard(effectiveRole),
  });
}
