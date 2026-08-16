import type { BotContext } from "../../types";
import { getAdminMenuKeyboard } from "../keyboards/adminMenu";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { getEffectiveRole } from "../../auth/permissions";

/**
 * /admin command — shows the role-specific staff panel.
 *
 * Phase 5+: This command now works for ALL staff roles, not just
 * legacy Admin-table users. It resolves the effective role from
 * User.role + Admin record (via getEffectiveRole) and shows the
 * appropriate role-specific keyboard.
 *
 * Authorization: the `authAdmin` middleware on the `/admin` route
 * requires an Admin-table record. For staff WITHOUT Admin records
 * (TEACHER, CLASS_TEACHER), use the `/panel` command instead — it
 * checks User.role directly without requiring an Admin row.
 */
export async function adminCommand(ctx: BotContext): Promise<void> {
  const admin = ctx.admin;
  if (!admin) return;

  // Load the User record to get the canonical role + isActive.
  const telegramId = BigInt(ctx.from!.id);
  const user = await userRepo.findByTelegramId(telegramId);

  // Compute the effective role combining User.role and Admin.role.
  // getEffectiveRole consults User.isActive (Phase 4 Hardening).
  const adminRole = (admin as any).role || "SCHOOL_ADMIN";
  const userRole = user?.role || "PARENT";
  const userIsActive = user?.isActive ?? true;
  const effectiveRole = getEffectiveRole(
    { role: userRole, isActive: userIsActive },
    { role: adminRole, isActive: (admin as any).isActive ?? true }
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

  await ctx.reply(`⚙️ ${label} paneli`, {
    reply_markup: getAdminMenuKeyboard(effectiveRole),
  });
}
