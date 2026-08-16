/**
 * Phase 4 Hardening: Staff ↔ Legacy Admin synchronization service.
 *
 * The project has TWO staff identity systems:
 *
 *   A) User.role + User.isActive (the canonical Phase 4 source of truth)
 *   B) Admin.role + Admin.isActive (the legacy system, still used by
 *      authAdmin middleware, complaint assignment, complaint reply,
 *      and admin management UI)
 *
 * We do NOT remove the legacy Admin system because too much existing
 * functionality depends on it. Instead, we synchronize it from the
 * canonical User record every time a staff provisioning / role change /
 * activation / deactivation event occurs.
 *
 * Synchronization rules (NO PRIVILEGE ESCALATION):
 *
 *   1. The User.role is the source of truth. When we sync, we write
 *      User.role → Admin.role (mapped via ADMIN_ROLE_MAP).
 *
 *   2. If no Admin record exists for the Telegram ID, we create one
 *      with the user's role/school/neighborhood. We do NOT create
 *      Admin records for TEACHER / CLASS_TEACHER — those roles have
 *      no equivalent AdminRole and don't need legacy admin features.
 *
 *   3. If an Admin record already exists, we update its role, schoolId,
 *      neighborhoodId, and isActive to match the User record. We NEVER
 *      downgrade privileges implicitly: the sync only writes the User's
 *      role to the Admin row, and the User.role is itself controlled
 *      by authorized provisioning (staffService.provisionStaff enforces
 *      role hierarchy). If an existing Admin row has SUPER_ADMIN and
 *      the User.role is PARENT (i.e. the user was never properly
 *      provisioned), we DO NOT silently preserve the SUPER_ADMIN — that
 *      would be a privilege escalation vector. The sync overwrites it
 *      to the User's actual role (PARENT maps to SCHOOL_ADMIN as a
 *      safety default, but this scenario shouldn't happen because
 *      provisioning is the only path that sets staff roles).
 *
 *   4. SUPER_ADMIN provisioning: when a SUPER_ADMIN is provisioned via
 *      staffService, the sync creates/updates an Admin row with
 *      AdminRole=SUPER_ADMIN, no school/neighborhood scope, isActive
 *      matching User.isActive. The bootstrap path (seed.ts) does the
 *      same — it now also upserts a User record with role=SUPER_ADMIN.
 *
 *   5. Deactivation: when User.isActive is set to false, the sync sets
 *      Admin.isActive = false on the corresponding Admin row (if any).
 *      This ensures authAdmin (which checks Admin.isActive) also blocks
 *      the deactivated staff member.
 *
 *   6. Activation: when User.isActive is set to true, the sync sets
 *      Admin.isActive = true on the corresponding Admin row.
 *
 * Mapping (UserRole → AdminRole):
 *
 *   UserRole.SUPER_ADMIN          → AdminRole.SUPER_ADMIN
 *   UserRole.ADMIN                → AdminRole.SUPER_ADMIN  (AdminRole has no ADMIN; ADMIN is treated as SUPER_ADMIN for legacy purposes)
 *   UserRole.SCHOOL_ADMIN         → AdminRole.SCHOOL_ADMIN
 *   UserRole.MAHALLA_RESPONSIBLE  → AdminRole.NEIGHBORHOOD_ADMIN
 *   UserRole.TEACHER              → (no Admin row needed)
 *   UserRole.CLASS_TEACHER        → (no Admin row needed)
 *   UserRole.PARENT               → (no Admin row needed; if an Admin row exists, it is left alone — see note below)
 *   UserRole.STUDENT              → (no Admin row needed)
 *
 * Note on PARENT: if a user is downgraded from SCHOOL_ADMIN to PARENT
 * (currently not exposed in the UI, but supported by the data model),
 * we do NOT delete the existing Admin row — we set its isActive=false.
 * Deleting the Admin row would break historical references
 * (ComplaintAssignment.toAdminId, AdminActionLog.actorAdminId, etc.).
 * The deactivated Admin row preserves all history while blocking
 * future access.
 */
import { prisma } from "../database/prisma";

/**
 * Map a UserRole to the corresponding AdminRole.
 * Returns null if the UserRole has no AdminRole equivalent
 * (TEACHER, CLASS_TEACHER, PARENT, STUDENT).
 */
