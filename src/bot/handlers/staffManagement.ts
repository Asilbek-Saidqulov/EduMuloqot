/**
 * Phase 4 + Hardening: Staff management handlers (standalone, not conversation).
 *
 * Phase 4 Hardening changes:
 *   - All handlers now use the centralized `getEffectiveRole` /
 *     `hasPermission` / `isUserActiveStaff` from auth/permissions.ts
 *     instead of ad-hoc `admin?.isActive ? admin.role : user.role`
 *     logic. The ad-hoc logic was buggy: it bypassed the
 *     NEIGHBORHOOD_ADMIN → MAHALLA_RESPONSIBLE mapping, didn't check
 *     User.isActive, and didn't consult ROLE_LEVEL for proper role
 *     comparison.
 *   - Every handler loads BOTH the User and Admin records and passes
 *     them to hasPermission. This is the only correct way to make an
 *     authorization decision in the dual-identity system.
 *   - Deactivated staff (User.isActive=false) are rejected at every
 *     entry point. This is enforced by hasPermission which consults
 *     User.isActive.
 *   - School isolation is enforced: a SCHOOL_ADMIN viewing the staff
 *     list only sees staff at their own school (the schoolId comes
 *     from the trusted DB User/Admin record, never from callback data).
 */
import type { BotContext } from "../../types";
import { staffService } from "../../services/staffService";
import { staffRepo } from "../../repositories/staffRepo";
import { userRepo } from "../../repositories/userRepo";
import { adminRepo } from "../../repositories/adminRepo";
import { prisma } from "../../database/prisma";
import {
  Permission,
  hasPermission,
  getEffectiveRole,
  isUserActiveStaff,
} from "../../auth/permissions";
import {
  staffManagementMenu,
  staffListScreen,
  staffDetailScreen,
  mainMenu,
} from "../ui/screens";
import { adminMenuKeyboard } from "../keyboards/adminMenu";

/**
 * Resolve the actor's full identity: User + Admin records.
 * Returns null if the user has no User record at all (e.g. a brand-new
 * Telegram user pressing a stale callback).
 *
 * The `effectiveRole` is computed via getEffectiveRole, which consults
 * User.isActive, Admin.isActive, and the role-hierarchy mapping.
 */
async function resolveActor(telegramId: bigint) {
  const [user, admin] = await Promise.all([
    userRepo.findByTelegramId(telegramId),
    adminRepo.findByTelegramId(telegramId),
  ]);
  if (!user) return null;

  const effectiveRole = getEffectiveRole(
    { role: user.role, isActive: user.isActive },
    admin ? { role: admin.role, isActive: admin.isActive } : null
  );

  // For school scope: prefer the active admin's schoolId if available
  // (it should match user.schoolId after sync, but in case of legacy
  // mismatch we use whichever is set). If the user is a deactivated
  // staff member, effectiveRole is PARENT and the scope comes from
  // user.schoolId — which is correct (a deactivated SCHOOL_ADMIN
  // should NOT be able to query their old school's staff list).
  const effectiveSchoolId = admin?.isActive ? (admin.schoolId ?? user.schoolId) : user.schoolId;

  return { user, admin, effectiveRole, effectiveSchoolId };
}

/**
 * Check if the actor can manage staff. Phase 4 Hardening: this requires
 * BOTH the MANAGE_STAFF permission AND active staff status (User.isActive
 * must be true). A deactivated SCHOOL_ADMIN with an active Admin record
 * is rejected here — `hasPermission` consults User.isActive internally.
 */
function canManageStaff(actor: {
  user: { role: string; isActive: boolean };
  admin: { role: string; isActive: boolean } | null;
}): boolean {
  return hasPermission(
    { role: actor.user.role, isActive: actor.user.isActive },
    Permission.MANAGE_STAFF,
    actor.admin
  );
}

/**
 * Show staff management menu.
 */
