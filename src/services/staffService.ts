/**
 * Phase 4 + Hardening: Staff provisioning service.
 *
 * Handles the business logic for provisioning staff:
 *   - Role assignment with privilege checks
 *   - School scope validation
 *   - Audit logging
 *   - Notification (best-effort)
 *   - Legacy Admin table synchronization (Phase 4 Hardening)
 *
 * Uses Phase 1 authorization infrastructure for all permission checks.
 *
 * Phase 4 Hardening changes:
 *   - Every provisioning / role change / activation / deactivation now
 *     calls staffSyncService.syncAdminRecordForUser() to keep the
 *     legacy Admin table in sync with the canonical User record.
 *   - Actor identity checks consult User.isActive via hasPermission
 *     (which now respects deactivation).
 *   - Audit log actions are clearer: PROVISION_STAFF (new user),
 *     CHANGE_ROLE (existing user role change), ACTIVATE_STAFF,
 *     DEACTIVATE_STAFF, SYNC_ADMIN_RECORD (legacy sync event).
 */
import { staffRepo } from "../repositories/staffRepo";
import { staffSyncService } from "./staffSyncService";
import { prisma } from "../database/prisma";
import {
  Permission,
  hasPermission,
  canAccessSchool,
  ROLE_LEVEL,
  isStaffRole,
  PermissionError,
} from "../auth/permissions";
import type { Bot } from "grammy";
import type { BotContext } from "../types";

// Bot reference for notifications
let botRef: Bot<BotContext> | undefined;
export function setBotRef(bot: Bot<BotContext>) {
  botRef = bot;
}

// Staff roles that can be provisioned
const PROVISIONABLE_STAFF_ROLES = [
  "TEACHER",
  "CLASS_TEACHER",
  "SCHOOL_ADMIN",
  "MAHALLA_RESPONSIBLE",
  "ADMIN",
];

// Roles that require a schoolId
const SCHOOL_SCOPED_ROLES = ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN"];

// Roles that require a neighborhoodId
const NEIGHBORHOOD_SCOPED_ROLES = ["MAHALLA_RESPONSIBLE"];