export function userRoleToAdminRole(userRole: string): string | null {
  switch (userRole) {
    case "SUPER_ADMIN":
      return "SUPER_ADMIN";
    case "ADMIN":
      // AdminRole has no ADMIN value. ADMIN is a tier above
      // SCHOOL_ADMIN but below SUPER_ADMIN. For legacy purposes
      // (authAdmin, complaint assignment), ADMIN is mapped to
      // SUPER_ADMIN — they have the same effective scope (global)
      // and the same legacy capabilities.
      return "SUPER_ADMIN";
    case "SCHOOL_ADMIN":
      return "SCHOOL_ADMIN";
    case "MAHALLA_RESPONSIBLE":
      return "NEIGHBORHOOD_ADMIN";
    default:
      // TEACHER, CLASS_TEACHER, PARENT, STUDENT — no Admin row needed.
      return null;
  }
}

export const staffSyncService = {
  /**
   * Synchronize the legacy Admin record for a User. Call this after
   * every staff provisioning, role change, activation, or deactivation.
   *
   * Idempotent: calling it twice with the same User state produces the
   * same result. Safe to call for users with no Admin record (creates
   * one if needed, or does nothing if the role doesn't need one).
   *
   * @returns The synced Admin record (or null if no Admin row is needed
   *          for this user's role).
   */
  async syncAdminRecordForUser(user: {
    id: number;
    telegramId: bigint;
    fullName: string | null;
    role: string;
    schoolId: number | null;
    neighborhoodId: number | null;
    isActive: boolean;
  }): Promise<{ id: number; telegramId: bigint; role: string; isActive: boolean } | null> {
    const adminRole = userRoleToAdminRole(user.role);

    // No AdminRole equivalent — e.g. TEACHER, CLASS_TEACHER, PARENT, STUDENT.
    // If an Admin row exists from a previous role (e.g. the user was
    // previously SCHOOL_ADMIN but is now a TEACHER), we DO NOT delete it
    // (would break FK references). Instead we set isActive=false to
    // block legacy admin access while preserving history.
    if (adminRole === null) {
      const existing = await prisma.admin.findUnique({
        where: { telegramId: user.telegramId },
        select: { id: true, isActive: true, role: true },
      });
      if (existing && existing.isActive) {
        await prisma.admin.update({
          where: { id: existing.id },
          data: { isActive: false },
        });
      }
      return null;
    }

    // Upsert the Admin record to match the User.
    // We use a transaction to ensure atomicity.
    return prisma.$transaction(async (tx) => {
      const existing = await tx.admin.findUnique({
        where: { telegramId: user.telegramId },
        select: { id: true, role: true, isActive: true, fullName: true },
      });

      if (existing) {
        // Update the existing Admin row to match the User.
        // This is the critical "no privilege escalation" step: we
        // OVERWRITE the existing role with the User's role. If the
        // existing Admin was SUPER_ADMIN and the User is now
        // SCHOOL_ADMIN, the Admin becomes SCHOOL_ADMIN. The User's
        // role is the source of truth.
        return tx.admin.update({
          where: { id: existing.id },
          data: {
            role: adminRole as any,
            schoolId: user.schoolId,
            neighborhoodId: user.neighborhoodId,
            isActive: user.isActive,
            fullName: user.fullName ?? existing.fullName ?? undefined,
          },
          select: { id: true, telegramId: true, role: true, isActive: true },
        });
      }

      // No existing Admin row — create one.
      return tx.admin.create({
        data: {
          telegramId: user.telegramId,
          fullName: user.fullName,
          role: adminRole as any,
          schoolId: user.schoolId,
          neighborhoodId: user.neighborhoodId,
          isActive: user.isActive,
        },
        select: { id: true, telegramId: true, role: true, isActive: true },
      });
    });
  },

  /**
   * Set Admin.isActive to match User.isActive for an existing Admin row.
   * Used when only the active/inactive state changes (no role change).
   * If no Admin row exists, this is a no-op.
   */
  async syncAdminActiveState(telegramId: bigint, isActive: boolean): Promise<void> {
    const existing = await prisma.admin.findUnique({
      where: { telegramId },
      select: { id: true, isActive: true },
    });
    if (!existing) return;
    if (existing.isActive === isActive) return;
    await prisma.admin.update({
      where: { id: existing.id },
      data: { isActive },
    });
  },
};