export async function staffMenuHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor || !canManageStaff(actor)) {
    await ctx.reply("⛔️ Sizda xodimlarni boshqarish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Pass isSuperAdmin so the legacy admin management button is shown
  // only to SUPER_ADMIN users.
  const isSuperAdmin = actor.effectiveRole === "SUPER_ADMIN";
  const screen = staffManagementMenu(isSuperAdmin);
  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * List staff.
 *
 * School isolation: a SCHOOL_ADMIN sees only staff at their own school
 * (effectiveSchoolId comes from the trusted DB record, not callback
 * data). SUPER_ADMIN and ADMIN see all staff globally.
 */
export async function staffListHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor || !canManageStaff(actor)) {
    await ctx.reply("⛔️ Sizda xodimlarni boshqarish huquqi yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const staff = await staffService.listStaff({
    actorRole: actor.effectiveRole,
    actorSchoolId: actor.effectiveSchoolId,
  });

  const screen = staffListScreen(staff);
  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * View staff detail.
 *
 * Phase 4 Hardening: school isolation is enforced — a SCHOOL_ADMIN
 * cannot view a staff member outside their school by crafting a
 * callback with another school's staff ID. The check is done by
 * comparing the target staff member's schoolId to the actor's
 * effectiveSchoolId (SUPER_ADMIN/ADMIN bypass this check).
 */
export async function staffViewHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) return;

  const staffId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor || !canManageStaff(actor)) {
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  const staffMember = await prisma.user.findUnique({
    where: { id: staffId },
    include: { school: true },
  });

  if (!staffMember) {
    await ctx.reply("⚠️ Xodim topilmadi.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Phase 4 Hardening: school isolation. A SCHOOL_ADMIN (or any
  // school-scoped role) cannot view a staff member at another school.
  // SUPER_ADMIN and ADMIN have global access.
  if (actor.effectiveRole !== "SUPER_ADMIN" && actor.effectiveRole !== "ADMIN") {
    if (staffMember.schoolId !== actor.effectiveSchoolId) {
      await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
  }

  // Phase 9 Security Fix: Mask telegramId for non-SUPER_ADMIN viewers.
  // Only SUPER_ADMIN should see full Telegram IDs — SCHOOL_ADMIN sees
  // only the masked version to prevent PII exposure.
  const isSuperAdmin = actor.effectiveRole === "SUPER_ADMIN";
  const { maskTelegramId } = require("../../utils/piiRedact");
  const screen = staffDetailScreen({
    id: staffMember.id,
    fullName: staffMember.fullName,
    telegramId: isSuperAdmin
      ? staffMember.telegramId.toString()
      : maskTelegramId(staffMember.telegramId),
    role: staffMember.role,
    schoolName: staffMember.school?.name,
    isActive: staffMember.isActive,
  });
  await ctx.reply(screen.text, { reply_markup: screen.keyboard });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

/**
 * Deactivate staff.
 *
 * Phase 4 Hardening: school isolation enforced — a SCHOOL_ADMIN cannot
 * deactivate a staff member at another school. The staffService also
 * enforces role-hierarchy checks (cannot deactivate someone with equal
 * or higher role), so even if a SCHOOL_ADMIN somehow obtained the
 * callback for a SUPER_ADMIN's staffId, the service would reject it.
 */
export async function staffDeactivateHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) return;

  const staffId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor || !canManageStaff(actor)) {
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Phase 4 Hardening: load target to verify school scope before
  // calling the service. The service also re-checks, but doing it
  // here gives a better error message.
  const target = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, schoolId: true, role: true, isActive: true },
  });
  if (!target) {
    await ctx.answerCallbackQuery({ text: "Xodim topilmadi.", show_alert: true });
    return;
  }
  if (actor.effectiveRole !== "SUPER_ADMIN" && actor.effectiveRole !== "ADMIN") {
    if (target.schoolId !== actor.effectiveSchoolId) {
      await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
      return;
    }
  }

  try {
    await staffService.deactivateStaff({
      actorUserId: actor.user.id,
      actorRole: actor.effectiveRole,
      targetUserId: staffId,
    });
    await ctx.answerCallbackQuery({ text: "✅ Xodim faolsizlantirildi." });
    await ctx.reply("✅ Xodim faolsizlantirildi.", { reply_markup: adminMenuKeyboard });
  } catch (error: any) {
    await ctx.answerCallbackQuery({ text: error.message, show_alert: true });
  }
}

/**
 * Activate staff.
 *
 * Same school-isolation and role-hierarchy checks as deactivate.
 */
export async function staffActivateHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from || !ctx.callbackQuery?.data) return;

  const staffId = Number(ctx.callbackQuery.data.split(":")[1]);
  const telegramId = BigInt(ctx.from.id);
  const actor = await resolveActor(telegramId);

  if (!actor || !canManageStaff(actor)) {
    await ctx.reply("⛔️ Ruxsat yo'q.", { reply_markup: mainMenu().keyboard });
    if (ctx.callbackQuery) await ctx.answerCallbackQuery();
    return;
  }

  // Phase 4 Hardening: school isolation.
  const target = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, schoolId: true, role: true, isActive: true },
  });
  if (!target) {
    await ctx.answerCallbackQuery({ text: "Xodim topilmadi.", show_alert: true });
    return;
  }
  if (actor.effectiveRole !== "SUPER_ADMIN" && actor.effectiveRole !== "ADMIN") {
    if (target.schoolId !== actor.effectiveSchoolId) {
      await ctx.answerCallbackQuery({ text: "Ruxsat yo'q.", show_alert: true });
      return;
    }
  }

  try {
    await staffService.activateStaff({
      actorUserId: actor.user.id,
      actorRole: actor.effectiveRole,
      targetUserId: staffId,
    });
    await ctx.answerCallbackQuery({ text: "✅ Xodim faollashtirildi." });
    await ctx.reply("✅ Xodim faollashtirildi.", { reply_markup: adminMenuKeyboard });
  } catch (error: any) {
    await ctx.answerCallbackQuery({ text: error.message, show_alert: true });
  }
}
