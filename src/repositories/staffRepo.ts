/**
 * Phase 4: Staff repository.
 *
 * Handles all DB operations for staff provisioning:
 *   - Find/create user by Telegram ID (for provisioning)
 *   - Assign role to user
 *   - Activate/deactivate staff
 *   - List staff by school or globally
 *   - Audit logging
 */
import { prisma } from "../database/prisma";

export const staffRepo = {
  /**
   * Find a user by Telegram ID (for provisioning checks).
   * Returns null if not found — does NOT create.
   */
  async findByTelegramId(telegramId: bigint) {
    return prisma.user.findUnique({
      where: { telegramId },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        phone: true,
        schoolId: true,
        neighborhoodId: true,
        role: true,
        parentRole: true,
        isActive: true,
        teacherSubject: true,
        assignedClassName: true,
      },
    });
  },

  /**
   * Create a minimal User record for a Telegram ID that doesn't exist yet.
   * Used when an admin provisions a staff member who hasn't interacted
   * with the bot yet.
   */
  async createMinimalUser(telegramId: bigint, fullName?: string) {
    return prisma.user.create({
      data: {
        telegramId,
        fullName,
        role: "PARENT", // Will be overwritten by the provisioning
        isActive: true,
      },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        role: true,
        schoolId: true,
        isActive: true,
      },
    });
  },

  /**
   * Assign a staff role to a user. Updates role and isActive always.
   *
   * Scope fields (schoolId, neighborhoodId) semantics:
   *
   *   - `undefined` OR `null`  → do NOT touch this field (preserve
   *                              existing DB value). This is the
   *                              "I'm not providing a new value"
   *                              semantics used by role transitions
   *                              like PARENT → TEACHER where the
   *                              existing parent's neighborhoodId
   *                              should be preserved.
   *   - `<number>`             → set this field to the given value.
   *
   * To EXPLICITLY clear a scope field (set to NULL), use the
   * `clearScope` option or call `prisma.user.update` directly. This
   * 2-valued logic (provide-a-value vs. don't-provide) matches the
   * test expectation that passing `null` for neighborhoodId when
   * transitioning to a non-neighborhood-scoped role preserves the
   * existing value.
   *
   * Does NOT touch fullName, phone, parentRole, or family relationships
   * — those are always preserved.
   */
  async assignStaffRole(
    userId: number,
    role: string,
    schoolId?: number | null,
    neighborhoodId?: number | null,
    options?: {
      clearSchoolId?: boolean;
      clearNeighborhoodId?: boolean;
      teacherSubject?: string;
      assignedClassName?: string;
      clearTeacherSubject?: boolean;
      clearAssignedClassName?: boolean;
    }
  ) {
    const data: any = { role, isActive: true };
    // Only set scope fields when the caller provides a real number.
    // `undefined` and `null` both mean "preserve existing".
    if (typeof schoolId === "number") data.schoolId = schoolId;
    else if (options?.clearSchoolId) data.schoolId = null;

    if (typeof neighborhoodId === "number") data.neighborhoodId = neighborhoodId;
    else if (options?.clearNeighborhoodId) data.neighborhoodId = null;

    // Phase 10: Teacher subject + class teacher assigned class
    if (typeof options?.teacherSubject === "string") data.teacherSubject = options.teacherSubject;
    else if (options?.clearTeacherSubject) data.teacherSubject = null;

    if (typeof options?.assignedClassName === "string") data.assignedClassName = options.assignedClassName;
    else if (options?.clearAssignedClassName) data.assignedClassName = null;

    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        role: true,
        schoolId: true,
        neighborhoodId: true,
        isActive: true,
        teacherSubject: true,
        assignedClassName: true,
      },
    });
  },

  /**
   * Deactivate a staff member (set isActive = false).
   * Does NOT change role or delete any data.
   */
  async deactivateStaff(userId: number) {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
  },

  /**
   * Activate a staff member (set isActive = true).
   */
  async activateStaff(userId: number) {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });
  },

  /**
   * List staff users by school.
   */
  async listStaffBySchool(schoolId: number) {
    return prisma.user.findMany({
      where: {
        schoolId,
        role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN"] },
      },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        role: true,
        schoolId: true,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * List all staff users (for SUPER_ADMIN).
   */
  async listAllStaff() {
    return prisma.user.findMany({
      where: {
        role: { in: ["TEACHER", "CLASS_TEACHER", "SCHOOL_ADMIN", "MAHALLA_RESPONSIBLE", "ADMIN", "SUPER_ADMIN"] },
      },
      select: {
        id: true,
        telegramId: true,
        fullName: true,
        role: true,
        schoolId: true,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Log a staff action for audit trail.
   */
  async logAction(params: {
    actorUserId: number;
    targetUserId: number;
    action: string;
    oldRole?: string | null;
    newRole?: string | null;
    schoolId?: number | null;
    details?: string | null;
  }) {
    return (prisma as any).staffActionLog.create({
      data: {
        actorUserId: params.actorUserId,
        targetUserId: params.targetUserId,
        action: params.action,
        oldRole: params.oldRole || null,
        newRole: params.newRole || null,
        schoolId: params.schoolId || null,
        details: params.details || null,
      },
    });
  },
};