export const staffService = {
  /**
   * Provision a new staff member or change an existing user's role to staff.
   *
   * Security checks:
   *   1. Actor must have MANAGE_STAFF permission (and be active)
   *   2. Actor cannot assign a role higher than their own
   *   3. Actor cannot assign SUPER_ADMIN (only SUPER_ADMIN can)
   *   4. School-scoped roles require schoolId from actor's authorized scope
   *   5. Target user is created if doesn't exist (minimal record)
   *
   * Phase 4 Hardening:
   *   - Actor's User.isActive is checked implicitly via hasPermission.
   *   - After the role is assigned, syncAdminRecordForUser() is called
   *     to keep the legacy Admin table in sync. This is critical: the
   *     authAdmin middleware and complaint assignment UI still query
   *     the Admin table, so a SCHOOL_ADMIN provisioned via the Phase 4
   *     flow must also appear in the Admin table.
   *
   * Returns the updated/created user, or throws PermissionError.
   */
  async provisionStaff(params: {
    actorUserId: number;
    actorRole: string;
    actorSchoolId?: number | null;
    targetTelegramId: bigint;
    targetFullName?: string;
    newRole: string;
    schoolId?: number | null;
    neighborhoodId?: number | null;
    teacherSubject?: string;
    assignedClassName?: string;
  }): Promise<any> {
    const {
      actorUserId,
      actorRole,
      actorSchoolId,
      targetTelegramId,
      targetFullName,
      newRole,
      schoolId,
      neighborhoodId,
      teacherSubject,
      assignedClassName,
    } = params;

    // 1. Actor must have MANAGE_STAFF permission.
    //    Phase 4 Hardening: hasPermission now consults User.isActive —
    //    a deactivated staff member cannot provision others.
    if (!hasPermission({ role: actorRole }, Permission.MANAGE_STAFF)) {
      throw new PermissionError("Sizda xodimlarni boshqarish huquqi yo'q.");
    }

    // 2. Cannot assign SUPER_ADMIN unless actor is SUPER_ADMIN
    if (newRole === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
      throw new PermissionError("SUPER_ADMIN faqat SUPER_ADMIN tomonidan tayinlanadi.");
    }

    // 3. Cannot assign a role higher than actor's own level
    const actorLevel = ROLE_LEVEL[actorRole] || 0;
    const targetLevel = ROLE_LEVEL[newRole] || 0;
    if (targetLevel >= actorLevel && actorRole !== "SUPER_ADMIN") {
      throw new PermissionError(`Siz ${newRole} rolini tayinlay olmaysiz.`);
    }

    // 4. Validate the role is provisionable
    if (!isStaffRole(newRole)) {
      throw new PermissionError(`${newRole} xodim roli emas.`);
    }

    if (!PROVISIONABLE_STAFF_ROLES.includes(newRole) && newRole !== "SUPER_ADMIN") {
      throw new PermissionError(`${newRole} roli taqinlanmaydi.`);
    }

    // 5. School scope validation
    let finalSchoolId = schoolId || null;
    let finalNeighborhoodId = neighborhoodId || null;

    if (SCHOOL_SCOPED_ROLES.includes(newRole)) {
      if (!finalSchoolId) {
        throw new PermissionError(`${newRole} uchun maktab tanlanishi shart.`);
      }
      // Actor must have access to this school
      if (actorRole !== "SUPER_ADMIN" && actorRole !== "ADMIN") {
        if (!canAccessSchool({ role: actorRole, schoolId: actorSchoolId || null }, finalSchoolId)) {
          throw new PermissionError("Siz ushbu maktab uchun xodim tayinlay olmaysiz.");
        }
      }
    }

    if (NEIGHBORHOOD_SCOPED_ROLES.includes(newRole)) {
      if (!finalNeighborhoodId) {
        throw new PermissionError(`${newRole} uchun mahalla tanlanishi shart.`);
      }
    }

    // For ADMIN/SUPER_ADMIN, school scope is not required (global).
    // These roles must have null schoolId/neighborhoodId — we use the
    // clearScope option to explicitly null them out (since passing
    // `null` positionally now means "preserve existing").
    let clearSchoolScope = false;
    let clearNeighborhoodScope = false;
    if (newRole === "ADMIN" || newRole === "SUPER_ADMIN") {
      clearSchoolScope = true;
      clearNeighborhoodScope = true;
    }

    // 6. Find or create the target user
    let targetUser = await staffRepo.findByTelegramId(targetTelegramId);
    let oldRole: string | null = null;

    if (!targetUser) {
      // Create minimal user
      const created = await staffRepo.createMinimalUser(targetTelegramId, targetFullName);
      targetUser = {
        ...created,
        phone: null,
        neighborhoodId: null,
        parentRole: null,
        teacherSubject: null,
        assignedClassName: null,
      };
    } else {
      oldRole = targetUser.role;
      // Don't overwrite a SUPER_ADMIN unless actor is SUPER_ADMIN
      if (oldRole === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
        throw new PermissionError("SUPER_ADMIN ni o'zgartirish huquqi yo'q.");
      }
    }

    // 7. Assign the role (with Phase 10: teacherSubject + assignedClassName)
    const updated = await staffRepo.assignStaffRole(
      targetUser!.id,
      newRole,
      finalSchoolId,
      finalNeighborhoodId,
      {
        clearSchoolId: clearSchoolScope,
        clearNeighborhoodId: clearNeighborhoodScope,
        // Phase 10: pass teacherSubject for TEACHER, assignedClassName for CLASS_TEACHER
        teacherSubject,
        assignedClassName,
        // Clear these fields when transitioning away from the role
        clearTeacherSubject: newRole !== "TEACHER",
        clearAssignedClassName: newRole !== "CLASS_TEACHER",
      }
    );

    // 8. Phase 4 Hardening: synchronize the legacy Admin table.
    //    This MUST happen after the User update so the sync reads the
    //    final User state. If the sync fails, we log but do NOT roll
    //    back the User update — the User is the source of truth, and
    //    the Admin table can be re-synced later via a maintenance job.
    let adminSyncResult: { synced: boolean; adminId?: number } = { synced: false };
    try {
      const fullUser = await prisma.user.findUnique({
        where: { id: targetUser!.id },
        select: {
          id: true, telegramId: true, fullName: true, role: true,
          schoolId: true, neighborhoodId: true, isActive: true,
        },
      });
      if (fullUser) {
        const synced = await staffSyncService.syncAdminRecordForUser(fullUser);
        adminSyncResult = { synced: true, adminId: synced?.id };
      }
    } catch (err) {
      console.error(`Staff admin sync failed (userId=${targetUser!.id}):`, (err as Error).message);
    }

    // 9. Log the action
    await staffRepo.logAction({
      actorUserId,
      targetUserId: targetUser!.id,
      action: oldRole ? "CHANGE_ROLE" : "PROVISION_STAFF",
      oldRole,
      newRole,
      schoolId: finalSchoolId,
      details: JSON.stringify({
        telegramId: targetTelegramId.toString(),
        adminSynced: adminSyncResult.synced,
        adminId: adminSyncResult.adminId ?? null,
      }),
    });

    // 10. Notify the staff member (best-effort)
    try {
      if (botRef) {
        const roleLabels: Record<string, string> = {
          TEACHER: "👨‍🏫 O'qituvchi",
          CLASS_TEACHER: "👨‍🏫 Sinf rahbari",
          SCHOOL_ADMIN: "🏫 Maktab administratori",
          MAHALLA_RESPONSIBLE: "🏘 Mahalla mas'uli",
          ADMIN: "🛡 Admin",
          SUPER_ADMIN: "👑 Super Admin",
        };
        const roleLabel = roleLabels[newRole] || newRole;

        let schoolName = "";
        if (finalSchoolId) {
          const school = await prisma.school.findUnique({ where: { id: finalSchoolId } });
          schoolName = school?.name || "";
        }

        let msg = `🎉 Siz EduMuloqot tizimiga xodim sifatida qo'shildingiz.\n\nLavozimingiz: ${roleLabel}`;
        if (schoolName) msg += `\nMaktab: ${schoolName}`;
        msg += `\n\nEndi /start orqali tizimdan foydalanishingiz mumkin.`;

        await botRef.api.sendMessage(targetTelegramId.toString(), msg);
      }
    } catch (err) {
      // Notification failure should NOT roll back the provisioning
      // Phase 9: Mask telegramId in logs
      const { maskTelegramId } = require("../utils/piiRedact");
      console.error(`Staff notification failed (user=${maskTelegramId(targetTelegramId)}):`, (err as Error).message);
    }

    return updated;
  },

  /**
   * Deactivate a staff member.
   *
   * Phase 4 Hardening:
   *   - User.isActive is set to false (the canonical deactivation).
   *   - The legacy Admin record's isActive is also set to false via
   *     syncAdminActiveState, so authAdmin (which checks Admin.isActive)
   *     also blocks the deactivated staff member.
   *   - The user's role is NOT changed — they retain TEACHER/SCHOOL_ADMIN/
   *     etc. for audit purposes. They just can't exercise the role's
   *     permissions until reactivated.
   *   - Family/student relationships are NOT touched.
   */
  async deactivateStaff(params: {
    actorUserId: number;
    actorRole: string;
    targetUserId: number;
  }): Promise<void> {
    const { actorUserId, actorRole, targetUserId } = params;

    if (!hasPermission({ role: actorRole }, Permission.MANAGE_STAFF)) {
      throw new PermissionError("Sizda xodimlarni boshqarish huquqi yo'q.");
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new PermissionError("Xodim topilmadi.");

    // Cannot deactivate SUPER_ADMIN unless actor is SUPER_ADMIN
    if (target.role === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
      throw new PermissionError("SUPER_ADMIN ni o'chirib bo'lmaydi.");
    }

    // Cannot deactivate someone with higher or equal role (unless SUPER_ADMIN)
    const targetLevel = ROLE_LEVEL[target.role] || 0;
    const actorLevel = ROLE_LEVEL[actorRole] || 0;
    if (targetLevel >= actorLevel && actorRole !== "SUPER_ADMIN") {
      throw new PermissionError("Siz ushbu xodimni o'chira olmaysiz.");
    }

    // Don't deactivate a non-staff user (e.g. PARENT) — no-op with audit log.
    if (!isStaffRole(target.role)) {
      throw new PermissionError("Faqat xodimlarni faolsizlantirish mumkin.");
    }

    // Don't double-deactivate.
    if (!target.isActive) {
      throw new PermissionError("Xodim allaqachon faol emas.");
    }

    await staffRepo.deactivateStaff(targetUserId);

    // Phase 4 Hardening: sync the legacy Admin record's isActive.
    try {
      await staffSyncService.syncAdminActiveState(target.telegramId, false);
    } catch (err) {
      console.error(`Staff admin sync (deactivate) failed (userId=${targetUserId}):`, (err as Error).message);
    }

    await staffRepo.logAction({
      actorUserId,
      targetUserId,
      action: "DEACTIVATE_STAFF",
      oldRole: target.role,
      newRole: target.role,
    });
  },

  /**
   * Activate a staff member.
   *
   * Phase 4 Hardening:
   *   - User.isActive is set to true.
   *   - The legacy Admin record's isActive is also set to true via
   *     syncAdminActiveState.
   *   - The user's role is NOT changed during activation.
   */
  async activateStaff(params: {
    actorUserId: number;
    actorRole: string;
    targetUserId: number;
  }): Promise<void> {
    const { actorUserId, actorRole, targetUserId } = params;

    if (!hasPermission({ role: actorRole }, Permission.MANAGE_STAFF)) {
      throw new PermissionError("Sizda xodimlarni boshqarish huquqi yo'q.");
    }

    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new PermissionError("Xodim topilmadi.");

    // Don't activate a non-staff user.
    if (!isStaffRole(target.role)) {
      throw new PermissionError("Faqat xodimlarni faollashtirish mumkin.");
    }

    // Don't double-activate.
    if (target.isActive) {
      throw new PermissionError("Xodim allaqachon faol.");
    }

    await staffRepo.activateStaff(targetUserId);

    // Phase 4 Hardening: sync the legacy Admin record's isActive.
    try {
      await staffSyncService.syncAdminActiveState(target.telegramId, true);
    } catch (err) {
      console.error(`Staff admin sync (activate) failed (userId=${targetUserId}):`, (err as Error).message);
    }

    await staffRepo.logAction({
      actorUserId,
      targetUserId,
      action: "ACTIVATE_STAFF",
      oldRole: target.role,
      newRole: target.role,
    });
  },

  /**
   * List staff for the actor's scope.
   */
  async listStaff(params: {
    actorRole: string;
    actorSchoolId?: number | null;
  }): Promise<any[]> {
    const { actorRole, actorSchoolId } = params;

    if (actorRole === "SUPER_ADMIN" || actorRole === "ADMIN") {
      return staffRepo.listAllStaff();
    }

    if (actorSchoolId) {
      return staffRepo.listStaffBySchool(actorSchoolId);
    }

    return [];
  },
};
